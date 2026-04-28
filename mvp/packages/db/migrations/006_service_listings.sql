CREATE TABLE service_listings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  service_name          VARCHAR(255) NOT NULL,
  service_category      VARCHAR(100) NOT NULL,
  description           TEXT,
  -- Integer cents — never FLOAT. Min $1 reward enforced at application layer.
  reward_cents          INTEGER NOT NULL CHECK (reward_cents >= 100),
  qualified_bonus_cents INTEGER NOT NULL DEFAULT 0 CHECK (qualified_bonus_cents >= 0),
  max_concurrent_sales  SMALLINT NOT NULL DEFAULT 1 CHECK (max_concurrent_sales >= 1),
  active_lead_count     SMALLINT NOT NULL DEFAULT 0 CHECK (active_lead_count >= 0),
  -- reward_cents × max_concurrent_sales, enforced by trigger
  escrow_reserved_cents INTEGER NOT NULL DEFAULT 0 CHECK (escrow_reserved_cents >= 0),
  auto_replenish        BOOLEAN NOT NULL DEFAULT FALSE,
  status                listing_status NOT NULL DEFAULT 'draft',
  -- Auto-maintained by trigger for full-text search
  search_vector         TSVECTOR,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

CREATE TRIGGER service_listings_updated_at
  BEFORE UPDATE ON service_listings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Auto-update the search tsvector when service_name or description changes
CREATE OR REPLACE FUNCTION update_listing_search_vector()
  RETURNS TRIGGER LANGUAGE plpgsql AS
$$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.service_name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.service_category, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'C');
  RETURN NEW;
END;
$$;

CREATE TRIGGER service_listings_search_vector
  BEFORE INSERT OR UPDATE OF service_name, service_category, description
  ON service_listings
  FOR EACH ROW EXECUTE FUNCTION update_listing_search_vector();
