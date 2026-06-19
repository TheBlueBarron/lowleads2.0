/**
 * Integration tests for the "Recommended" auction subsystem:
 *  - bid eligibility gating (Pro + active listing in the leaf category)
 *  - proxy/Vickrey pricing end-to-end (the product worked example)
 *  - no-lowering / below-floor rejection
 *  - resolution: credit drawdown, cash top-up via Stripe, fallback-to-next-bidder
 *  - house-won (zero-bidder) outcome
 *  - the lead-submission ranked list with the Recommended winner pinned
 *
 * Stripe is stubbed (no live calls). Requires docker-compose.test.yml.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { getPrimaryPool } from '@lowleads/db';
import { AuctionService, type StripeCharger } from './auctions.service.js';
import { LeadService } from '../leads/leads.service.js';

const TEST_DB_URL =
  process.env['TEST_DATABASE_URL'] ??
  'postgresql://lowleads_test:lowleads_test@localhost:5433/lowleads_test';
const TEST_REDIS_URL = process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6380';

const TEST_SECRETS = {
  databaseUrl: TEST_DB_URL,
  databaseReplicaUrl: undefined,
  redisUrl: TEST_REDIS_URL,
  jwtAccessSecret: 'auction-test-access-secret-32char',
  jwtRefreshHmacSecret: 'auction-test-refresh',
  jwtEmailSecret: 'auction-test-email',
  jwtPasswordResetSecret: 'auction-test-pwreset',
  cookieSecret: 'auction-test-cookie-secret-32char',
  kmsKeyId: 'test-kms-key',
  sesFromEmail: 'noreply@lowleads.com',
  resendApiKey: 'test-resend-key',
  stripeSecretKey: 'sk_test_placeholder',
  stripeWebhookSecret: 'whsec_placeholder',
  twilioAccountSid: 'placeholder',
  twilioAuthToken: 'placeholder',
};

let app: FastifyInstance;

// Stub Stripe charger — records calls and can be told to fail.
let chargeCalls: { companyId: string; amountCents: number }[] = [];
let chargeShouldFail = false;
const stubStripe: StripeCharger = {
  chargeOffSession(companyId, amountCents) {
    chargeCalls.push({ companyId, amountCents });
    if (chargeShouldFail) return Promise.reject(new Error('card_declined'));
    return Promise.resolve('pi_test_123');
  },
};

function makeService() {
  return new AuctionService({ db: getPrimaryPool(), log: app.log, stripe: stubStripe });
}

const ZIP = '85001';
let categoryId: string;

async function seedCategory() {
  const pool = getPrimaryPool();
  const res = await pool.query<{ id: string }>(
    `INSERT INTO categories (name, is_leaf) VALUES ('Roofing', TRUE) RETURNING id`,
  );
  return res.rows[0]!.id;
}

async function seedProCompany(slug: string, bidCredit = 0) {
  const pool = getPrimaryPool();
  const res = await pool.query<{ id: string }>(
    `INSERT INTO companies
       (name, slug, subscription_tier, subscription_status, transaction_fee_bps,
        escrow_balance_cents, bid_credit_balance_cents)
     VALUES ($1, $2, 'pro', 'active', 600, 0, $3) RETURNING id`,
    [`${slug} Co`, slug, bidCredit],
  );
  const companyId = res.rows[0]!.id;
  // Active listing in the category → bidding eligibility.
  await pool.query(
    `INSERT INTO service_listings
       (company_id, service_name, service_category, category_id, reward_cents, status,
        escrow_reserved_cents, max_concurrent_sales)
     VALUES ($1, 'Roof Repair', 'roofing', $2, 5000, 'active', 5000, 1)`,
    [companyId, categoryId],
  );
  return companyId;
}

beforeAll(async () => {
  app = await buildApp({
    ...TEST_SECRETS,
    port: 0,
    host: '127.0.0.1',
    appUrl: 'http://localhost:3000',
    logLevel: 'silent',
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  chargeCalls = [];
  chargeShouldFail = false;
  const pool = getPrimaryPool();
  await pool.query(`
    TRUNCATE category_auction_bids RESTART IDENTITY CASCADE;
    TRUNCATE bid_credit_transactions RESTART IDENTITY CASCADE;
    DELETE FROM category_auctions;
    DELETE FROM leads;
    DELETE FROM service_listings;
    DELETE FROM companies WHERE slug LIKE 'auc-%';
    DELETE FROM categories;
  `);
  categoryId = await seedCategory();
});

// ─── ELIGIBILITY ──────────────────────────────────────────────────────────────

describe('bid eligibility (§2)', () => {
  it('rejects a free-tier company', async () => {
    const pool = getPrimaryPool();
    const free = await pool.query<{ id: string }>(
      `INSERT INTO companies (name, slug, subscription_tier, join_code) VALUES ('F','auc-free','free','FREEAUC1') RETURNING id`,
    );
    await expect(
      makeService().placeBid(free.rows[0]!.id, ZIP, categoryId, 150_000),
    ).rejects.toThrow(/Pro membership/i);
  });

  it('rejects a Pro company with no listing in the category', async () => {
    const pool = getPrimaryPool();
    const pro = await pool.query<{ id: string }>(
      `INSERT INTO companies (name, slug, subscription_tier, subscription_status, join_code)
       VALUES ('P','auc-nolisting','pro','active','NOLST001') RETURNING id`,
    );
    await expect(makeService().placeBid(pro.rows[0]!.id, ZIP, categoryId, 150_000)).rejects.toThrow(
      /active listing/i,
    );
  });
});

// ─── PRICING (worked example) ───────────────────────────────────────────────

describe('proxy pricing (§3.4)', () => {
  it('reproduces the product worked example and hides rivals max bids', async () => {
    const svc = makeService();
    const a = await seedProCompany('auc-a');
    const b = await seedProCompany('auc-b');
    const c = await seedProCompany('auc-c');

    await svc.placeBid(a, ZIP, categoryId, 200_000); // A maxes $2,000
    const afterB = await svc.placeBid(b, ZIP, categoryId, 500_000); // B maxes $5,000
    expect(afterB.currentPriceCents).toBe(200_100); // A.max + $1
    expect(afterB.leaderIsYou).toBe(true); // B is the bidder here

    const afterC = await svc.placeBid(c, ZIP, categoryId, 200_200); // C maxes $2,002
    expect(afterC.currentPriceCents).toBe(200_300); // C.max + $1
    expect(afterC.leaderIsYou).toBe(false); // B still leads, not C

    // A's view never exposes B's or C's max — only A's own.
    const aView = await svc.getCurrent(ZIP, categoryId, a);
    expect(aView.currentPriceCents).toBe(200_300);
    expect(aView.leaderIsYou).toBe(false);
    expect(aView.yourMaxBidCents).toBe(200_000);
    expect(aView).not.toHaveProperty('bids');
  });

  it('rejects a below-floor bid and a non-raising bid', async () => {
    const svc = makeService();
    const a = await seedProCompany('auc-floor');
    await expect(svc.placeBid(a, ZIP, categoryId, 50_000)).rejects.toThrow(/floor/i);
    await svc.placeBid(a, ZIP, categoryId, 150_000);
    await expect(svc.placeBid(a, ZIP, categoryId, 150_000)).rejects.toThrow(/raised/i);
    await expect(svc.placeBid(a, ZIP, categoryId, 120_000)).rejects.toThrow(/raised/i);
  });
});

// ─── RESOLUTION ───────────────────────────────────────────────────────────────

describe('resolution (§3.9, §4.4)', () => {
  it('zero bidders → house-won at the floor, no money moves', async () => {
    const svc = makeService();
    const pool = getPrimaryPool();
    // Create an empty open auction row directly (lazy creation normally needs a bid).
    await pool.query(
      `INSERT INTO category_auctions (zip_code, category_id, period_month, floor_price_cents)
       VALUES ($1, $2, date_trunc('month', now())::date, 100000)`,
      [ZIP, categoryId],
    );
    await svc.resolveDuePeriod();
    const a = await pool.query<{
      winning_company_id: string | null;
      clearing_price_cents: number;
      status: string;
    }>(
      `SELECT winning_company_id, clearing_price_cents, status FROM category_auctions WHERE zip_code = $1`,
      [ZIP],
    );
    expect(a.rows[0]!.status).toBe('closed');
    expect(a.rows[0]!.winning_company_id).toBeNull();
    expect(a.rows[0]!.clearing_price_cents).toBe(100_000);
    expect(chargeCalls).toHaveLength(0);
  });

  it('draws down the winner credit by the clearing price (credit covers it)', async () => {
    const svc = makeService();
    const a = await seedProCompany('auc-win-a', 300_000); // $3,000 credit
    const b = await seedProCompany('auc-win-b', 0);
    await svc.placeBid(a, ZIP, categoryId, 200_000); // second
    await svc.placeBid(b, ZIP, categoryId, 250_000); // would be irrelevant; make A the winner instead
    // Make A the clear leader: A raises above B.
    await svc.placeBid(a, ZIP, categoryId, 400_000);
    // Clearing = B.max + $1 = 250_100, fully covered by A's $3,000 credit.

    await svc.resolveDuePeriod();

    const pool = getPrimaryPool();
    const auction = await pool.query<{ winning_company_id: string; clearing_price_cents: number }>(
      `SELECT winning_company_id, clearing_price_cents FROM category_auctions WHERE zip_code = $1`,
      [ZIP],
    );
    expect(auction.rows[0]!.winning_company_id).toBe(a);
    expect(auction.rows[0]!.clearing_price_cents).toBe(250_100);

    const credit = await pool.query<{ bid_credit_balance_cents: number }>(
      'SELECT bid_credit_balance_cents FROM companies WHERE id = $1',
      [a],
    );
    expect(credit.rows[0]!.bid_credit_balance_cents).toBe(300_000 - 250_100);
    expect(chargeCalls).toHaveLength(0); // no cash top-up needed

    const ledger = await pool.query<{ amount_cents: number; type: string }>(
      `SELECT amount_cents, type FROM bid_credit_transactions WHERE company_id = $1`,
      [a],
    );
    expect(ledger.rows[0]!.type).toBe('auction_win_drawdown');
    expect(ledger.rows[0]!.amount_cents).toBe(-250_100);
  });

  it('charges the cash shortfall off-session when credit is insufficient', async () => {
    const svc = makeService();
    const a = await seedProCompany('auc-cash-a', 100_000); // only $1,000 credit
    const b = await seedProCompany('auc-cash-b', 0);
    await svc.placeBid(b, ZIP, categoryId, 200_000); // second
    await svc.placeBid(a, ZIP, categoryId, 500_000); // leader; clearing = 200_100

    await svc.resolveDuePeriod();

    // Credit drawn to 0; shortfall (200_100 - 100_000 = 100_100) charged via Stripe.
    expect(chargeCalls).toEqual([{ companyId: a, amountCents: 100_100 }]);
    const pool = getPrimaryPool();
    const credit = await pool.query<{ bid_credit_balance_cents: number }>(
      'SELECT bid_credit_balance_cents FROM companies WHERE id = $1',
      [a],
    );
    expect(credit.rows[0]!.bid_credit_balance_cents).toBe(0);
  });

  it('falls back to the next bidder when the winner cash charge fails (§4.4)', async () => {
    chargeShouldFail = true;
    const svc = makeService();
    const a = await seedProCompany('auc-fb-a', 0); // top bidder, no credit → needs cash → will fail
    const b = await seedProCompany('auc-fb-b', 500_000); // next bidder, plenty of credit
    await svc.placeBid(b, ZIP, categoryId, 200_000);
    await svc.placeBid(a, ZIP, categoryId, 500_000); // A leads; clearing 200_100, all cash → fails

    await svc.resolveDuePeriod();

    const pool = getPrimaryPool();
    const auction = await pool.query<{ winning_company_id: string; clearing_price_cents: number }>(
      `SELECT winning_company_id, clearing_price_cents FROM category_auctions WHERE zip_code = $1`,
      [ZIP],
    );
    // A excluded after charge failure → B wins. With A gone, B is the lone bidder
    // → floor + $1 (§3.8).
    expect(auction.rows[0]!.winning_company_id).toBe(b);
    expect(auction.rows[0]!.clearing_price_cents).toBe(100_100);

    const audit = await pool.query(
      `SELECT id FROM audit_log WHERE event_type = 'auction.winner_charge_failed'`,
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── MONTHLY CREDIT GRANT ───────────────────────────────────────────────────

describe('bid credit', () => {
  it('exposes balance + ledger', async () => {
    const a = await seedProCompany('auc-credit', 250_000);
    const result = await makeService().getBidCredit(a);
    expect(result.balanceCents).toBe(250_000);
  });
});

// ─── RANKED COMPANY LIST (§5.1) ─────────────────────────────────────────────

describe('lead-submission ranked list (referCompanies)', () => {
  function leadService() {
    return new LeadService({
      db: getPrimaryPool(),
      log: app.log,
      kmsKeyId: 'test-kms-key',
      sesFromEmail: 'noreply@lowleads.com',
      appUrl: 'http://localhost:3000',
    });
  }

  it('pins the Recommended winner to position 1 regardless of score', async () => {
    const pool = getPrimaryPool();
    const submitter = await seedProCompany('auc-ref-sub');
    const winner = await seedProCompany('auc-ref-win'); // reward 5000 (default)
    const rich = await seedProCompany('auc-ref-rich');
    // Give 'rich' a much higher reward so it would outrank the winner by score.
    await pool.query('UPDATE service_listings SET reward_cents = 50000 WHERE company_id = $1', [
      rich,
    ]);

    // Record a closed auction the winner won for this ZIP×category.
    await pool.query(
      `INSERT INTO category_auctions
         (zip_code, category_id, period_month, floor_price_cents, status,
          winning_company_id, clearing_price_cents, resolved_at)
       VALUES ($1, $2, date_trunc('month', now())::date, 100000, 'closed', $3, 200000, NOW())`,
      [ZIP, categoryId, winner],
    );

    const result = await leadService().referCompanies(submitter, ZIP, categoryId);
    expect(result.data[0]!.companyId).toBe(winner);
    expect(result.data[0]!.recommended).toBe(true);
    // 'rich' has the higher score but is not pinned.
    expect(result.data.find((r) => r.companyId === rich)!.recommended).toBe(false);
  });

  it('excludes the submitter own listing and full listings (§5.4)', async () => {
    const pool = getPrimaryPool();
    const submitter = await seedProCompany('auc-ex-sub');
    const full = await seedProCompany('auc-ex-full');
    await pool.query(
      `UPDATE service_listings SET active_lead_count = 1, max_concurrent_sales = 1 WHERE company_id = $1`,
      [full],
    );
    const ok = await seedProCompany('auc-ex-ok');

    const result = await leadService().referCompanies(submitter, ZIP, categoryId);
    const ids = result.data.map((r) => r.companyId);
    expect(ids).toContain(ok);
    expect(ids).not.toContain(submitter); // self-referral excluded
    expect(ids).not.toContain(full); // at concurrency cap excluded
  });
});
