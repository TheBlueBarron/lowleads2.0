CREATE TYPE user_role AS ENUM ('company_owner', 'technician');

CREATE TYPE subscription_tier AS ENUM ('free', 'pro', 'enterprise');

CREATE TYPE subscription_status AS ENUM ('active', 'past_due', 'canceled', 'trialing');

CREATE TYPE lead_status AS ENUM ('pending', 'not_qualified', 'no_sale', 'sale');

CREATE TYPE listing_status AS ENUM ('draft', 'active', 'paused', 'archived');

CREATE TYPE escrow_transaction_type AS ENUM (
  'deposit',
  'reserve',
  'release',
  'fee',
  'refund',
  'replenish'
);
