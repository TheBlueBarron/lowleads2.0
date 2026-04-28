-- Idempotent log of received Stripe webhook events.
-- Unique on stripe_event_id to enforce exactly-once processing.
CREATE TABLE stripe_webhook_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id  VARCHAR(255) UNIQUE NOT NULL,
  type             VARCHAR(255) NOT NULL,
  processed        BOOLEAN NOT NULL DEFAULT FALSE,
  payload          JSONB NOT NULL,
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at     TIMESTAMPTZ
);

CREATE INDEX idx_stripe_webhook_events_type ON stripe_webhook_events (type);
CREATE INDEX idx_stripe_webhook_events_processed ON stripe_webhook_events (processed) WHERE processed = FALSE;
