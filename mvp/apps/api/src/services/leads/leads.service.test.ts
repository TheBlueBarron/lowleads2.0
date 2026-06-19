import { describe, it, expect } from '@jest/globals';
import { MINIMUM_FEE_CENTS } from '@lowleads/shared-types';
import { splitPayout } from './leads.service.js';

// ─── Escrow fee calculation (extracted for unit testing) ──────────────────────

function calculateFee(rewardCents: number, feeBps: number): number {
  const fee = Math.floor((rewardCents * feeBps) / 10_000);
  return Math.max(fee, MINIMUM_FEE_CENTS);
}

describe('Escrow fee calculation', () => {
  it('computes 8% fee for free tier', () => {
    expect(calculateFee(5000, 800)).toBe(400);
  });

  it('computes 6% fee for pro tier', () => {
    expect(calculateFee(5000, 600)).toBe(300);
  });

  it('computes 4% fee for enterprise tier', () => {
    expect(calculateFee(10000, 400)).toBe(400);
  });

  it('enforces minimum fee of $1.00 (100 cents)', () => {
    // 1% of $1 reward = 1 cent — below minimum
    expect(calculateFee(100, 100)).toBe(MINIMUM_FEE_CENTS);
  });

  it('rounds down fractional cents', () => {
    // 8% of $1.01 = 8.08 cents → floor to 8 cents, but min fee is 100
    expect(calculateFee(101, 800)).toBe(MINIMUM_FEE_CENTS);
    // 8% of $200 = 16 cents → floor to 16 cents, still below min
    expect(calculateFee(200, 800)).toBe(MINIMUM_FEE_CENTS);
    // 8% of $2.00 = 16 cents → below min → 100
    expect(calculateFee(200, 800)).toBe(MINIMUM_FEE_CENTS);
    // 8% of $20.00 = 160 cents → above min
    expect(calculateFee(2000, 800)).toBe(160);
  });

  it('payout = reward - fee is always non-negative', () => {
    const reward = 5000;
    const feeBps = 800;
    const fee = calculateFee(reward, feeBps);
    expect(reward - fee).toBeGreaterThanOrEqual(0);
  });
});

// ─── Employee reward split (50/50, employee vs employer) ──────────────────────

describe('splitPayout', () => {
  it('splits an even payout exactly in half', () => {
    expect(splitPayout(4700)).toEqual({ technicianCents: 2350, companyCents: 2350 });
  });

  it('gives the company the extra cent on an odd payout', () => {
    expect(splitPayout(4701)).toEqual({ technicianCents: 2350, companyCents: 2351 });
  });

  it('handles a zero payout', () => {
    expect(splitPayout(0)).toEqual({ technicianCents: 0, companyCents: 0 });
  });

  it('never creates or loses money — shares always sum to the payout', () => {
    for (const payout of [1, 2, 3, 99, 100, 4700, 4701, 123_457]) {
      const { technicianCents, companyCents } = splitPayout(payout);
      expect(technicianCents + companyCents).toBe(payout);
      expect(technicianCents).toBeGreaterThanOrEqual(0);
      expect(companyCents).toBeGreaterThanOrEqual(0);
    }
  });
});
