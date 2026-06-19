import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type Stripe from 'stripe';
import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';

// Mock the Stripe lib so we control constructEvent and the price-id mapping
// without real signature crypto or network.
jest.mock('../../lib/stripe.js', () => ({
  __esModule: true,
  getStripe: jest.fn(),
  STRIPE_PRICE_IDS: { pro_monthly: 'price_pro', enterprise_monthly: 'price_ent' },
}));

import { getStripe } from '../../lib/stripe.js';
import { StripeService } from './stripe.service.js';

const constructEvent = jest.fn();

interface Captured {
  sql: string;
  params: unknown[];
}

// A minimal Pool stub that records queries and answers the handful the webhook
// path issues. `companyTier` is what `SELECT id FROM companies` matches on so we
// can simulate "invoice.paid arrives while the company is still free".
function makeDb(opts: { companyFound: boolean }) {
  const calls: Captured[] = [];
  const clientCalls: string[] = [];

  const client = {
    query: jest.fn(async (sql: string) => {
      clientCalls.push(sql);
      if (sql.includes('RETURNING bid_credit_balance_cents')) {
        return { rows: [{ bid_credit_balance_cents: 100_000 }] };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };

  const db = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT id FROM companies')) {
        return { rows: opts.companyFound ? [{ id: 'comp_1' }] : [] };
      }
      return { rows: [] };
    }),
    connect: jest.fn(async () => client),
  } as unknown as Pool;

  return { db, calls, clientCalls };
}

const log = { error: jest.fn(), info: jest.fn(), warn: jest.fn() } as unknown as FastifyBaseLogger;

function makeService(db: Pool) {
  return new StripeService({
    db,
    log,
    stripeSecretKey: 'sk_test_x',
    stripeWebhookSecret: 'whsec_x',
    appUrl: 'https://app.test',
  });
}

beforeEach(() => {
  constructEvent.mockReset();
  (getStripe as jest.MockedFunction<typeof getStripe>).mockReturnValue({
    webhooks: { constructEvent },
  } as unknown as Stripe);
});

function findUpdate(calls: Captured[]): Captured | undefined {
  return calls.find((c) => /UPDATE companies\s+SET subscription_tier/.test(c.sql));
}

describe('StripeService.handleWebhook — subscription tier', () => {
  it('customer.subscription.created sets tier AND the matching fee bps (regression)', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_created',
      type: 'customer.subscription.created',
      data: {
        object: {
          customer: 'cus_1',
          status: 'active',
          items: { data: [{ price: { id: 'price_pro' } }] },
        },
      },
    });
    const { db, calls } = makeDb({ companyFound: true });
    await makeService(db).handleWebhook(Buffer.from('{}'), 'sig');

    const upd = findUpdate(calls);
    expect(upd).toBeDefined();
    // [tier, status, transactionFeeBps, customerId]
    expect(upd?.params).toEqual(['pro', 'active', 600, 'cus_1']);
  });

  it('customer.subscription.updated to enterprise applies the 400 bps fee', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_updated',
      type: 'customer.subscription.updated',
      data: {
        object: {
          customer: 'cus_2',
          status: 'active',
          items: { data: [{ price: { id: 'price_ent' } }] },
        },
      },
    });
    const { db, calls } = makeDb({ companyFound: true });
    await makeService(db).handleWebhook(Buffer.from('{}'), 'sig');

    expect(findUpdate(calls)?.params).toEqual(['enterprise', 'active', 400, 'cus_2']);
  });
});

describe('StripeService.handleWebhook — invoice.paid bid-credit grant', () => {
  it('grants credit on subscription_create even if the company is still on free (ordering)', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_invoice',
      type: 'invoice.paid',
      data: { object: { customer: 'cus_1', billing_reason: 'subscription_create' } },
    });
    const { db, calls, clientCalls } = makeDb({ companyFound: true });
    await makeService(db).handleWebhook(Buffer.from('{}'), 'sig');

    // The company lookup must NOT filter on subscription_tier <> 'free'.
    const lookup = calls.find((c) => c.sql.includes('SELECT id FROM companies'));
    expect(lookup?.sql).not.toMatch(/subscription_tier/);
    // And the grant ran: a monthly_grant ledger row was written.
    expect(clientCalls.some((s) => s.includes('INSERT INTO bid_credit_transactions'))).toBe(true);
    expect(clientCalls.some((s) => s.includes('monthly_grant'))).toBe(true);
  });

  it('ignores invoice.paid that is not a subscription create/cycle', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_invoice_manual',
      type: 'invoice.paid',
      data: { object: { customer: 'cus_1', billing_reason: 'manual' } },
    });
    const { db, clientCalls } = makeDb({ companyFound: true });
    await makeService(db).handleWebhook(Buffer.from('{}'), 'sig');

    expect(db.connect).not.toHaveBeenCalled();
    expect(clientCalls.length).toBe(0);
  });
});
