CREATE TABLE leads (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id               UUID NOT NULL REFERENCES service_listings(id) ON DELETE RESTRICT,
  receiving_company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  submitter_user_id        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- Nullable: company owner can submit without a technician record
  technician_id            UUID REFERENCES technicians(id) ON DELETE RESTRICT,
  customer_first_name      VARCHAR(100) NOT NULL,
  customer_last_initial    CHAR(1) NOT NULL,
  -- All PII encrypted: AES-256-GCM envelope encryption via KMS
  -- Format: base64(encrypted_data_key):base64(iv):base64(tag):base64(ciphertext)
  customer_phone_encrypted TEXT NOT NULL,
  customer_email_encrypted TEXT,
  notes_encrypted          TEXT,
  status                   lead_status NOT NULL DEFAULT 'pending',
  -- Snapshot values at submission time — immutable after creation
  reward_cents             INTEGER NOT NULL CHECK (reward_cents >= 100),
  qualified_bonus_cents    INTEGER NOT NULL DEFAULT 0 CHECK (qualified_bonus_cents >= 0),
  -- Populated when receiver first opens contact info
  viewed_at                TIMESTAMPTZ,
  resolved_at              TIMESTAMPTZ,
  submitted_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Prevent terminal states from being changed (not_qualified, no_sale, sale are final)
CREATE OR REPLACE FUNCTION prevent_terminal_lead_status_change()
  RETURNS TRIGGER LANGUAGE plpgsql AS
$$
BEGIN
  IF OLD.status IN ('not_qualified', 'no_sale', 'sale') THEN
    RAISE EXCEPTION
      'lead_status_terminal: cannot change status from % — terminal state is immutable',
      OLD.status
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER leads_prevent_terminal_status_change
  BEFORE UPDATE OF status ON leads
  FOR EACH ROW EXECUTE FUNCTION prevent_terminal_lead_status_change();
