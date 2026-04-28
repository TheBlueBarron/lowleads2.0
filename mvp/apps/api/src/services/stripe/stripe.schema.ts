import { Type, type Static } from '@sinclair/typebox';

export const CreateDepositSessionBody = Type.Object({
  amountCents: Type.Number({
    minimum: 1000,
    description: 'Minimum $10.00 deposit',
  }),
  returnUrl: Type.String({ format: 'uri' }),
});
export type CreateDepositSessionBody = Static<typeof CreateDepositSessionBody>;

export const CreateSubscriptionSessionBody = Type.Object({
  tier: Type.Union([Type.Literal('pro'), Type.Literal('enterprise')]),
  returnUrl: Type.String({ format: 'uri' }),
});
export type CreateSubscriptionSessionBody = Static<typeof CreateSubscriptionSessionBody>;

export const BillingPortalBody = Type.Object({
  returnUrl: Type.String({ format: 'uri' }),
});
export type BillingPortalBody = Static<typeof BillingPortalBody>;

export const CheckoutSessionResponse = Type.Object({
  sessionId: Type.String(),
  url: Type.String(),
});

export const BillingPortalResponse = Type.Object({
  url: Type.String(),
});
