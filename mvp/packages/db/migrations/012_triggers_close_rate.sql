-- ─── Close Rate Computed Column ───────────────────────────────────────────────
-- close_rate = sales / (sales + no_sales + not_qualified)
-- Stored directly on companies.close_rate_bps (integer basis points 0-10000)
-- Updated by trigger on every lead status transition to a terminal state.
-- Pending leads are excluded until resolved.

ALTER TABLE companies
  ADD COLUMN close_rate_bps SMALLINT,
  ADD COLUMN resolved_lead_count INTEGER NOT NULL DEFAULT 0;

-- A NULL close_rate_bps means "New" (zero resolved leads) — display "New" badge in UI

CREATE OR REPLACE FUNCTION update_company_close_rate()
  RETURNS TRIGGER LANGUAGE plpgsql AS
$$
DECLARE
  v_company_id UUID;
  v_sales      INTEGER;
  v_resolved   INTEGER;
BEGIN
  -- Only fire on transitions to terminal status
  IF NEW.status NOT IN ('sale', 'no_sale', 'not_qualified') THEN
    RETURN NEW;
  END IF;
  IF OLD.status IN ('sale', 'no_sale', 'not_qualified') THEN
    -- Already terminal — trigger on leads table prevents this, but belt-and-suspenders
    RETURN NEW;
  END IF;

  v_company_id := NEW.receiving_company_id;

  SELECT
    COUNT(*) FILTER (WHERE status = 'sale'),
    COUNT(*) FILTER (WHERE status IN ('sale', 'no_sale', 'not_qualified'))
  INTO v_sales, v_resolved
  FROM leads
  WHERE receiving_company_id = v_company_id;

  UPDATE companies
  SET
    close_rate_bps     = CASE WHEN v_resolved > 0
                              THEN ROUND((v_sales::NUMERIC / v_resolved) * 10000)::SMALLINT
                              ELSE NULL
                         END,
    resolved_lead_count = v_resolved,
    updated_at          = NOW()
  WHERE id = v_company_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER leads_update_close_rate
  AFTER UPDATE OF status ON leads
  FOR EACH ROW EXECUTE FUNCTION update_company_close_rate();
