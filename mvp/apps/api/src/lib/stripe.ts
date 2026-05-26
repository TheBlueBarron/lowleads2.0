import Stripe from 'stripe';

let stripeClient: Stripe | null = null;

export function getStripe(secretKey: string): Stripe {
  if (!stripeClient) {
    stripeClient = new Stripe(secretKey, {
      apiVersion: '2024-06-20',
      typescript: true,
    });
  }
  return stripeClient;
}

// Only for testing — reset the singleton between tests
export function _resetStripeClient(): void {
  stripeClient = null;
}

// Stripe product IDs for subscription tiers — set via env/config
export const STRIPE_PRICE_IDS = {
  pro_monthly: process.env['STRIPE_PRICE_PRO_MONTHLY'] ?? 'price_placeholder_pro',
  enterprise_monthly:
    process.env['STRIPE_PRICE_ENTERPRISE_MONTHLY'] ?? 'price_placeholder_enterprise',
} as const;
