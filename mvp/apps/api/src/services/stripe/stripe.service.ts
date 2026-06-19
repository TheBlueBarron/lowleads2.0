import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import type Stripe from 'stripe';
import { getStripe, STRIPE_PRICE_IDS } from '../../lib/stripe.js';
import { NotFoundError, ValidationError, ConflictError } from '../../lib/errors.js';
import { type SubscriptionTier, MONTHLY_BID_CREDIT_CENTS } from '@lowleads/shared-types';

export interface StripeServiceDeps {
  db: Pool;
  log: FastifyBaseLogger;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  appUrl: string;
}

// ─── StripeService ────────────────────────────────────────────────────────────

export class StripeService {
  private get stripe(): Stripe {
    return getStripe(this.deps.stripeSecretKey);
  }

  constructor(private readonly deps: StripeServiceDeps) {}

  // ─── Get or create Stripe customer ─────────────────────────────────────────

  async getOrCreateCustomer(companyId: string): Promise<string> {
    const result = await this.deps.db.query<{
      stripe_customer_id: string | null;
      name: string;
    }>('SELECT stripe_customer_id, name FROM companies WHERE id = $1 AND deleted_at IS NULL', [
      companyId,
    ]);
    const company = result.rows[0];
    if (!company) throw new NotFoundError('Company');

    if (company.stripe_customer_id) return company.stripe_customer_id;

    // Fetch owner email
    const userResult = await this.deps.db.query<{ email: string }>(
      `SELECT email FROM users
       WHERE company_id = $1 AND role = 'company_owner' AND deleted_at IS NULL
       LIMIT 1`,
      [companyId],
    );
    const ownerEmail = userResult.rows[0]?.email;

    const customer = await this.stripe.customers.create({
      name: company.name,
      email: ownerEmail,
      metadata: { companyId },
    });

    await this.deps.db.query('UPDATE companies SET stripe_customer_id = $1 WHERE id = $2', [
      customer.id,
      companyId,
    ]);

    return customer.id;
  }

  // ─── Escrow deposit checkout session ───────────────────────────────────────

  async createDepositSession(companyId: string, amountCents: number, returnUrl: string) {
    if (amountCents < 1000) {
      throw new ValidationError('Minimum deposit is $10.00');
    }

    const customerId = await this.getOrCreateCustomer(companyId);

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: amountCents,
            product_data: {
              name: 'Lowleads Escrow Deposit',
              description: 'Funds deposited into your lead escrow balance',
            },
          },
        },
      ],
      success_url: `${returnUrl}?session_id={CHECKOUT_SESSION_ID}&type=deposit`,
      cancel_url: returnUrl,
      metadata: { companyId, type: 'escrow_deposit', amountCents: String(amountCents) },
    });

    return { sessionId: session.id, url: session.url ?? '' };
  }

  // ─── Subscription checkout ──────────────────────────────────────────────────

  async createSubscriptionSession(
    companyId: string,
    tier: 'pro' | 'enterprise',
    returnUrl: string,
  ) {
    const companyResult = await this.deps.db.query<{
      subscription_tier: SubscriptionTier;
      stripe_customer_id: string | null;
    }>(
      'SELECT subscription_tier, stripe_customer_id FROM companies WHERE id = $1 AND deleted_at IS NULL',
      [companyId],
    );
    const company = companyResult.rows[0];
    if (!company) throw new NotFoundError('Company');
    if (company.subscription_tier === tier) {
      throw new ConflictError(`Already on the ${tier} plan`);
    }

    const customerId = await this.getOrCreateCustomer(companyId);
    const priceId =
      tier === 'pro' ? STRIPE_PRICE_IDS.pro_monthly : STRIPE_PRICE_IDS.enterprise_monthly;

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${returnUrl}?session_id={CHECKOUT_SESSION_ID}&type=subscription`,
      cancel_url: returnUrl,
      metadata: { companyId, type: 'subscription', tier },
    });

    return { sessionId: session.id, url: session.url ?? '' };
  }

  // ─── Billing portal ─────────────────────────────────────────────────────────

  async createBillingPortal(companyId: string, returnUrl: string) {
    const customerId = await this.getOrCreateCustomer(companyId);
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return { url: session.url };
  }

  // ─── Webhook handler ────────────────────────────────────────────────────────

  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.deps.stripeWebhookSecret,
      );
    } catch {
      throw new ValidationError('Invalid webhook signature');
    }

    // Idempotency — skip if already processed
    const existing = await this.deps.db.query<{ processed: boolean }>(
      'SELECT processed FROM stripe_webhook_events WHERE stripe_event_id = $1',
      [event.id],
    );
    if (existing.rows[0]?.processed) return;

    // Upsert event record
    await this.deps.db.query(
      `INSERT INTO stripe_webhook_events (stripe_event_id, type, payload)
       VALUES ($1, $2, $3)
       ON CONFLICT (stripe_event_id) DO NOTHING`,
      [event.id, event.type, JSON.stringify(event)],
    );

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
          break;
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
          break;
        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
          break;
        case 'invoice.paid':
          await this.handleInvoicePaid(event.data.object as Stripe.Invoice);
          break;
        default:
          // Unhandled event types are recorded but not processed
          break;
      }

      await this.deps.db.query(
        `UPDATE stripe_webhook_events
         SET processed = TRUE, processed_at = NOW()
         WHERE stripe_event_id = $1`,
        [event.id],
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.deps.db.query(
        `UPDATE stripe_webhook_events SET error = $1 WHERE stripe_event_id = $2`,
        [message, event.id],
      );
      this.deps.log.error(
        { err, eventId: event.id, eventType: event.type },
        'Webhook handler failed',
      );
      throw err;
    }
  }

  // ─── Private webhook handlers ─────────────────────────────────────────────

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const { companyId, type, amountCents } = session.metadata ?? {};
    if (!companyId) return;

    if (type === 'escrow_deposit' && amountCents && session.payment_intent) {
      const amount = parseInt(amountCents, 10);
      const paymentIntentId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent.id;

      await this.deps.db.query(
        'UPDATE companies SET escrow_balance_cents = escrow_balance_cents + $1 WHERE id = $2',
        [amount, companyId],
      );
      const balResult = await this.deps.db.query<{ escrow_balance_cents: number }>(
        'SELECT escrow_balance_cents FROM companies WHERE id = $1',
        [companyId],
      );
      await this.deps.db.query(
        `INSERT INTO escrow_transactions
           (company_id, type, amount_cents, stripe_payment_intent_id, balance_after_cents)
         VALUES ($1, 'deposit', $2, $3, $4)`,
        [companyId, amount, paymentIntentId, balResult.rows[0]?.escrow_balance_cents ?? 0],
      );
    }
  }

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    const customerId =
      typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

    const tier = this.tierFromProductId(subscription);
    if (!tier) return;

    await this.deps.db.query(
      `UPDATE companies
       SET subscription_tier = $1, subscription_status = $2
       WHERE stripe_customer_id = $3`,
      [tier, subscription.status, customerId],
    );
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const customerId =
      typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

    await this.deps.db.query(
      `UPDATE companies
       SET subscription_tier = 'free', subscription_status = 'canceled', transaction_fee_bps = 800
       WHERE stripe_customer_id = $1`,
      [customerId],
    );
  }

  // A successful subscription charge (initial or monthly renewal) grants the
  // company $1,000 of accumulating bid credit. Event-level idempotency in
  // handleWebhook ensures one grant per invoice even if Stripe re-delivers.
  private async handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    // Only subscription invoices grant credit (not one-off escrow deposits).
    const reason = invoice.billing_reason;
    if (reason !== 'subscription_create' && reason !== 'subscription_cycle') return;

    const customerId =
      typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
    if (!customerId) return;

    const companyResult = await this.deps.db.query<{ id: string }>(
      `SELECT id FROM companies
       WHERE stripe_customer_id = $1 AND subscription_tier <> 'free' AND deleted_at IS NULL`,
      [customerId],
    );
    const companyId = companyResult.rows[0]?.id;
    if (!companyId) return;

    await this.grantBidCredit(companyId, MONTHLY_BID_CREDIT_CENTS);
  }

  // Increment a company's bid-credit balance and write the append-only ledger
  // row in one transaction. Exposed for the subscription webhook (and reusable).
  async grantBidCredit(companyId: string, amountCents: number): Promise<void> {
    const client = await this.deps.db.connect();
    try {
      await client.query('BEGIN');
      const balResult = await client.query<{ bid_credit_balance_cents: number }>(
        `UPDATE companies SET bid_credit_balance_cents = bid_credit_balance_cents + $1
         WHERE id = $2
         RETURNING bid_credit_balance_cents`,
        [amountCents, companyId],
      );
      const balanceAfter = balResult.rows[0]?.bid_credit_balance_cents ?? 0;
      await client.query(
        `INSERT INTO bid_credit_transactions
           (company_id, type, amount_cents, balance_after_cents)
         VALUES ($1, 'monthly_grant', $2, $3)`,
        [companyId, amountCents, balanceAfter],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Off-session card charge against the company's saved default payment method
  // (set up when they subscribed). Used for the auction cash top-up at
  // resolution. Returns the PaymentIntent id on success; throws on failure so
  // the caller can fall back to the next bidder.
  async chargeOffSession(
    companyId: string,
    amountCents: number,
    description: string,
  ): Promise<string> {
    const customerId = await this.getOrCreateCustomer(companyId);
    const intent = await this.stripe.paymentIntents.create({
      customer: customerId,
      amount: amountCents,
      currency: 'usd',
      off_session: true,
      confirm: true,
      payment_method_types: ['card'],
      description,
      metadata: { companyId, type: 'auction_cash_topup' },
    });
    if (intent.status !== 'succeeded') {
      throw new Error(`Off-session charge not completed (status: ${intent.status})`);
    }
    return intent.id;
  }

  private tierFromProductId(subscription: Stripe.Subscription): 'pro' | 'enterprise' | null {
    const item = subscription.items.data[0];
    if (!item) return null;
    const priceId = typeof item.price === 'string' ? item.price : item.price.id;
    if (priceId === STRIPE_PRICE_IDS.pro_monthly) return 'pro';
    if (priceId === STRIPE_PRICE_IDS.enterprise_monthly) return 'enterprise';
    return null;
  }
}
