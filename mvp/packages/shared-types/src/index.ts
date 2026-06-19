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
  WITHDRAWAL: 'withdrawal',
} as const;
export type EscrowTransactionType =
  (typeof EscrowTransactionType)[keyof typeof EscrowTransactionType];

export const EscrowPayeeType = {
  COMPANY: 'company',
  TECHNICIAN: 'technician',
} as const;
export type EscrowPayeeType = (typeof EscrowPayeeType)[keyof typeof EscrowPayeeType];

export const AuctionStatus = {
  OPEN: 'open',
  CLOSED: 'closed',
} as const;
export type AuctionStatus = (typeof AuctionStatus)[keyof typeof AuctionStatus];

export const BidCreditTransactionType = {
  MONTHLY_GRANT: 'monthly_grant',
  AUCTION_WIN_DRAWDOWN: 'auction_win_drawdown',
} as const;
export type BidCreditTransactionType =
  (typeof BidCreditTransactionType)[keyof typeof BidCreditTransactionType];

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
  // Short, unique code employees enter to self-register into this company.
  joinCode: string;
  // Accruing credit (Pro membership grants $1,000/mo) used to fund auction bids.
  bidCreditBalanceCents: number;
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
  // The technician's own platform-held balance, credited on their referral sales.
  escrowBalanceCents: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  parentId: string | null;
  name: string;
  isLeaf: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryAuction {
  id: string;
  zipCode: string;
  categoryId: string;
  periodMonth: string;
  floorPriceCents: number;
  status: AuctionStatus;
  winningCompanyId: string | null;
  clearingPriceCents: number | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryAuctionBid {
  id: string;
  auctionId: string;
  companyId: string;
  maxBidCents: number;
  placedAt: string;
  createdAt: string;
}

export interface BidCreditTransaction {
  id: string;
  companyId: string;
  type: BidCreditTransactionType;
  amountCents: number;
  auctionId: string | null;
  balanceAfterCents: number;
  createdAt: string;
}

export interface ServiceListing {
  id: string;
  companyId: string;
  serviceName: string;
  serviceCategory: string;
  categoryId: string | null;
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
  customerZip: string | null;
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
  // Whether this row moved a company or a technician balance.
  payeeType: EscrowPayeeType;
  technicianId: string | null;
  payoutReference: string | null;
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

// "Recommended" auction tier
export const MONTHLY_BID_CREDIT_CENTS = 100_000; // $1,000/mo Pro grant
export const DEFAULT_AUCTION_FLOOR_CENTS = 100_000; // $1,000.00 absolute floor fallback
export const BID_INCREMENT_CENTS = 100; // $1 proxy-bid increment
