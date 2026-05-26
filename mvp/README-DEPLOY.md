# Deploying Lowleads to AWS

Authoritative deploy guide. Supersedes the loose notes in
`gettingitlive.txt` and `newyearnewme.txt` at the repo root.

---

## 0. One-time prerequisites (outside the repo)

- AWS account with an admin IAM user/SSO identity.
- `aws configure --profile lowleads-dev` — region `us-west-2` (matches the
  Terraform default).
- Local tools: Terraform ≥ 1.8, Docker, pnpm, AWS CLI v2.
- DNS control over `lowleads.com` (or change the hostnames in
  `mvp/.github/workflows/ci.yml` and `mvp/terraform/environments/*/main.tf`).
  Day-1 deploy works without DNS, but the staging deploy job will fail its
  `/health` smoke test until DNS + an ACM cert exist.

---

## 1. Bootstrap Terraform state storage

Creates only the S3 state bucket + DynamoDB lock table.

```sh
cd mvp/terraform/bootstrap
terraform init
terraform apply -var aws_account_id=<your-12-digit-id>
```

Note the `state_bucket_name` output — you'll paste it into `backend.hcl`
in step 3.

---

## 2. Bootstrap GitHub Actions OIDC + IAM roles

Creates the OIDC identity provider + the three IAM roles CI assumes:

- `github-actions-ecr` — push/pull on `lowleads/*` ECR repos (any branch).
- `github-actions-ecs-deploy` — update the staging ECS service
  (scoped to GitHub Environment `staging`).
- `github-actions-ecs-deploy-prod` — update the production ECS service
  (scoped to GitHub Environment `production`).

```sh
cd mvp/terraform/bootstrap-github-oidc
cp terraform.tfvars.example terraform.tfvars   # fill in account id + repo owner
terraform init
terraform apply
```

> ⚠️ This step did not exist in older notes — without it CI cannot
> authenticate to AWS at all.

---

## 3. Staging infrastructure

Provisions VPC, RDS Postgres, ElastiCache Redis, ECS Fargate, ALB,
CloudFront, ECR repo (`lowleads/staging/api`), KMS key, and ~7 empty
Secrets Manager entries.

```sh
cd mvp/terraform/environments/staging
cp backend.hcl.example backend.hcl             # fill in account id
cp terraform.tfvars.example terraform.tfvars   # fill in account id + db_password
terraform init -backend-config=backend.hcl
terraform apply
```

> **Two-pass quirk:** `main.tf:94` hardcodes a placeholder ECS task role
> ARN to break a circular dependency between the `secrets` and `ecs`
> modules. The first apply usually works; if it errors on the KMS key
> policy, just re-run `terraform apply` and it will reconcile.

---

## 4. Populate Secrets Manager

All seven secrets are created as `PLACEHOLDER` and must be filled by hand
(AWS Console or `aws secretsmanager update-secret`):

| Secret name                       | Keys                                                                                          | Source                                |
| --------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------- |
| `lowleads/staging/database`       | `url`, `replica_url`                                                                          | RDS outputs from step 3               |
| `lowleads/staging/redis`          | `url`                                                                                         | ElastiCache primary endpoint          |
| `lowleads/staging/jwt`            | `access_secret`, `refresh_hmac_secret`, `email_secret`, `password_reset_secret`, `cookie_secret` | Generate 5 random 64-byte hex strings |
| `lowleads/staging/ses`            | `from_email`                                                                                  | A verified SES sender identity        |
| `lowleads/staging/stripe`         | `secret_key`, `webhook_secret`                                                                | Stripe dashboard                      |
| `lowleads/staging/twilio`         | `account_sid`, `auth_token`                                                                   | Twilio console                        |

Suggested JWT secret generator (run 5 times):

```sh
openssl rand -hex 64
```

---

## 5. Run database migrations against RDS

From the bastion or a temporary EC2 inside the VPC (RDS is in isolated
subnets):

```sh
DATABASE_URL="<rds-url-from-step-3>" \
  pnpm --filter @lowleads/db migrate:up
```

---

## 6. GitHub repo configuration

In GitHub repo settings:

- **Secret** (Settings → Secrets and variables → Actions):
  - `AWS_ACCOUNT_ID` — your 12-digit AWS account ID.
  (That's the only secret CI reads — earlier notes overspec'd this.)

- **Environments** (Settings → Environments):
  - Create `staging` — no protections required.
  - Create `production` — add a **Required reviewers** rule. CI relies
    on this for manual approval gating between staging and prod deploys.

---

## 7. Push → deploy

Push to `main`. CI will:

1. Lint, typecheck, unit + integration tests, security scan.
2. Build Docker image, push to ECR (via OIDC role from step 2).
3. Deploy to ECS staging, smoke-test `https://staging-api.lowleads.com/health`.
4. Wait on manual approval, then deploy to ECS production and
   health-check `https://api.lowleads.com/health`.

> The smoke tests will fail until DNS + ACM cert exist. To make them
> pass, add `acm_certificate_arn` to the `ecs` module in
> `mvp/terraform/environments/staging/main.tf:78` and add the matching
> Route 53 record. Same for production.

---

## 8. Web frontend (Vercel — not in CI)

The Next.js frontend deploys independently:

- Import the repo to Vercel.
- Set the project root to `mvp/apps/web`.
- Set env `NEXT_PUBLIC_API_URL=https://staging-api.lowleads.com` (or the
  prod URL for the production deployment).

---

## Pre-launch checklist (things outside Terraform)

- [ ] DNS records (`staging-api`, `api`, `staging`, root) → Route 53.
- [ ] ACM certs in `us-west-2` (for ALB) and `us-east-1` (for CloudFront).
- [ ] Wire `acm_certificate_arn` into the `ecs` and `cloudfront` modules
      in both env `main.tf` files.
- [ ] Move SES out of sandbox via an AWS support ticket
      (sandbox only sends to verified addresses).
- [ ] Register the Stripe webhook endpoint pointing at the deployed
      API's `/webhooks/stripe` route.
- [ ] Verify the SES sender identity used in `lowleads/staging/ses`.
