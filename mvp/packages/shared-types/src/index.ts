// ─── Enums ────────────────────────────────────────────────────────────────────

export const UserRole = {
  COMPANY_OWNER: 'company_owner',
  TECHNICIAN: 'technician',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const SubscriptionTier = {
  FREE: 'free',
  PRO: 'pro',
  ENTERPRISE: 'enterprise',
} as const;
export type SubscriptionTier = (typeof SubscriptionTier)[keyof typeof SubscriptionTier];

export const SubscriptionStatus = {
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  CANCELED: 'canceled',
  TRIALING: 'trialing',
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const LeadStatus = {
  PENDING: 'pending',
  NOT_QUALIFIED: 'not_qualified',
  NO_SALE: 'no_sale',
  SALE: 'sale',
} as const;
export type LeadStatus = (typeof LeadStatus)[keyof typeof LeadStatus];

export const ListingStatus = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  PAUSED: 'paused',
  ARCHIVED: 'archived',
} as const;
export type ListingStatus = (typeof ListingStatus)[keyof typeof ListingStatus];

export const EscrowTransactionType = {
  DEPOSIT: 'deposit',
  RESERVE: 'reserve',
  RELEASE: 'release',
  FEE: 'fee',
  REFUND: 'refund',
  REPLENISH: 'replenish',
} as const;
export type EscrowTransactionType =
  (typeof EscrowTransactionType)[keyof typeof EscrowTransactionType];

// ─── Entity Types ──────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
  mfaEnabled: boolean;
  role: UserRole;
  companyId: string;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Company {
  id: string;
  parentCompanyId: string | null;
  name: string;
  slug: string;
  stripeCustomerId: string | null;
  stripeConnectAccountId: string | null;
  subscriptionTier: SubscriptionTier;
  subscriptionStatus: SubscriptionStatus | null;
  transactionFeeBps: number;
  escrowBalanceCents: number;
  serviceArea: string[];
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Technician {
  id: string;
  userId: string;
  companyId: string;
  displayName: string;
  totalLeadsSubmitted: number;
  notQualifiedCount: number;
  totalEarnedCents: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceListing {
  id: string;
  companyId: string;
  serviceName: string;
  serviceCategory: string;
  description: string | null;
  rewardCents: number;
  qualifiedBonusCents: number;
  maxConcurrentSales: number;
  activeLeadCount: number;
  escrowReservedCents: number;
  autoReplenish: boolean;
  status: ListingStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Lead {
  id: string;
  listingId: string;
  receivingCompanyId: string;
  submitterUserId: string;
  technicianId: string | null;
  customerFirstName: string;
  customerLastInitial: string;
  status: LeadStatus;
  rewardCents: number;
  qualifiedBonusCents: number;
  viewedAt: string | null;
  resolvedAt: string | null;
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface EscrowTransaction {
  id: string;
  companyId: string;
  leadId: string | null;
  type: EscrowTransactionType;
  amountCents: number;
  stripePaymentIntentId: string | null;
  stripeTransferId: string | null;
  balanceAfterCents: number;
  createdAt: string;
}

// ─── API Response Types ────────────────────────────────────────────────────────

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface PaginationCursor {
  cursor: string | null;
  hasMore: boolean;
  total?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationCursor;
}

// ─── Auth Types ────────────────────────────────────────────────────────────────

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  companyId: string;
  mfaVerified: boolean;
  iat?: number;
  exp?: number;
}

export interface AuthTokenResponse {
  accessToken: string;
  expiresIn: number;
}

// ─── Subscription Tier Limits ─────────────────────────────────────────────────

export const TIER_LIMITS = {
  [SubscriptionTier.FREE]: {
    technicianAccounts: 0,
    transactionFeeBps: 800,
    multiLocation: false,
    technicianDashboard: false,
    bonusIssuance: false,
  },
  [SubscriptionTier.PRO]: {
    technicianAccounts: 6,
    transactionFeeBps: 600,
    multiLocation: false,
    technicianDashboard: true,
    bonusIssuance: true,
  },
  [SubscriptionTier.ENTERPRISE]: {
    technicianAccounts: Infinity,
    transactionFeeBps: 400,
    multiLocation: true,
    technicianDashboard: true,
    bonusIssuance: true,
  },
} as const satisfies Record<
  SubscriptionTier,
  {
    technicianAccounts: number;
    transactionFeeBps: number;
    multiLocation: boolean;
    technicianDashboard: boolean;
    bonusIssuance: boolean;
  }
>;

export const MINIMUM_REWARD_CENTS = 100;
export const MINIMUM_FEE_CENTS = 100;
