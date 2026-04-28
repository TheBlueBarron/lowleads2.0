-- Append-only immutable security and financial audit trail
CREATE TABLE audit_log (
  id                   BIGSERIAL PRIMARY KEY,
  event_type           VARCHAR(100) NOT NULL,
  actor_user_id        UUID,
  actor_ip             INET,
  target_resource_type VARCHAR(100),
  target_resource_id   UUID,
  -- Sanitized payload — no PII stored here
  payload              JSONB NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Intentionally no updated_at — this table is append-only
);

-- Enforce append-only at the DB level
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
  RETURNS TRIGGER LANGUAGE plpgsql AS
$$
BEGIN
  RAISE EXCEPTION
    'audit_immutable: audit_log is append-only — UPDATE and DELETE are prohibited'
    USING ERRCODE = 'P0003';
  RETURN NULL;
END;
$$;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
