CREATE TABLE notification_preferences (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_new_lead              BOOLEAN NOT NULL DEFAULT TRUE,
  email_lead_resolved         BOOLEAN NOT NULL DEFAULT TRUE,
  email_low_escrow            BOOLEAN NOT NULL DEFAULT TRUE,
  -- Alert when escrow drops below this value (cents). Default $50.
  low_escrow_threshold_cents  INTEGER NOT NULL DEFAULT 5000 CHECK (low_escrow_threshold_cents >= 0),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER notification_preferences_updated_at
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS: users can only access their own preferences
GRANT SELECT, INSERT, UPDATE ON notification_preferences TO lowleads_api;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_preferences_isolation ON notification_preferences
  FOR ALL TO lowleads_api
  USING (
    user_id IN (
      SELECT id FROM users
      WHERE company_id = current_setting('app.current_company_id', TRUE)::UUID
    )
  );

-- RLS for stripe_webhook_events: service-level only (superuser), no API role access needed
