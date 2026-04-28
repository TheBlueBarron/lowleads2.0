-- ─── companies ────────────────────────────────────────────────────────────────
-- Slug lookup for invite flow and public profiles
CREATE UNIQUE INDEX idx_companies_slug ON companies(slug) WHERE deleted_at IS NULL;

-- ─── users ────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_company_id ON users(company_id);

-- ─── service_listings ─────────────────────────────────────────────────────────
-- Full-text search (GIN index for tsvector)
CREATE INDEX idx_listings_search_vector ON service_listings USING GIN(search_vector);

-- Category + status filter (most common search pattern)
CREATE INDEX idx_listings_category_status
  ON service_listings(service_category, status)
  WHERE deleted_at IS NULL;

-- Company's own listings
CREATE INDEX idx_listings_company_id
  ON service_listings(company_id)
  WHERE deleted_at IS NULL;

-- ─── leads ────────────────────────────────────────────────────────────────────
-- Primary inbox query: company lead inbox filtered by status
CREATE INDEX idx_leads_receiving_company_status
  ON leads(receiving_company_id, status);

-- LIFO sort for inbox
CREATE INDEX idx_leads_submitted_at_desc
  ON leads(submitted_at DESC);

-- Compound index for inbox query with sort
CREATE INDEX idx_leads_inbox
  ON leads(receiving_company_id, status, submitted_at DESC);

-- Technician stats aggregation
CREATE INDEX idx_leads_technician_id
  ON leads(technician_id)
  WHERE technician_id IS NOT NULL;

-- Submitter's sent leads
CREATE INDEX idx_leads_submitter_user_id
  ON leads(submitter_user_id);

-- Listing's active leads (for concurrent slot enforcement)
CREATE INDEX idx_leads_listing_id_status
  ON leads(listing_id, status);

-- ─── escrow_transactions ──────────────────────────────────────────────────────
-- Payout history by company chronologically
CREATE INDEX idx_escrow_company_created
  ON escrow_transactions(company_id, created_at DESC);

-- Lead's escrow history
CREATE INDEX idx_escrow_lead_id
  ON escrow_transactions(lead_id)
  WHERE lead_id IS NOT NULL;

-- Idempotency: deduplicate Stripe payment intents
CREATE UNIQUE INDEX idx_escrow_stripe_payment_intent
  ON escrow_transactions(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- ─── audit_log ────────────────────────────────────────────────────────────────
-- Security review: all actions by a user
CREATE INDEX idx_audit_actor_created
  ON audit_log(actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;

-- All events on a specific resource
CREATE INDEX idx_audit_resource
  ON audit_log(target_resource_type, target_resource_id, created_at DESC)
  WHERE target_resource_id IS NOT NULL;

-- Event type queries (e.g., all escrow.released events)
CREATE INDEX idx_audit_event_type_created
  ON audit_log(event_type, created_at DESC);
