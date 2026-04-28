import { Type, type Static } from '@sinclair/typebox';

export const UpdateNotificationPrefsBody = Type.Object({
  emailNewLead: Type.Optional(Type.Boolean()),
  emailLeadResolved: Type.Optional(Type.Boolean()),
  emailLowEscrow: Type.Optional(Type.Boolean()),
  lowEscrowThresholdCents: Type.Optional(
    Type.Number({ minimum: 0, maximum: 1_000_000 }),
  ),
});
export type UpdateNotificationPrefsBody = Static<typeof UpdateNotificationPrefsBody>;

export const NotificationPrefsResponse = Type.Object({
  userId: Type.String({ format: 'uuid' }),
  emailNewLead: Type.Boolean(),
  emailLeadResolved: Type.Boolean(),
  emailLowEscrow: Type.Boolean(),
  lowEscrowThresholdCents: Type.Number(),
  updatedAt: Type.String(),
});
