CREATE TABLE users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email               VARCHAR(255) UNIQUE NOT NULL,
  email_verified_at   TIMESTAMPTZ,
  -- Argon2id hash — never store plaintext passwords
  password_hash       TEXT NOT NULL,
  -- AES-256-GCM envelope-encrypted TOTP secret (KMS data key)
  mfa_secret          TEXT,
  -- Argon2id hashes of 8 backup codes, stored as JSON array
  mfa_backup_codes    JSONB,
  mfa_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  role                user_role NOT NULL,
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  last_login_at       TIMESTAMPTZ,
  -- Brute force protection: track consecutive failures
  login_attempts      SMALLINT NOT NULL DEFAULT 0
                        CHECK (login_attempts >= 0),
  locked_until        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
