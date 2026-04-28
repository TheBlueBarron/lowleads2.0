CREATE TABLE companies (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_company_id         UUID REFERENCES companies(id) ON DELETE RESTRICT,
  name                      VARCHAR(255) NOT NULL,
  slug                      VARCHAR(255) UNIQUE NOT NULL,
  stripe_customer_id        VARCHAR(255) UNIQUE,
  stripe_connect_account_id VARCHAR(255) UNIQUE,
  subscription_tier         subscription_tier NOT NULL DEFAULT 'free',
  subscription_status       subscription_status,
  -- Basis points: 800 = 8.00%, 600 = 6.00%, 400 = 4.00%
  transaction_fee_bps       SMALLINT NOT NULL DEFAULT 800
                              CHECK (transaction_fee_bps BETWEEN 0 AND 10000),
  -- Stored as integer cents — never FLOAT
  escrow_balance_cents      INTEGER NOT NULL DEFAULT 0
                              CHECK (escrow_balance_cents >= 0),
  service_area              TEXT[] NOT NULL DEFAULT '{}',
  verified_at               TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                TIMESTAMPTZ
);

-- Auto-update updated_at on any row change
CREATE OR REPLACE FUNCTION set_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS
$$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
