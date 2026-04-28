CREATE TABLE technicians (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One-to-one with users
  user_id               UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  display_name          VARCHAR(255) NOT NULL,
  total_leads_submitted INTEGER NOT NULL DEFAULT 0 CHECK (total_leads_submitted >= 0),
  not_qualified_count   INTEGER NOT NULL DEFAULT 0 CHECK (not_qualified_count >= 0),
  -- Integer cents — never FLOAT
  total_earned_cents    INTEGER NOT NULL DEFAULT 0 CHECK (total_earned_cents >= 0),
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER technicians_updated_at
  BEFORE UPDATE ON technicians
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
