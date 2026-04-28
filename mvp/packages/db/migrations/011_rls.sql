-- ─── Row-Level Security ───────────────────────────────────────────────────────
-- RLS prevents cross-tenant data access even if application-layer auth fails.
-- The API connects with a role that sets app.current_company_id before queries.
-- Service-level migrations and analytics use a superuser role that bypasses RLS.

-- Create the application database role (non-superuser)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lowleads_api') THEN
    CREATE ROLE lowleads_api LOGIN;
  END IF;
END;
$$;

-- Grant table access to the API role
GRANT SELECT, INSERT, UPDATE ON companies TO lowleads_api;
GRANT SELECT, INSERT, UPDATE ON users TO lowleads_api;
GRANT SELECT, INSERT, UPDATE ON technicians TO lowleads_api;
GRANT SELECT, INSERT, UPDATE ON service_listings TO lowleads_api;
GRANT SELECT, INSERT, UPDATE ON leads TO lowleads_api;
GRANT SELECT, INSERT ON escrow_transactions TO lowleads_api;
GRANT SELECT, INSERT ON audit_log TO lowleads_api;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO lowleads_api;

-- ─── Enable RLS on all tables ─────────────────────────────────────────────────
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE technicians ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE escrow_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- ─── companies ────────────────────────────────────────────────────────────────
-- A company can only read/write its own record and its children (multi-location)
CREATE POLICY companies_isolation ON companies
  FOR ALL TO lowleads_api
  USING (
    id = current_setting('app.current_company_id', TRUE)::UUID
    OR parent_company_id = current_setting('app.current_company_id', TRUE)::UUID
  );

-- ─── users ────────────────────────────────────────────────────────────────────
CREATE POLICY users_isolation ON users
  FOR ALL TO lowleads_api
  USING (
    company_id = current_setting('app.current_company_id', TRUE)::UUID
  );

-- ─── technicians ──────────────────────────────────────────────────────────────
CREATE POLICY technicians_isolation ON technicians
  FOR ALL TO lowleads_api
  USING (
    company_id = current_setting('app.current_company_id', TRUE)::UUID
  );

-- ─── service_listings ─────────────────────────────────────────────────────────
-- Own listings (full access) + active listings from other companies (read-only for search)
CREATE POLICY listings_own ON service_listings
  FOR ALL TO lowleads_api
  USING (
    company_id = current_setting('app.current_company_id', TRUE)::UUID
  );

CREATE POLICY listings_search ON service_listings
  FOR SELECT TO lowleads_api
  USING (
    status = 'active' AND deleted_at IS NULL
  );

-- ─── leads ────────────────────────────────────────────────────────────────────
-- Submitter company can see leads they sent
-- Receiving company can see leads addressed to them
CREATE POLICY leads_access ON leads
  FOR ALL TO lowleads_api
  USING (
    receiving_company_id = current_setting('app.current_company_id', TRUE)::UUID
    OR submitter_user_id IN (
      SELECT id FROM users
      WHERE company_id = current_setting('app.current_company_id', TRUE)::UUID
    )
  );

-- ─── escrow_transactions ──────────────────────────────────────────────────────
CREATE POLICY escrow_isolation ON escrow_transactions
  FOR ALL TO lowleads_api
  USING (
    company_id = current_setting('app.current_company_id', TRUE)::UUID
  );

-- ─── audit_log ────────────────────────────────────────────────────────────────
-- Companies can only read their own audit events
CREATE POLICY audit_log_isolation ON audit_log
  FOR SELECT TO lowleads_api
  USING (
    actor_user_id IN (
      SELECT id FROM users
      WHERE company_id = current_setting('app.current_company_id', TRUE)::UUID
    )
    OR target_resource_id = current_setting('app.current_company_id', TRUE)::UUID
  );

CREATE POLICY audit_log_insert ON audit_log
  FOR INSERT TO lowleads_api
  WITH CHECK (TRUE);
