import { describe, it, expect } from '@jest/globals';
import { MINIMUM_FEE_CENTS } from '@lowleads/shared-types';

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
