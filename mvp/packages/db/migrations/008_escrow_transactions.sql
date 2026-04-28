-- Append-only financial ledger — no UPDATE or DELETE ever allowed
CREATE TABLE escrow_transactions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  -- Nullable for company-level deposits/withdrawals not tied to a specific lead
  lead_id                   UUID REFERENCES leads(id) ON DELETE RESTRICT,
  type                      escrow_transaction_type NOT NULL,
  -- Integer cents — never FLOAT
  amount_cents              INTEGER NOT NULL,
  stripe_payment_intent_id  VARCHAR(255),
  stripe_transfer_id        VARCHAR(255),
  -- Running balance snapshot at time of transaction
  balance_after_cents       INTEGER NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Intentionally no updated_at — this table is append-only
);

-- Enforce append-only: no updates or deletes permitted at the DB level
CREATE OR REPLACE FUNCTION prevent_escrow_mutation()
  RETURNS TRIGGER LANGUAGE plpgsql AS
$$
BEGIN
  RAISE EXCEPTION
    'escrow_immutable: escrow_transactions is append-only — UPDATE and DELETE are prohibited'
    USING ERRCODE = 'P0002';
  RETURN NULL;
END;
$$;

CREATE TRIGGER escrow_no_update
  BEFORE UPDATE ON escrow_transactions
  FOR EACH ROW EXECUTE FUNCTION prevent_escrow_mutation();

CREATE TRIGGER escrow_no_delete
  BEFORE DELETE ON escrow_transactions
  FOR EACH ROW EXECUTE FUNCTION prevent_escrow_mutation();
