import { Type, type Static } from '@sinclair/typebox';

// ─── Request schemas ───────────────────────────────────────────────────────────

export const SubmitLeadBody = Type.Object({
  listingId: Type.String({ format: 'uuid' }),
  customerFirstName: Type.String({ minLength: 1, maxLength: 100 }),
  customerLastInitial: Type.String({ minLength: 1, maxLength: 1, pattern: '^[A-Za-z]$' }),
  customerPhone: Type.String({ minLength: 7, maxLength: 20, description: 'E.164 or local format' }),
  customerEmail: Type.Optional(Type.String({ format: 'email', maxLength: 255 })),
  notes: Type.Optional(Type.String({ maxLength: 2000 })),
  // Address-first flow: street is encrypted PII; ZIP is stored in the clear.
  customerAddressStreet: Type.Optional(Type.String({ maxLength: 500 })),
  customerZip: Type.Optional(Type.String({ minLength: 3, maxLength: 10 })),
  technicianId: Type.Optional(Type.String({ format: 'uuid' })),
});
export type SubmitLeadBody = Static<typeof SubmitLeadBody>;

export const ReferCompaniesQuery = Type.Object({
  zip: Type.String({ minLength: 3, maxLength: 10 }),
  category_id: Type.String({ format: 'uuid' }),
  q: Type.Optional(Type.String({ maxLength: 255 })),
});
export type ReferCompaniesQuery = Static<typeof ReferCompaniesQuery>;

export const ReferCompaniesResponse = Type.Object({
  data: Type.Array(
    Type.Object({
      listingId: Type.String({ format: 'uuid' }),
      companyId: Type.String({ format: 'uuid' }),
      companyName: Type.String(),
      serviceName: Type.String(),
      serviceCategory: Type.String(),
      rewardCents: Type.Number(),
      qualifiedBonusCents: Type.Number(),
      closeRate: Type.Number(),
      score: Type.Number(),
      recommended: Type.Boolean(),
    }),
  ),
  total: Type.Number(),
});

export const LeadIdParam = Type.Object({
  leadId: Type.String({ format: 'uuid' }),
});
export type LeadIdParam = Static<typeof LeadIdParam>;

export const UpdateLeadStatusBody = Type.Object({
  status: Type.Union([
    Type.Literal('not_qualified'),
    Type.Literal('no_sale'),
    Type.Literal('sale'),
  ]),
});
export type UpdateLeadStatusBody = Static<typeof UpdateLeadStatusBody>;

export const LeadsQuery = Type.Object({
  role: Type.Optional(Type.Union([Type.Literal('receiver'), Type.Literal('submitter')])),
  status: Type.Optional(
    Type.Union([
      Type.Literal('pending'),
      Type.Literal('not_qualified'),
      Type.Literal('no_sale'),
      Type.Literal('sale'),
    ]),
  ),
  cursor: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
});
export type LeadsQuery = Static<typeof LeadsQuery>;

// ─── Response schemas ──────────────────────────────────────────────────────────

export const LeadSummaryResponse = Type.Object({
  id: Type.String({ format: 'uuid' }),
  listingId: Type.String({ format: 'uuid' }),
  receivingCompanyId: Type.String({ format: 'uuid' }),
  submitterUserId: Type.String({ format: 'uuid' }),
  technicianId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  customerFirstName: Type.String(),
  customerLastInitial: Type.String(),
  customerZip: Type.Union([Type.String(), Type.Null()]),
  status: Type.String(),
  rewardCents: Type.Number(),
  qualifiedBonusCents: Type.Number(),
  viewedAt: Type.Union([Type.String(), Type.Null()]),
  resolvedAt: Type.Union([Type.String(), Type.Null()]),
  submittedAt: Type.String(),
  createdAt: Type.String(),
});

export const LeadDetailResponse = Type.Object({
  id: Type.String({ format: 'uuid' }),
  listingId: Type.String({ format: 'uuid' }),
  receivingCompanyId: Type.String({ format: 'uuid' }),
  submitterUserId: Type.String({ format: 'uuid' }),
  technicianId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  customerFirstName: Type.String(),
  customerLastInitial: Type.String(),
  customerZip: Type.Union([Type.String(), Type.Null()]),
  customerPhone: Type.Union([Type.String(), Type.Null()]),
  customerEmail: Type.Union([Type.String(), Type.Null()]),
  notes: Type.Union([Type.String(), Type.Null()]),
  customerAddressStreet: Type.Union([Type.String(), Type.Null()]),
  status: Type.String(),
  rewardCents: Type.Number(),
  qualifiedBonusCents: Type.Number(),
  viewedAt: Type.Union([Type.String(), Type.Null()]),
  resolvedAt: Type.Union([Type.String(), Type.Null()]),
  submittedAt: Type.String(),
  createdAt: Type.String(),
});

export const LeadsListResponse = Type.Object({
  data: Type.Array(LeadSummaryResponse),
  cursor: Type.Union([Type.String(), Type.Null()]),
  hasMore: Type.Boolean(),
});
