import { Type, type Static } from '@sinclair/typebox';

export const UpdateCompanyBody = Type.Object({
  name: Type.Optional(Type.String({ minLength: 2, maxLength: 255 })),
  serviceArea: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { maxItems: 50 }),
  ),
});
export type UpdateCompanyBody = Static<typeof UpdateCompanyBody>;

export const CompanyResponse = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  slug: Type.String(),
  subscriptionTier: Type.String(),
  subscriptionStatus: Type.Union([Type.String(), Type.Null()]),
  transactionFeeBps: Type.Number(),
  escrowBalanceCents: Type.Number(),
  joinCode: Type.String(),
  bidCreditBalanceCents: Type.Number(),
  serviceArea: Type.Array(Type.String()),
  verifiedAt: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
});

export const JoinCodeResponse = Type.Object({
  joinCode: Type.String(),
});

export const EscrowBalanceResponse = Type.Object({
  balanceCents: Type.Number(),
  reservedCents: Type.Number(),
  availableCents: Type.Number(),
});

export const EscrowTransactionResponse = Type.Object({
  id: Type.String({ format: 'uuid' }),
  type: Type.String(),
  amountCents: Type.Number(),
  balanceAfterCents: Type.Number(),
  leadId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  stripePaymentIntentId: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
});

export const EscrowHistoryResponse = Type.Object({
  transactions: Type.Array(EscrowTransactionResponse),
  cursor: Type.Union([Type.String(), Type.Null()]),
  hasMore: Type.Boolean(),
});

export const EscrowHistoryQuery = Type.Object({
  cursor: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
});
export type EscrowHistoryQuery = Static<typeof EscrowHistoryQuery>;
