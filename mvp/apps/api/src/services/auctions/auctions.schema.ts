import { Type, type Static } from '@sinclair/typebox';

export const AuctionParams = Type.Object({
  zip: Type.String({ minLength: 3, maxLength: 10 }),
  category_id: Type.String({ format: 'uuid' }),
});
export type AuctionParams = Static<typeof AuctionParams>;

export const PlaceBidBody = Type.Object({
  maxBidCents: Type.Integer({ minimum: 1 }),
});
export type PlaceBidBody = Static<typeof PlaceBidBody>;

export const AuctionStateResponse = Type.Object({
  zip: Type.String(),
  categoryId: Type.String(),
  periodMonth: Type.String(),
  status: Type.String(),
  currentPriceCents: Type.Number(),
  // Leader's company NAME only — never any bidder's max bid (§3.3).
  leaderCompanyName: Type.Union([Type.String(), Type.Null()]),
  leaderIsYou: Type.Boolean(),
  // The requesting company's own max — never another bidder's.
  yourMaxBidCents: Type.Union([Type.Number(), Type.Null()]),
  floorPriceCents: Type.Number(),
});

export const BidPlacedResponse = Type.Object({
  zip: Type.String(),
  categoryId: Type.String(),
  periodMonth: Type.String(),
  currentPriceCents: Type.Number(),
  leaderCompanyName: Type.Union([Type.String(), Type.Null()]),
  leaderIsYou: Type.Boolean(),
  yourMaxBidCents: Type.Number(),
});

export const CompanyBidsResponse = Type.Object({
  data: Type.Array(
    Type.Object({
      auctionId: Type.String(),
      zip: Type.String(),
      categoryId: Type.String(),
      periodMonth: Type.String(),
      status: Type.String(),
      yourMaxBidCents: Type.Number(),
      won: Type.Union([Type.Boolean(), Type.Null()]),
      clearingPriceCents: Type.Union([Type.Number(), Type.Null()]),
    }),
  ),
  total: Type.Number(),
});

export const BidCreditResponse = Type.Object({
  balanceCents: Type.Number(),
  transactions: Type.Array(
    Type.Object({
      id: Type.String(),
      type: Type.String(),
      amountCents: Type.Number(),
      auctionId: Type.Union([Type.String(), Type.Null()]),
      balanceAfterCents: Type.Number(),
      createdAt: Type.String(),
    }),
  ),
});

export const ResolveQuery = Type.Object({
  period: Type.Optional(Type.String({ description: 'YYYY-MM-01; defaults to current month' })),
});
export type ResolveQuery = Static<typeof ResolveQuery>;

export const ResolveResponse = Type.Object({
  resolved: Type.Number(),
});
