-- 016: "Recommended" tier — monthly proxy (Vickrey, second-price) auctions
-- One auction per (zip_code, leaf category, month). Winner gets pinned #1
-- placement in the lead-submission company-selection step for that month.

-- ─── Generic append-only guard (for the new ledgers/bid log) ────────────────
CREATE OR REPLACE FUNCTION prevent_append_only_mutation()
  RETURNS TRIGGER LANGUAGE plpgsql AS
$$
BEGIN
  RAISE EXCEPTION
    'append_only: % is append-only — UPDATE and DELETE are prohibited', TG_TABLE_NAME
    USING ERRCODE = 'P0002';
  RETURN NULL;
END;
$$;

-- ─── Platform config (typed key/value) ──────────────────────────────────────
CREATE TABLE platform_config (
  key        VARCHAR(100) PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER platform_config_updated_at
  BEFORE UPDATE ON platform_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Absolute floor for any auction, in integer cents ($1,000.00). Configurable (3.7).
INSERT INTO platform_config (key, value) VALUES ('auction_absolute_floor_cents', '100000');

-- ─── Categories (curated taxonomy; content seeded separately) ───────────────
CREATE TABLE categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id  UUID REFERENCES categories(id) ON DELETE RESTRICT,
  name       VARCHAR(255) NOT NULL,
  is_leaf    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_categories_parent ON categories (parent_id);
CREATE TRIGGER categories_updated_at
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Listings reference a leaf category. Nullable until the taxonomy is populated
-- and existing free-text service_category values are mapped over (content task).
-- Bidding eligibility derives from this column (active listing in a category).
ALTER TABLE service_listings
  ADD COLUMN category_id UUID REFERENCES categories(id) ON DELETE RESTRICT;
CREATE INDEX idx_listings_category ON service_listings (category_id)
  WHERE category_id IS NOT NULL;

-- ─── Bid credit on companies ────────────────────────────────────────────────
ALTER TABLE companies
  ADD COLUMN bid_credit_balance_cents INTEGER NOT NULL DEFAULT 0
    CHECK (bid_credit_balance_cents >= 0);

-- ─── Auctions ───────────────────────────────────────────────────────────────
CREATE TYPE auction_status AS ENUM ('open', 'closed');

CREATE TABLE category_auctions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zip_code             VARCHAR(10) NOT NULL,
  category_id          UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  -- First-of-month; the month the placement is effective.
  period_month         DATE NOT NULL,
  floor_price_cents    INTEGER NOT NULL,
  status               auction_status NOT NULL DEFAULT 'open',
  -- NULL = house-won / unsold (no real company gets placement).
  winning_company_id   UUID REFERENCES companies(id) ON DELETE RESTRICT,
  clearing_price_cents INTEGER,
  resolved_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (zip_code, category_id, period_month)
);
CREATE INDEX idx_auctions_resolve ON category_auctions (status, period_month);
CREATE TRIGGER category_auctions_updated_at
  BEFORE UPDATE ON category_auctions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Bid credit ledger (append-only) ────────────────────────────────────────
CREATE TYPE bid_credit_transaction_type AS ENUM ('monthly_grant', 'auction_win_drawdown');

CREATE TABLE bid_credit_transactions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  type                bid_credit_transaction_type NOT NULL,
  -- Positive for grants, negative for drawdowns.
  amount_cents        INTEGER NOT NULL,
  auction_id          UUID REFERENCES category_auctions(id) ON DELETE RESTRICT,
  balance_after_cents INTEGER NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_bid_credit_company_created
  ON bid_credit_transactions (company_id, created_at DESC);
CREATE TRIGGER bid_credit_no_update BEFORE UPDATE ON bid_credit_transactions
  FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();
CREATE TRIGGER bid_credit_no_delete BEFORE DELETE ON bid_credit_transactions
  FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

-- ─── Bids (append-only — a raise inserts a new row) ─────────────────────────
CREATE TABLE category_auction_bids (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id    UUID NOT NULL REFERENCES category_auctions(id) ON DELETE RESTRICT,
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  -- The bidder's true ceiling. Never exposed to any other company.
  max_bid_cents INTEGER NOT NULL CHECK (max_bid_cents > 0),
  placed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Sort key for resolution: highest max first, earliest placement breaks ties.
CREATE INDEX idx_auction_bids_resolve
  ON category_auction_bids (auction_id, max_bid_cents DESC, placed_at ASC);
CREATE INDEX idx_auction_bids_company ON category_auction_bids (company_id, created_at DESC);
CREATE TRIGGER auction_bids_no_update BEFORE UPDATE ON category_auction_bids
  FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();
CREATE TRIGGER auction_bids_no_delete BEFORE DELETE ON category_auction_bids
  FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

-- ─── Leads: address-first submission flow ───────────────────────────────────
ALTER TABLE leads
  -- AES-256-GCM via KMS, same pattern as notes_encrypted.
  ADD COLUMN customer_address_street_encrypted TEXT,
  -- NOT encrypted — must be queryable to join against category_auctions.zip_code.
  ADD COLUMN customer_zip VARCHAR(10);
CREATE INDEX idx_leads_customer_zip ON leads (customer_zip) WHERE customer_zip IS NOT NULL;
