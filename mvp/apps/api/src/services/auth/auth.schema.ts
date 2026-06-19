import { Type, type Static } from '@sinclair/typebox';

// ─── Request schemas ───────────────────────────────────────────────────────────

export const RegisterBody = Type.Object({
  email: Type.String({ format: 'email', maxLength: 255 }),
  password: Type.String({ minLength: 12, maxLength: 128 }),
  companyName: Type.String({ minLength: 2, maxLength: 255 }),
  companySlug: Type.String({
    minLength: 2,
    maxLength: 255,
    pattern: '^[a-z0-9-]+$',
    description: 'URL-safe slug: lowercase letters, numbers, hyphens only',
  }),
});
export type RegisterBody = Static<typeof RegisterBody>;

export const RegisterTechnicianBody = Type.Object({
  email: Type.String({ format: 'email', maxLength: 255 }),
  password: Type.String({ minLength: 12, maxLength: 128 }),
  displayName: Type.String({ minLength: 1, maxLength: 255 }),
  companyJoinCode: Type.String({
    minLength: 4,
    maxLength: 16,
    description: 'The join code shared by the company the employee is joining',
  }),
});
export type RegisterTechnicianBody = Static<typeof RegisterTechnicianBody>;

export const LoginBody = Type.Object({
  email: Type.String({ format: 'email' }),
  password: Type.String({ minLength: 1, maxLength: 128 }),
  mfaToken: Type.Optional(Type.String({ minLength: 6, maxLength: 8 })),
});
export type LoginBody = Static<typeof LoginBody>;

export const RefreshBody = Type.Object({});
export type RefreshBody = Static<typeof RefreshBody>;

export const MfaSetupBody = Type.Object({});
export type MfaSetupBody = Static<typeof MfaSetupBody>;

export const MfaVerifyBody = Type.Object({
  token: Type.String({ minLength: 6, maxLength: 6, pattern: '^[0-9]+$' }),
});
export type MfaVerifyBody = Static<typeof MfaVerifyBody>;

export const PasswordResetRequestBody = Type.Object({
  email: Type.String({ format: 'email' }),
});
export type PasswordResetRequestBody = Static<typeof PasswordResetRequestBody>;

export const PasswordResetBody = Type.Object({
  token: Type.String({ minLength: 1 }),
  newPassword: Type.String({ minLength: 12, maxLength: 128 }),
});
export type PasswordResetBody = Static<typeof PasswordResetBody>;

export const VerifyEmailBody = Type.Object({
  token: Type.String({ minLength: 1 }),
});
export type VerifyEmailBody = Static<typeof VerifyEmailBody>;

// ─── Response schemas ──────────────────────────────────────────────────────────

export const AuthTokenResponse = Type.Object({
  accessToken: Type.String(),
  expiresIn: Type.Number(),
});

export const MessageResponse = Type.Object({
  message: Type.String(),
});

export const MfaSetupResponse = Type.Object({
  secret: Type.String(),
  qrCodeUri: Type.String(),
});

export const MfaVerifyResponse = Type.Object({
  backupCodes: Type.Array(Type.String()),
  message: Type.String(),
});
