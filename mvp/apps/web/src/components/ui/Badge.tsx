import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';
import type { LeadStatus, ListingStatus, SubscriptionTier } from '@lowleads/shared-types';

interface BadgeProps {
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info' | 'indigo';
  children: ReactNode;
  className?: string;
}

const badgeVariants = {
  default: 'bg-gray-100 text-gray-700',
  success: 'bg-green-100 text-green-700',
  warning: 'bg-yellow-100 text-yellow-700',
  error: 'bg-red-100 text-red-700',
  info: 'bg-blue-100 text-blue-700',
  indigo: 'bg-indigo-100 text-indigo-700',
};

export function Badge({ variant = 'default', children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        badgeVariants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  const map: Record<LeadStatus, { label: string; variant: BadgeProps['variant'] }> = {
    pending: { label: 'Pending', variant: 'warning' },
    not_qualified: { label: 'Not Qualified', variant: 'error' },
    no_sale: { label: 'No Sale', variant: 'default' },
    sale: { label: 'Sale', variant: 'success' },
  };
  const { label, variant } = map[status] ?? { label: status, variant: 'default' };
  return <Badge variant={variant}>{label}</Badge>;
}

export function ListingStatusBadge({ status }: { status: ListingStatus }) {
  const map: Record<ListingStatus, { label: string; variant: BadgeProps['variant'] }> = {
    draft: { label: 'Draft', variant: 'default' },
    active: { label: 'Active', variant: 'success' },
    paused: { label: 'Paused', variant: 'warning' },
    archived: { label: 'Archived', variant: 'error' },
  };
  const { label, variant } = map[status] ?? { label: status, variant: 'default' };
  return <Badge variant={variant}>{label}</Badge>;
}

export function TierBadge({ tier }: { tier: SubscriptionTier }) {
  const map: Record<SubscriptionTier, { label: string; variant: BadgeProps['variant'] }> = {
    free: { label: 'Free', variant: 'default' },
    pro: { label: 'Pro', variant: 'indigo' },
    enterprise: { label: 'Enterprise', variant: 'info' },
  };
  const { label, variant } = map[tier] ?? { label: tier, variant: 'default' };
  return <Badge variant={variant}>{label}</Badge>;
}
