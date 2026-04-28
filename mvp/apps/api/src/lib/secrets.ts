import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

export interface AppSecrets {
  databaseUrl: string;
  databaseReplicaUrl: string | undefined;
  redisUrl: string;
  jwtAccessSecret: string;
  jwtRefreshHmacSecret: string;
  jwtEmailSecret: string;
  jwtPasswordResetSecret: string;
  cookieSecret: string;
  kmsKeyId: string;
  sesFromEmail: string;
  // Placeholders populated in Phase 2
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
}

const SECRET_NAMES = {
  database: 'lowleads/database',
  redis: 'lowleads/redis',
  jwt: 'lowleads/jwt',
  kms: 'lowleads/kms',
  ses: 'lowleads/ses',
  stripe: 'lowleads/stripe',
  twilio: 'lowleads/twilio',
} as const;

// Cache secrets in memory for the process lifetime — avoids per-request latency
let cached: AppSecrets | null = null;

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Required environment variable ${name} is not set`);
  return val;
}

// In test/dev mode, secrets are loaded from environment variables.
// In production, they are fetched from AWS Secrets Manager.
async function fetchFromSecretsManager(): Promise<AppSecrets> {
  const region = process.env['AWS_REGION'] ?? 'us-west-2';
  const profile = process.env['AWS_PROFILE'];

  const client = new SecretsManagerClient({
    region,
    ...(profile ? { credentials: undefined } : {}),
  });

  async function getSecret(secretName: string): Promise<Record<string, string>> {
    const response = await client.send(
      new GetSecretValueCommand({ SecretId: secretName }),
    );
    if (!response.SecretString) {
      throw new Error(`Secret ${secretName} has no string value`);
    }
    return JSON.parse(response.SecretString) as Record<string, string>;
  }

  const [db, redis, jwt, kms, ses, stripe, twilio] = await Promise.all([
    getSecret(SECRET_NAMES.database),
    getSecret(SECRET_NAMES.redis),
    getSecret(SECRET_NAMES.jwt),
    getSecret(SECRET_NAMES.kms),
    getSecret(SECRET_NAMES.ses),
    getSecret(SECRET_NAMES.stripe),
    getSecret(SECRET_NAMES.twilio),
  ]);

  return {
    databaseUrl: requireStringKey(db, 'url'),
    databaseReplicaUrl: db['replica_url'] ?? undefined,
    redisUrl: requireStringKey(redis, 'url'),
    jwtAccessSecret: requireStringKey(jwt, 'access_secret'),
    jwtRefreshHmacSecret: requireStringKey(jwt, 'refresh_hmac_secret'),
    jwtEmailSecret: requireStringKey(jwt, 'email_secret'),
    jwtPasswordResetSecret: requireStringKey(jwt, 'password_reset_secret'),
    cookieSecret: requireStringKey(jwt, 'cookie_secret'),
    kmsKeyId: requireStringKey(kms, 'key_id'),
    sesFromEmail: requireStringKey(ses, 'from_email'),
    stripeSecretKey: requireStringKey(stripe, 'secret_key'),
    stripeWebhookSecret: requireStringKey(stripe, 'webhook_secret'),
    twilioAccountSid: requireStringKey(twilio, 'account_sid'),
    twilioAuthToken: requireStringKey(twilio, 'auth_token'),
  };
}

function requireStringKey(obj: Record<string, string>, key: string): string {
  const val = obj[key];
  if (!val) throw new Error(`Secret key "${key}" is missing or empty`);
  return val;
}

// For local dev: secrets from environment variables (never committed)
function loadFromEnv(): AppSecrets {
  return {
    databaseUrl: requireEnv('DATABASE_URL'),
    databaseReplicaUrl: process.env['DATABASE_REPLICA_URL'],
    redisUrl: requireEnv('REDIS_URL'),
    jwtAccessSecret: requireEnv('JWT_ACCESS_SECRET'),
    jwtRefreshHmacSecret: requireEnv('JWT_REFRESH_HMAC_SECRET'),
    jwtEmailSecret: requireEnv('JWT_EMAIL_SECRET'),
    jwtPasswordResetSecret: requireEnv('JWT_PASSWORD_RESET_SECRET'),
    cookieSecret: requireEnv('COOKIE_SECRET'),
    kmsKeyId: requireEnv('KMS_KEY_ID'),
    sesFromEmail: requireEnv('SES_FROM_EMAIL'),
    stripeSecretKey: process.env['STRIPE_SECRET_KEY'] ?? 'placeholder',
    stripeWebhookSecret: process.env['STRIPE_WEBHOOK_SECRET'] ?? 'placeholder',
    twilioAccountSid: process.env['TWILIO_ACCOUNT_SID'] ?? 'placeholder',
    twilioAuthToken: process.env['TWILIO_AUTH_TOKEN'] ?? 'placeholder',
  };
}

export async function loadSecrets(): Promise<AppSecrets> {
  if (cached) return cached;

  const env = process.env['NODE_ENV'];
  if (env === 'production' || env === 'staging') {
    cached = await fetchFromSecretsManager();
  } else {
    cached = loadFromEnv();
  }

  return cached;
}

// Only for testing — reset the cache between tests
export function _resetSecretsCache(): void {
  cached = null;
}
