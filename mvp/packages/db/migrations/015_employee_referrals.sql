-- 015: Employee referral feature
-- Reuses the existing "technician" concept ("employee" is the product-facing name).
--  * Company join codes so employees can self-register into a company
--  * Per-technician escrow balance (mirrors companies.escrow_balance_cents)
--  * Ledger gains a payee dimension (company | technician) so the 50/50 reward
--    split and the manual payout path can be reported from one place
--  * A 'withdrawal' ledger type + process_payout() helper for manual payouts

-- ─── 'withdrawal' ledger type ───────────────────────────────────────────────
-- Added (and intentionally NOT used) in this migration. On PostgreSQL 12+ a new
-- enum value may be added inside a transaction as long as it is not referenced
-- in the same transaction — process_payout() below only references it at call
-- time (i.e. after this migration has committed).
ALTER TYPE escrow_transaction_type ADD VALUE IF NOT EXISTS 'withdrawal';

-- ─── Company join codes ─────────────────────────────────────────────────────
ALTER TABLE companies ADD COLUMN join_code VARCHAR(16);

-- Backfill existing companies with a deterministic, guaranteed-unique code
-- derived from their UUID. Owners can regenerate to get a fresh random code
-- post-deploy (POST /v1/companies/me/join-code/regenerate).
UPDATE companies
  SET join_code = upper(substr(md5(id::text), 1, 8))
  WHERE join_code IS NULL;

-- A DB-level default guarantees the NOT NULL is always satisfied even for
-- inserts that don't supply a code (the API still generates its own
-- collision-checked code on the register/regenerate paths; this is a fallback).
ALTER TABLE companies
  ALTER COLUMN join_code SET DEFAULT upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  ALTER COLUMN join_code SET NOT NULL;
CREATE UNIQUE INDEX idx_companies_join_code ON companies (join_code);

-- ─── Technician escrow balance ──────────────────────────────────────────────
ALTER TABLE technicians
  ADD COLUMN escrow_balance_cents INTEGER NOT NULL DEFAULT 0
    CHECK (escrow_balance_cents >= 0);

-- ─── Ledger: payee dimension ────────────────────────────────────────────────
CREATE TYPE escrow_payee_type AS ENUM ('company', 'technician');

ALTER TABLE escrow_transactions
  ADD COLUMN payee_type escrow_payee_type NOT NULL DEFAULT 'company';

ALTER TABLE escrow_transactions
  ADD COLUMN technician_id UUID REFERENCES technicians(id) ON DELETE RESTRICT;

-- Free-text reference for manual payouts (cheque number, Zelle ref, etc.).
ALTER TABLE escrow_transactions
  ADD COLUMN payout_reference VARCHAR(255);

-- A technician-payee row must name a technician; a company-payee row must not.
ALTER TABLE escrow_transactions
  ADD CONSTRAINT escrow_payee_consistent
  CHECK ((payee_type = 'technician') = (technician_id IS NOT NULL));

-- Lookups for the employee performance view and the technician payout path.
CREATE INDEX idx_escrow_technician
  ON escrow_transactions (technician_id, created_at DESC)
  WHERE technician_id IS NOT NULL;

-- ─── Manual payout helper ───────────────────────────────────────────────────
-- Atomically debits a company or technician escrow balance and writes the
-- matching append-only 'withdrawal' ledger row. Raises (rolling back) on an
-- unknown payee or insufficient funds, so a payout can never silently no-op.
-- Called by scripts/payout.ps1.
CREATE OR REPLACE FUNCTION process_payout(
  p_payee_type escrow_payee_type,
  p_payee_id   UUID,
  p_amount     INTEGER,
  p_reference  TEXT
) RETURNS escrow_transactions
LANGUAGE plpgsql AS
$$
DECLARE
  v_bal     INTEGER;
  v_company UUID;
  v_tx      escrow_transactions;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'payout amount must be positive (got %)', p_amount;
  END IF;

  IF p_payee_type = 'company' THEN
    SELECT escrow_balance_cents INTO v_bal
      FROM companies WHERE id = p_payee_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'company % not found', p_payee_id;
    END IF;
    IF v_bal < p_amount THEN
      RAISE EXCEPTION 'insufficient company balance: have %, need %', v_bal, p_amount;
    END IF;
    UPDATE companies SET escrow_balance_cents = escrow_balance_cents - p_amount
      WHERE id = p_payee_id;
    INSERT INTO escrow_transactions
      (company_id, type, amount_cents, balance_after_cents, payee_type, payout_reference)
      VALUES (p_payee_id, 'withdrawal', -p_amount, v_bal - p_amount, 'company', p_reference)
      RETURNING * INTO v_tx;

  ELSIF p_payee_type = 'technician' THEN
    SELECT escrow_balance_cents, company_id INTO v_bal, v_company
      FROM technicians WHERE id = p_payee_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'technician % not found', p_payee_id;
    END IF;
    IF v_bal < p_amount THEN
      RAISE EXCEPTION 'insufficient technician balance: have %, need %', v_bal, p_amount;
    END IF;
    UPDATE technicians SET escrow_balance_cents = escrow_balance_cents - p_amount
      WHERE id = p_payee_id;
    INSERT INTO escrow_transactions
      (company_id, technician_id, type, amount_cents, balance_after_cents, payee_type, payout_reference)
      VALUES (v_company, p_payee_id, 'withdrawal', -p_amount, v_bal - p_amount, 'technician', p_reference)
      RETURNING * INTO v_tx;

  ELSE
    RAISE EXCEPTION 'unknown payee type %', p_payee_type;
  END IF;

  RETURN v_tx;
END;
$$;
