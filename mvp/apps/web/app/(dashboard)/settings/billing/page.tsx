'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';
import { formatCents } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Card } from '@/components/ui/Card';
import { TierBadge, Badge } from '@/components/ui/Badge';
import { PageSpinner } from '@/components/ui/Spinner';
import { TIER_LIMITS } from '@lowleads/shared-types';
import type { Company, SubscriptionTier } from '@lowleads/shared-types';

interface CheckoutSession {
  sessionId: string;
  url: string;
}

interface BillingPortal {
  url: string;
}

const TIERS: { tier: SubscriptionTier; name: string; price: string; highlight: boolean }[] = [
  { tier: 'free', name: 'Free', price: '$0/mo', highlight: false },
  { tier: 'pro', name: 'Pro', price: '$49/mo', highlight: true },
  { tier: 'enterprise', name: 'Enterprise', price: '$149/mo', highlight: false },
];

export default function BillingPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<SubscriptionTier | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const co = await apiFetch<Company>('/v1/companies/me');
        setCompany(co);
      } catch {
        /* empty */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleUpgrade(tier: SubscriptionTier) {
    if (tier === 'free') return;
    setError('');
    setUpgrading(tier);
    try {
      const session = await apiFetch<CheckoutSession>('/v1/billing/subscribe', {
        method: 'POST',
        body: {
          tier,
          returnUrl: `${window.location.origin}/settings/billing`,
        },
      });
      window.location.href = session.url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start checkout.');
      setUpgrading(null);
    }
  }

  async function openBillingPortal() {
    setError('');
    setPortalLoading(true);
    try {
      const portal = await apiFetch<BillingPortal>('/v1/billing/portal', {
        method: 'POST',
        body: { returnUrl: `${window.location.origin}/settings/billing` },
      });
      window.location.href = portal.url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to open billing portal.');
      setPortalLoading(false);
    }
  }

  if (loading) return <PageSpinner />;

  const currentTier = company?.subscriptionTier ?? 'free';

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Subscription & Billing</h1>
        {company && (
          <div className="flex items-center gap-2">
            <TierBadge tier={currentTier} />
            {company.subscriptionStatus && (
              <Badge variant={company.subscriptionStatus === 'active' ? 'success' : 'warning'}>
                {company.subscriptionStatus}
              </Badge>
            )}
          </div>
        )}
      </div>

      {error && <Alert className="mb-4">{error}</Alert>}

      {/* Current plan summary */}
      {company && (
        <Card>
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Current Plan</h2>
          <dl className="space-y-2 text-sm">
            <Row label="Plan" value={currentTier.charAt(0).toUpperCase() + currentTier.slice(1)} />
            <Row
              label="Transaction fee"
              value={`${String(TIER_LIMITS[currentTier].transactionFeeBps / 100)}% per sale`}
            />
            <Row
              label="Technician accounts"
              value={
                TIER_LIMITS[currentTier].technicianAccounts === Infinity
                  ? 'Unlimited'
                  : String(TIER_LIMITS[currentTier].technicianAccounts)
              }
            />
            <Row label="Escrow balance" value={formatCents(company.escrowBalanceCents)} />
          </dl>
          {currentTier !== 'free' && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <Button
                variant="secondary"
                size="sm"
                loading={portalLoading}
                onClick={() => void openBillingPortal()}
              >
                Manage Billing in Stripe
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* Plan comparison */}
      <div>
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Available Plans</h2>
        <div className="grid grid-cols-3 gap-4">
          {TIERS.map(({ tier, name, price, highlight }) => {
            const limits = TIER_LIMITS[tier];
            const isCurrent = tier === currentTier;
            const isDowngrade =
              (currentTier === 'enterprise' && tier !== 'enterprise') ||
              (currentTier === 'pro' && tier === 'free');

            return (
              <Card key={tier} className={highlight ? 'ring-2 ring-indigo-500' : ''}>
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-semibold text-gray-900">{name}</h3>
                  {highlight && <Badge variant="indigo">Popular</Badge>}
                </div>
                <p className="text-lg font-bold text-gray-900 mb-4">{price}</p>
                <ul className="space-y-1.5 text-xs text-gray-600 mb-4">
                  <Feature>{limits.transactionFeeBps / 100}% transaction fee</Feature>
                  <Feature>
                    {limits.technicianAccounts === Infinity
                      ? 'Unlimited technicians'
                      : limits.technicianAccounts === 0
                        ? 'No technician accounts'
                        : `Up to ${String(limits.technicianAccounts)} technicians`}
                  </Feature>
                  {limits.bonusIssuance && <Feature>Qualified lead bonuses</Feature>}
                  {limits.multiLocation && <Feature>Multi-location support</Feature>}
                </ul>
                {isCurrent ? (
                  <Badge variant="success" className="w-full justify-center">
                    Current Plan
                  </Badge>
                ) : tier === 'free' || isDowngrade ? (
                  <p className="text-xs text-gray-400 text-center">
                    {tier === 'free' ? 'Downgrade via Stripe portal' : 'Manage in Stripe'}
                  </p>
                ) : (
                  <Button
                    size="sm"
                    className="w-full"
                    variant={highlight ? 'primary' : 'secondary'}
                    loading={upgrading === tier}
                    onClick={() => void handleUpgrade(tier)}
                  >
                    Upgrade to {name}
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-gray-500">{label}</dt>
      <dd className="font-medium text-gray-900">{value}</dd>
    </div>
  );
}

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      <svg className="w-3.5 h-3.5 text-green-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
          clipRule="evenodd"
        />
      </svg>
      {children}
    </li>
  );
}
