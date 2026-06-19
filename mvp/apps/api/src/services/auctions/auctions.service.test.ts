import { describe, it, expect } from '@jest/globals';
import { computeAuctionOutcome, computeFloorCents } from './auctions.service.js';
import type { EffectiveBid } from './auctions.service.js';

// Amounts are in cents. $1 increment = 100 cents; $1,000 floor = 100_000 cents.

function bid(companyId: string, dollars: number, placedAt: number): EffectiveBid {
  return { companyId, maxBidCents: dollars * 100, placedAt };
}

describe('computeAuctionOutcome (§3.4 / §3.8 / §3.9)', () => {
  it('zero bidders → house (null leader) at the floor (§3.9)', () => {
    expect(computeAuctionOutcome([], 100_000)).toEqual({
      leaderCompanyId: null,
      clearingPriceCents: 100_000,
    });
  });

  it('single bidder → floor + $1, not the bare floor (§3.8)', () => {
    expect(computeAuctionOutcome([bid('A', 3000, 1)], 100_000)).toEqual({
      leaderCompanyId: 'A',
      clearingPriceCents: 100_100,
    });
  });

  it('matches the product worked example exactly (§3.4)', () => {
    // A maxes $2,000, B maxes $5,000 → leader B, price = A.max + $1 = $2,001.
    const afterB = computeAuctionOutcome([bid('A', 2000, 1), bid('B', 5000, 2)], 100_000);
    expect(afterB).toEqual({ leaderCompanyId: 'B', clearingPriceCents: 200_100 });

    // C then maxes $2,002 → leader still B; second-highest is now C → price $2,003.
    const afterC = computeAuctionOutcome(
      [bid('A', 2000, 1), bid('B', 5000, 2), bid('C', 2002, 3)],
      100_000,
    );
    expect(afterC).toEqual({ leaderCompanyId: 'B', clearingPriceCents: 200_300 });
  });

  it('clearing price never exceeds the leader max (capped)', () => {
    // Two bidders one increment apart: price caps at the leader's own max.
    const out = computeAuctionOutcome([bid('A', 2000, 1), bid('B', 2000.5, 2)], 100_000);
    // second = 200000, +100 = 200100, leader max = 200050 → capped to 200050.
    expect(out.leaderCompanyId).toBe('B');
    expect(out.clearingPriceCents).toBe(200_050);
  });

  it('breaks ties by earliest placement (§3.5)', () => {
    const earlierWins = computeAuctionOutcome([bid('A', 2000, 5), bid('B', 2000, 2)], 100_000);
    expect(earlierWins.leaderCompanyId).toBe('B'); // B placed earlier (2 < 5)
  });
});

describe('computeFloorCents (§3.7)', () => {
  it('uses the absolute floor when there is no prior auction', () => {
    expect(computeFloorCents(null, 100_000)).toBe(100_000);
  });

  it('halves the previous clearing price', () => {
    expect(computeFloorCents(400_000, 100_000)).toBe(200_000);
  });

  it('never drops below the absolute floor (decays to and stays there)', () => {
    expect(computeFloorCents(150_000, 100_000)).toBe(100_000); // 75k < 100k → floor
    expect(computeFloorCents(100_000, 100_000)).toBe(100_000); // 50k < 100k → floor
  });
});
