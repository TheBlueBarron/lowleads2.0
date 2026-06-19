import { Type, type Static } from '@sinclair/typebox';

export const CreateTechnicianBody = Type.Object({
  userId: Type.String({ format: 'uuid', description: 'Existing user ID to link as technician' }),
  displayName: Type.String({ minLength: 1, maxLength: 255 }),
});
export type CreateTechnicianBody = Static<typeof CreateTechnicianBody>;

export const UpdateTechnicianBody = Type.Object({
  displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  isActive: Type.Optional(Type.Boolean()),
});
export type UpdateTechnicianBody = Static<typeof UpdateTechnicianBody>;

export const TechnicianIdParam = Type.Object({
  technicianId: Type.String({ format: 'uuid' }),
});
export type TechnicianIdParam = Static<typeof TechnicianIdParam>;

export const TechnicianResponse = Type.Object({
  id: Type.String({ format: 'uuid' }),
  userId: Type.String({ format: 'uuid' }),
  companyId: Type.String({ format: 'uuid' }),
  displayName: Type.String(),
  totalLeadsSubmitted: Type.Number(),
  notQualifiedCount: Type.Number(),
  totalEarnedCents: Type.Number(),
  escrowBalanceCents: Type.Number(),
  isActive: Type.Boolean(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export const TechnicianListResponse = Type.Object({
  data: Type.Array(TechnicianResponse),
  total: Type.Number(),
});

export const TechnicianPerformanceResponse = Type.Object({
  data: Type.Array(
    Type.Object({
      technicianId: Type.String({ format: 'uuid' }),
      displayName: Type.String(),
      isActive: Type.Boolean(),
      leadsSubmitted: Type.Number(),
      leadsClosed: Type.Number(),
      closeRate: Type.Number(),
      totalEarnedCents: Type.Number(),
      balanceCents: Type.Number(),
    }),
  ),
  total: Type.Number(),
});
