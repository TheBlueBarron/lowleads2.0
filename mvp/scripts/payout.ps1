<#
.SYNOPSIS
  Manual escrow payout for Lowleads — pays out a COMPANY or a TECHNICIAN
  (employee) platform-held balance, via SSM port-forward through the bastion to
  the staging RDS instance.

.DESCRIPTION
  This is the real payout mechanism for launch (no Stripe Connect). It calls the
  DB-side process_payout() function, which atomically:
    * locks the payee row,
    * verifies sufficient balance (raises + rolls back otherwise),
    * decrements the correct balance column (companies or technicians), and
    * writes an append-only 'withdrawal' ledger row with your reference.

  Nothing is paid OUT of a bank account here — this records that you have settled
  a balance externally (cheque, Zelle, ACH, etc.). Run your external transfer
  first, then record it here with that transfer's reference.

.PARAMETER PayeeType
  'company' or 'technician'.

.PARAMETER PayeeId
  UUID of the company or technician being paid.

.PARAMETER AmountCents
  Positive integer amount in cents to pay out.

.PARAMETER PayoutReference
  Free-text external reference (cheque #, wire id, etc.) — stored on the row.

.PARAMETER Force
  Skip the interactive confirmation prompt.

.EXAMPLE
  ./payout.ps1 -PayeeType technician -PayeeId 6f1c... -AmountCents 2350 -PayoutReference "zelle-2026-06-20-001"

.EXAMPLE
  ./payout.ps1 -PayeeType company -PayeeId 2a9d... -AmountCents 50000 -PayoutReference "ach-batch-12"
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('company', 'technician')][string]$PayeeType,
  [Parameter(Mandatory = $true)][string]$PayeeId,
  [Parameter(Mandatory = $true)][ValidateRange(1, [int]::MaxValue)][int]$AmountCents,
  [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$PayoutReference,

  # ─── Environment config (defaults target staging) ──────────────────────────
  [string]$Region        = 'us-west-2',
  [string]$Profile       = 'lowleads-dev',
  [string]$BastionId     = 'i-03b56a0c4a47366e2',
  [string]$RdsHost       = 'lowleads-staging-postgres.czw488qy4lgl.us-west-2.rds.amazonaws.com',
  [int]$RdsPort          = 5432,
  [int]$LocalPort        = 55432,
  # Secret holding the DB connection string (or pass -DatabaseUrl directly).
  [string]$DbSecretId    = 'lowleads/staging/database',
  [string]$DatabaseUrl   = '',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

# Validate the payee id looks like a UUID before it ever reaches SQL.
if ($PayeeId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
  throw "PayeeId '$PayeeId' is not a valid UUID."
}

foreach ($cmd in @('aws', 'psql', 'session-manager-plugin')) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    throw "Required command '$cmd' not found on PATH. Install it before running this script."
  }
}

# ─── Resolve the database connection string ───────────────────────────────────
if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
  Write-Host "Fetching DB credentials from Secrets Manager ($DbSecretId)..."
  $secretRaw = aws secretsmanager get-secret-value `
    --secret-id $DbSecretId --query SecretString --output text `
    --region $Region --profile $Profile
  if ($LASTEXITCODE -ne 0) { throw "Failed to read secret $DbSecretId." }

  # The secret may be a bare URL or JSON with a url-ish field.
  if ($secretRaw.TrimStart().StartsWith('{')) {
    $obj = $secretRaw | ConvertFrom-Json
    $DatabaseUrl = $obj.databaseUrl ?? $obj.DATABASE_URL ?? $obj.url ?? $obj.connectionString
    if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
      throw "Could not find a connection-string field in secret $DbSecretId. Pass -DatabaseUrl explicitly."
    }
  }
  else {
    $DatabaseUrl = $secretRaw.Trim()
  }
}

# Rewrite host:port to the local forwarded endpoint, keep user/password/db/query.
$uri = [System.Uri]$DatabaseUrl
$userInfo = $uri.UserInfo                       # user:password
$dbName = $uri.AbsolutePath.TrimStart('/')      # database name
$query = $uri.Query                             # e.g. ?sslmode=no-verify
$localConn = "postgresql://$userInfo@127.0.0.1:$LocalPort/$dbName$query"

# ─── Confirm (real money) ─────────────────────────────────────────────────────
Write-Host ""
Write-Host "About to record a payout:" -ForegroundColor Yellow
Write-Host "  payee type : $PayeeType"
Write-Host "  payee id   : $PayeeId"
Write-Host ("  amount     : `${0:N2} ({1} cents)" -f ($AmountCents / 100), $AmountCents)
Write-Host "  reference  : $PayoutReference"
Write-Host "  database   : $dbName on $RdsHost (via bastion $BastionId)"
Write-Host ""
if (-not $Force) {
  $answer = Read-Host "Type 'yes' to proceed"
  if ($answer -ne 'yes') { Write-Host "Aborted."; exit 1 }
}

# ─── Open the SSM port-forward tunnel ─────────────────────────────────────────
Write-Host "Opening SSM tunnel $LocalPort -> ${RdsHost}:$RdsPort ..."
$params = @{
  host          = @($RdsHost)
  portNumber    = @("$RdsPort")
  localPortNumber = @("$LocalPort")
} | ConvertTo-Json -Compress

$tunnel = Start-Process -FilePath 'aws' -PassThru -NoNewWindow -ArgumentList @(
  'ssm', 'start-session',
  '--target', $BastionId,
  '--document-name', 'AWS-StartPortForwardingSessionToRemoteHost',
  '--parameters', $params,
  '--region', $Region,
  '--profile', $Profile
)

try {
  # Wait for the local port to accept connections (max ~20s).
  $ready = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    try {
      $test = New-Object System.Net.Sockets.TcpClient
      $test.Connect('127.0.0.1', $LocalPort)
      $test.Close()
      $ready = $true
      break
    }
    catch { }
  }
  if (-not $ready) { throw "Tunnel did not become ready on port $LocalPort." }

  # ─── Run the payout in a single atomic function call ────────────────────────
  # process_payout() raises (and rolls back) on bad payee / insufficient funds.
  $sql = @"
\set ON_ERROR_STOP on
SELECT id, payee_type, amount_cents, balance_after_cents, created_at
FROM process_payout(:'ptype'::escrow_payee_type, :'pid'::uuid, :amt::int, :'ref');
"@

  $env:PGCONNECT_TIMEOUT = '10'
  $result = $sql | psql $localConn `
    -v ptype=$PayeeType `
    -v pid=$PayeeId `
    -v amt=$AmountCents `
    -v ref=$PayoutReference `
    --no-psqlrc -X

  if ($LASTEXITCODE -ne 0) {
    throw "psql reported an error — payout was NOT recorded (transaction rolled back)."
  }

  Write-Host ""
  Write-Host "Payout recorded successfully:" -ForegroundColor Green
  Write-Host $result
}
finally {
  if ($tunnel -and -not $tunnel.HasExited) {
    Write-Host "Closing SSM tunnel..."
    Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
  }
}
