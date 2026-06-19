import type { Pool, PoolClient } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { NotFoundError, ValidationError, ForbiddenError, ConflictError } from '../../lib/errors.js';
import { BID_INCREMENT_CENTS, DEFAULT_AUCTION_FLOOR_CENTS } from '@lowleads/shared-types';

// Minimal surface the auction engine needs from Stripe — lets tests inject a
// stub (so CI makes no live Stripe calls) and keeps the dependency narrow.
export interface StripeCharger {
  chargeOffSession(companyId: string, amountCents: number, description: string): Promise<string>;
}

export interface AuctionServiceDeps {
  db: Pool;
  log: FastifyBaseLogger;
  stripe: StripeCharger;
}

// ─── Pure auction math (exact spec §3.4 / §3.7 / §3.8) ────────────────────────

export interface EffectiveBid {
  companyId: string;
  maxBidCents: number;
  /** epoch ms — earlier wins ties (§3.5) */
  placedAt: number;
}

/**
 * Recompute leader + clearing price from scratch over the full set of active
 * bids (§3.4). Ties broken by earliest placement (§3.5).
 *  - 0 bids → house (null leader), price = floor (§3.9)
 *  - 1 bid  → that bidder, price = floor + $1 increment, capped at their max (§3.8)
 *  - 2+     → top bidder, price = second-highest + $1, capped at leader's max (§3.4)
 */
export function computeAuctionOutcome(
  bids: EffectiveBid[],
  floorCents: number,
): { leaderCompanyId: string | null; clearingPriceCents: number } {
  if (bids.length === 0) {
    return { leaderCompanyId: null, clearingPriceCents: floorCents };
  }

  const sorted = [...bids].sort((a, b) => b.maxBidCents - a.maxBidCents || a.placedAt - b.placedAt);
  const leader = sorted[0]!;

  if (sorted.length === 1) {
    // §3.8 — a lone bidder pays one increment above the floor (capped at their max).
    return {
      leaderCompanyId: leader.companyId,
      clearingPriceCents: Math.min(floorCents + BID_INCREMENT_CENTS, leader.maxBidCents),
    };
  }

  const second = sorted[1]!;
  // §3.4 — second price + one increment, never exceeding the leader's own max.
  const price = Math.min(second.maxBidCents + BID_INCREMENT_CENTS, leader.maxBidCents);
  // Defensive assertion (§3.4): by sort order leader.max >= second.max, so this holds.
  if (price > leader.maxBidCents) {
    throw new Error('clearing price exceeded leader max — invariant violated');
  }
  return { leaderCompanyId: leader.companyId, clearingPriceCents: price };
}

/** §3.7 — floor decays by half each unsold month, bottoming at the absolute floor. */
export function computeFloorCents(
  previousClearingCents: number | null,
  absoluteFloorCents: number,
): number {
  if (previousClearingCents == null) return absoluteFloorCents;
  return Math.max(absoluteFloorCents, Math.floor(previousClearingCents / 2));
}

/** First-of-month ISO date string (YYYY-MM-01) for a given Date, in UTC. */
export function firstOfMonth(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

// ─── AuctionService ───────────────────────────────────────────────────────────

interface AuctionRow {
  id: string;
  zip_code: string;
  category_id: string;
  period_month: Date;
  floor_price_cents: number;
  status: string;
  winning_company_id: string | null;
  clearing_price_cents: number | null;
}

export class AuctionService {
  constructor(private readonly deps: AuctionServiceDeps) {}

  private currentPeriod(): string {
    return firstOfMonth(new Date());
  }

  // ─── Read current auction state (§6 GET .../current) ──────────────────────

  async getCurrent(zip: string, categoryId: string, requestingCompanyId: string) {
    const period = this.currentPeriod();
    const auctionResult = await this.deps.db.query<AuctionRow>(
      `SELECT * FROM category_auctions
       WHERE zip_code = $1 AND category_id = $2 AND period_month = $3`,
      [zip, categoryId, period],
    );
    const auction = auctionResult.rows[0];

    // No row yet (lazy creation) — nobody has bid this month.
    if (!auction) {
      const floor = await this.computeFloorForNew(this.deps.db, zip, categoryId, period);
      return {
        zip,
        categoryId,
        periodMonth: period,
        status: 'open' as const,
        currentPriceCents: floor,
        leaderCompanyName: null,
        leaderIsYou: false,
        yourMaxBidCents: null,
        floorPriceCents: floor,
      };
    }

    const bids = await this.effectiveBids(this.deps.db, auction.id);
    const outcome = computeAuctionOutcome(bids, auction.floor_price_cents);
    const yourMax = bids.find((b) => b.companyId === requestingCompanyId)?.maxBidCents ?? null;

    let leaderName: string | null = null;
    if (outcome.leaderCompanyId) {
      const nameResult = await this.deps.db.query<{ name: string }>(
        'SELECT name FROM companies WHERE id = $1',
        [outcome.leaderCompanyId],
      );
      leaderName = nameResult.rows[0]?.name ?? null;
    }

    return {
      zip,
      categoryId,
      periodMonth: period,
      status: auction.status as 'open' | 'closed',
      // While open this is the live price; once closed it's the clearing price.
      currentPriceCents:
        auction.status === 'closed'
          ? (auction.clearing_price_cents ?? outcome.clearingPriceCents)
          : outcome.clearingPriceCents,
      leaderCompanyName: leaderName,
      leaderIsYou: outcome.leaderCompanyId === requestingCompanyId,
      yourMaxBidCents: yourMax, // only ever the requester's own max
      floorPriceCents: auction.floor_price_cents,
    };
  }

  // ─── Place / raise a bid (§3.3, §6 POST .../bid) ──────────────────────────

  async placeBid(companyId: string, zip: string, categoryId: string, maxBidCents: number) {
    await this.assertCanBid(companyId, categoryId);

    const period = this.currentPeriod();
    const client = await this.deps.db.connect();
    try {
      await client.query('BEGIN');

      // Lazy-create the auction row (idempotent under concurrency), then lock it.
      let auction = await this.lockAuction(client, zip, categoryId, period);
      if (!auction) {
        const floor = await this.computeFloorForNew(client, zip, categoryId, period);
        await client.query(
          `INSERT INTO category_auctions (zip_code, category_id, period_month, floor_price_cents)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (zip_code, category_id, period_month) DO NOTHING`,
          [zip, categoryId, period, floor],
        );
        auction = await this.lockAuction(client, zip, categoryId, period);
      }
      if (!auction) throw new Error('Failed to create auction row');
      if (auction.status !== 'open') {
        throw new ConflictError('This auction is closed');
      }

      if (maxBidCents < auction.floor_price_cents) {
        throw new ValidationError(
          `Bid must be at least the floor price (${auction.floor_price_cents} cents)`,
        );
      }

      // No lowering, no equalling (§3.3): strictly greater than your current max.
      const currentMaxResult = await client.query<{ max_bid_cents: number }>(
        `SELECT MAX(max_bid_cents) AS max_bid_cents
         FROM category_auction_bids WHERE auction_id = $1 AND company_id = $2`,
        [auction.id, companyId],
      );
      const currentMax = currentMaxResult.rows[0]?.max_bid_cents ?? null;
      if (currentMax !== null && maxBidCents <= currentMax) {
        throw new ValidationError('A max bid can only be raised, never lowered or repeated');
      }

      await client.query(
        `INSERT INTO category_auction_bids (auction_id, company_id, max_bid_cents)
         VALUES ($1, $2, $3)`,
        [auction.id, companyId, maxBidCents],
      );

      const bids = await this.effectiveBids(client, auction.id);
      const outcome = computeAuctionOutcome(bids, auction.floor_price_cents);

      await client.query('COMMIT');

      let leaderName: string | null = null;
      if (outcome.leaderCompanyId) {
        const nameResult = await this.deps.db.query<{ name: string }>(
          'SELECT name FROM companies WHERE id = $1',
          [outcome.leaderCompanyId],
        );
        leaderName = nameResult.rows[0]?.name ?? null;
      }

      return {
        zip,
        categoryId,
        periodMonth: period,
        currentPriceCents: outcome.clearingPriceCents,
        leaderCompanyName: leaderName,
        leaderIsYou: outcome.leaderCompanyId === companyId,
        yourMaxBidCents: maxBidCents,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ─── Resolution (§3, §4.4) — called by the scheduler endpoint ─────────────

  /** Resolve every still-open auction for the given period (default: current month). */
  async resolveDuePeriod(periodMonth?: string): Promise<{ resolved: number }> {
    const period = periodMonth ?? this.currentPeriod();
    const due = await this.deps.db.query<{ id: string }>(
      `SELECT id FROM category_auctions WHERE status = 'open' AND period_month = $1`,
      [period],
    );
    let resolved = 0;
    for (const row of due.rows) {
      try {
        await this.resolveOne(row.id);
        resolved++;
      } catch (err) {
        this.deps.log.error({ err, auctionId: row.id }, 'Auction resolution failed');
      }
    }
    return { resolved };
  }

  /**
   * Resolve a single auction in its own transaction with a row lock (§8).
   * Draws down the winner's bid credit by the clearing price; if the clearing
   * price exceeds their credit, the shortfall is charged off-session via Stripe
   * (§4.4). On charge failure the bidder is excluded and resolution re-runs for
   * the next-highest bidder.
   */
  async resolveOne(auctionId: string): Promise<void> {
    const client = await this.deps.db.connect();
    try {
      await client.query('BEGIN');
      const auctionResult = await client.query<AuctionRow>(
        `SELECT * FROM category_auctions WHERE id = $1 FOR UPDATE`,
        [auctionId],
      );
      const auction = auctionResult.rows[0];
      if (!auction) throw new NotFoundError('Auction');
      if (auction.status !== 'open') {
        await client.query('ROLLBACK');
        return; // already resolved
      }

      const allBids = await this.effectiveBids(client, auctionId);
      const excluded = new Set<string>();

      for (;;) {
        const bids = allBids.filter((b) => !excluded.has(b.companyId));
        const outcome = computeAuctionOutcome(bids, auction.floor_price_cents);

        // House-won / unsold (§3.9) — bookkeeping only, no money moves.
        if (!outcome.leaderCompanyId) {
          await this.closeAuction(client, auctionId, null, auction.floor_price_cents);
          await client.query('COMMIT');
          return;
        }

        const winnerId = outcome.leaderCompanyId;
        const clearing = outcome.clearingPriceCents;

        const creditResult = await client.query<{ bid_credit_balance_cents: number }>(
          'SELECT bid_credit_balance_cents FROM companies WHERE id = $1 FOR UPDATE',
          [winnerId],
        );
        const credit = creditResult.rows[0]?.bid_credit_balance_cents ?? 0;
        const creditPortion = Math.min(clearing, credit);
        const cashPortion = clearing - creditPortion;

        if (cashPortion > 0) {
          try {
            await this.deps.stripe.chargeOffSession(
              winnerId,
              cashPortion,
              `Lowleads auction win — ${auction.zip_code} / ${auction.category_id} / ${firstOfMonth(auction.period_month)}`,
            );
          } catch (err) {
            // §4.4 — charge failed: flag, exclude, fall back to the next bidder.
            await this.writeAudit(client, {
              eventType: 'auction.winner_charge_failed',
              targetResourceId: winnerId,
              payload: { auctionId, cashPortion, clearing },
            });
            this.deps.log.error({ err, auctionId, winnerId }, 'Auction cash top-up failed');
            excluded.add(winnerId);
            continue;
          }
        }

        // Draw down the credit portion (cash portion was charged separately).
        if (creditPortion > 0) {
          const balResult = await client.query<{ bid_credit_balance_cents: number }>(
            `UPDATE companies SET bid_credit_balance_cents = bid_credit_balance_cents - $1
             WHERE id = $2 RETURNING bid_credit_balance_cents`,
            [creditPortion, winnerId],
          );
          await client.query(
            `INSERT INTO bid_credit_transactions
               (company_id, type, amount_cents, auction_id, balance_after_cents)
             VALUES ($1, 'auction_win_drawdown', $2, $3, $4)`,
            [winnerId, -creditPortion, auctionId, balResult.rows[0]?.bid_credit_balance_cents ?? 0],
          );
        }

        await this.closeAuction(client, auctionId, winnerId, clearing);
        await client.query('COMMIT');
        return;
      }
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ─── Company-facing reads (§6) ────────────────────────────────────────────

  async listCompanyBids(companyId: string) {
    const result = await this.deps.db.query<{
      auction_id: string;
      zip_code: string;
      category_id: string;
      period_month: Date;
      status: string;
      winning_company_id: string | null;
      clearing_price_cents: number | null;
      your_max_cents: number;
    }>(
      `SELECT a.id AS auction_id, a.zip_code, a.category_id, a.period_month, a.status,
              a.winning_company_id, a.clearing_price_cents,
              MAX(b.max_bid_cents) AS your_max_cents
       FROM category_auction_bids b
       JOIN category_auctions a ON a.id = b.auction_id
       WHERE b.company_id = $1
       GROUP BY a.id
       ORDER BY a.period_month DESC, a.zip_code`,
      [companyId],
    );
    return {
      data: result.rows.map((r) => ({
        auctionId: r.auction_id,
        zip: r.zip_code,
        categoryId: r.category_id,
        periodMonth: firstOfMonth(r.period_month),
        status: r.status,
        yourMaxBidCents: r.your_max_cents,
        // Only reveal win/loss + price once closed; never expose rivals' maxes.
        won: r.status === 'closed' ? r.winning_company_id === companyId : null,
        clearingPriceCents: r.status === 'closed' ? r.clearing_price_cents : null,
      })),
      total: result.rows.length,
    };
  }

  async getBidCredit(companyId: string) {
    const balResult = await this.deps.db.query<{ bid_credit_balance_cents: number }>(
      'SELECT bid_credit_balance_cents FROM companies WHERE id = $1 AND deleted_at IS NULL',
      [companyId],
    );
    const company = balResult.rows[0];
    if (!company) throw new NotFoundError('Company');

    const txResult = await this.deps.db.query<{
      id: string;
      type: string;
      amount_cents: number;
      auction_id: string | null;
      balance_after_cents: number;
      created_at: Date;
    }>(
      `SELECT id, type, amount_cents, auction_id, balance_after_cents, created_at
       FROM bid_credit_transactions
       WHERE company_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 100`,
      [companyId],
    );

    return {
      balanceCents: company.bid_credit_balance_cents,
      transactions: txResult.rows.map((r) => ({
        id: r.id,
        type: r.type,
        amountCents: r.amount_cents,
        auctionId: r.auction_id,
        balanceAfterCents: r.balance_after_cents,
        createdAt: r.created_at.toISOString(),
      })),
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async assertCanBid(companyId: string, categoryId: string): Promise<void> {
    // Hard Pro gate (§2): any paid, active subscription. Free tier can never bid.
    const companyResult = await this.deps.db.query<{
      subscription_tier: string;
      subscription_status: string | null;
    }>(
      'SELECT subscription_tier, subscription_status FROM companies WHERE id = $1 AND deleted_at IS NULL',
      [companyId],
    );
    const company = companyResult.rows[0];
    if (!company) throw new NotFoundError('Company');
    if (company.subscription_tier === 'free' || company.subscription_status !== 'active') {
      throw new ForbiddenError('An active Pro membership is required to bid');
    }

    // Category must be a leaf (§2).
    const catResult = await this.deps.db.query<{ is_leaf: boolean }>(
      'SELECT is_leaf FROM categories WHERE id = $1',
      [categoryId],
    );
    const category = catResult.rows[0];
    if (!category) throw new NotFoundError('Category');
    if (!category.is_leaf) {
      throw new ValidationError('Bidding is only allowed on leaf categories');
    }

    // Eligibility derived from holding an active (non-archived) listing here (§2).
    const listingResult = await this.deps.db.query<{ id: string }>(
      `SELECT id FROM service_listings
       WHERE company_id = $1 AND category_id = $2 AND status <> 'archived' AND deleted_at IS NULL
       LIMIT 1`,
      [companyId, categoryId],
    );
    if (listingResult.rows.length === 0) {
      throw new ForbiddenError('You can only bid in categories where you have an active listing');
    }
  }

  private async lockAuction(
    client: PoolClient,
    zip: string,
    categoryId: string,
    period: string,
  ): Promise<AuctionRow | undefined> {
    const result = await client.query<AuctionRow>(
      `SELECT * FROM category_auctions
       WHERE zip_code = $1 AND category_id = $2 AND period_month = $3
       FOR UPDATE`,
      [zip, categoryId, period],
    );
    return result.rows[0];
  }

  /** §3.7 — floor from the most recent EXISTING auction for this exact (zip, category). */
  private async computeFloorForNew(
    db: Pool | PoolClient,
    zip: string,
    categoryId: string,
    period: string,
  ): Promise<number> {
    const absoluteFloor = await this.absoluteFloorCents(db);
    const prevResult = await db.query<{ clearing_price_cents: number | null }>(
      `SELECT clearing_price_cents FROM category_auctions
       WHERE zip_code = $1 AND category_id = $2 AND period_month < $3
       ORDER BY period_month DESC
       LIMIT 1`,
      [zip, categoryId, period],
    );
    const prevClearing = prevResult.rows[0]?.clearing_price_cents ?? null;
    return computeFloorCents(prevClearing, absoluteFloor);
  }

  private async absoluteFloorCents(db: Pool | PoolClient): Promise<number> {
    const result = await db.query<{ value: string }>(
      `SELECT value FROM platform_config WHERE key = 'auction_absolute_floor_cents'`,
    );
    const parsed = parseInt(result.rows[0]?.value ?? '', 10);
    return Number.isFinite(parsed) ? parsed : DEFAULT_AUCTION_FLOOR_CENTS;
  }

  /** Per-company current effective (highest) bid for an auction. */
  private async effectiveBids(db: Pool | PoolClient, auctionId: string): Promise<EffectiveBid[]> {
    const result = await db.query<{
      company_id: string;
      max_bid_cents: number;
      placed_at_ms: string;
    }>(
      `SELECT DISTINCT ON (company_id)
              company_id, max_bid_cents,
              (EXTRACT(EPOCH FROM placed_at) * 1000)::bigint::text AS placed_at_ms
       FROM category_auction_bids
       WHERE auction_id = $1
       ORDER BY company_id, max_bid_cents DESC, placed_at ASC`,
      [auctionId],
    );
    return result.rows.map((r) => ({
      companyId: r.company_id,
      maxBidCents: r.max_bid_cents,
      placedAt: parseInt(r.placed_at_ms, 10),
    }));
  }

  private async closeAuction(
    client: PoolClient,
    auctionId: string,
    winnerId: string | null,
    clearingCents: number,
  ): Promise<void> {
    await client.query(
      `UPDATE category_auctions
       SET status = 'closed', winning_company_id = $1, clearing_price_cents = $2,
           resolved_at = NOW()
       WHERE id = $3`,
      [winnerId, clearingCents, auctionId],
    );
  }

  private async writeAudit(
    client: PoolClient,
    params: { eventType: string; targetResourceId: string; payload: Record<string, unknown> },
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_log (event_type, target_resource_type, target_resource_id, payload)
       VALUES ($1, 'category_auction', $2, $3)`,
      [params.eventType, params.targetResourceId, JSON.stringify(params.payload)],
    );
  }
}
