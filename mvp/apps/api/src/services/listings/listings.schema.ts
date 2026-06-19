import { Type, type Static } from '@sinclair/typebox';

// ─── Request schemas ───────────────────────────────────────────────────────────

export const CreateListingBody = Type.Object({
  serviceName: Type.String({ minLength: 1, maxLength: 255 }),
  serviceCategory: Type.String({ minLength: 1, maxLength: 100 }),
  // Leaf category from the curated taxonomy. Drives auction bidding eligibility
  // and the Recommended ranking. Optional until the taxonomy is fully populated.
  categoryId: Type.Optional(Type.String({ format: 'uuid' })),
  description: Type.Optional(Type.String({ maxLength: 2000 })),
  rewardCents: Type.Number({
    minimum: 100,
    description: 'Reward in cents — minimum $1.00',
  }),
  qualifiedBonusCents: Type.Optional(Type.Number({ minimum: 0, default: 0 })),
  maxConcurrentSales: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 1 })),
  autoReplenish: Type.Optional(Type.Boolean({ default: false })),
});
export type CreateListingBody = Static<typeof CreateListingBody>;

export const UpdateListingBody = Type.Object({
  serviceName: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  serviceCategory: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  categoryId: Type.Optional(Type.String({ format: 'uuid' })),
  description: Type.Optional(Type.String({ maxLength: 2000 })),
  rewardCents: Type.Optional(Type.Number({ minimum: 100 })),
  qualifiedBonusCents: Type.Optional(Type.Number({ minimum: 0 })),
  maxConcurrentSales: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
  autoReplenish: Type.Optional(Type.Boolean()),
});
export type UpdateListingBody = Static<typeof UpdateListingBody>;

export const ListingIdParam = Type.Object({
  listingId: Type.String({ format: 'uuid' }),
});
export type ListingIdParam = Static<typeof ListingIdParam>;

export const ListingsQuery = Type.Object({
  cursor: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
  status: Type.Optional(
    Type.Union([
      Type.Literal('draft'),
      Type.Literal('active'),
      Type.Literal('paused'),
      Type.Literal('archived'),
    ]),
  ),
});
export type ListingsQuery = Static<typeof ListingsQuery>;

export const SearchListingsQuery = Type.Object({
  q: Type.String({ minLength: 1, maxLength: 200 }),
  serviceArea: Type.Optional(Type.String({ description: 'ZIP or city filter' })),
  cursor: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, default: 20 })),
});
export type SearchListingsQuery = Static<typeof SearchListingsQuery>;

// ─── Response schemas ──────────────────────────────────────────────────────────

export const ListingResponse = Type.Object({
  id: Type.String({ format: 'uuid' }),
  companyId: Type.String({ format: 'uuid' }),
  serviceName: Type.String(),
  serviceCategory: Type.String(),
  categoryId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  description: Type.Union([Type.String(), Type.Null()]),
  rewardCents: Type.Number(),
  qualifiedBonusCents: Type.Number(),
  maxConcurrentSales: Type.Number(),
  activeLeadCount: Type.Number(),
  escrowReservedCents: Type.Number(),
  autoReplenish: Type.Boolean(),
  status: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export const ListingsListResponse = Type.Object({
  data: Type.Array(ListingResponse),
  cursor: Type.Union([Type.String(), Type.Null()]),
  hasMore: Type.Boolean(),
});

export const SearchResultItem = Type.Object({
  id: Type.String({ format: 'uuid' }),
  companyId: Type.String({ format: 'uuid' }),
  companyName: Type.String(),
  serviceArea: Type.Array(Type.String()),
  serviceName: Type.String(),
  serviceCategory: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  rewardCents: Type.Number(),
  qualifiedBonusCents: Type.Number(),
  rank: Type.Number(),
});

export const SearchListingsResponse = Type.Object({
  data: Type.Array(SearchResultItem),
  cursor: Type.Union([Type.String(), Type.Null()]),
  hasMore: Type.Boolean(),
});
