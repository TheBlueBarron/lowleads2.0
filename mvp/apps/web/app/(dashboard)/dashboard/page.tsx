'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { formatCents, formatDateTime } from '@/lib/utils';
import { StatCard, Card } from '@/components/ui/Card';
import { PageSpinner } from '@/components/ui/Spinner';
import { Alert } from '@/components/ui/Alert';
import { Badge, TierBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { Company, EscrowTransaction } from '@lowleads/shared-types';

interface EscrowBalanceResponse {
  balanceCents: number;
}

interface EscrowHistoryResponse {
  transactions: EscrowTransaction[];
  cursor: string | null;
  hasMore: boolean;
}

interface LeadsListResponse {
  data: unknown[];
  cursor: string | null;
  hasMore: boolean;
}

interface ListingsListResponse {
  data: unknown[];
  cursor: string | null;
  hasMore: boolean;
}

const txTypeLabel: Record<string, { label: string; sign: string; color: string }> = {
  deposit: { label: 'Deposit', sign: '+', color: 'text-green-600' },
  replenish: { label: 'Replenish', sign: '+', color: 'text-green-600' },
  release: { label: 'Release', sign: '+', color: 'text-green-600' },
  refund: { label: 'Refund', sign: '+', color: 'text-green-600' },
  reserve: { label: 'Reserve', sign: '-', color: 'text-gray-600' },
  fee: { label: 'Fee', sign: '-', color: 'text-red-600' },
};

export default function DashboardPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [pendingLeads, setPendingLeads] = useState<number | null>(null);
  const [activeListings, setActiveListings] = useState<number | null>(null);
  const [recentTx, setRecentTx] = useState<EscrowTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const [co, leads, listings, tx] = await Promise.all([
          apiFetch<Company>('/v1/companies/me'),
          apiFetch<LeadsListResponse>('/v1/leads?status=pending&limit=100'),
          apiFetch<ListingsListResponse>('/v1/listings?status=active&limit=100'),
          apiFetch<EscrowHistoryResponse>('/v1/companies/me/escrow/history?limit=10'),
        ]);
        setCompany(co);
        setPendingLeads(leads.data.length);
        setActiveListings(listings.data.length);
        setRecentTx(tx.transactions);
      } catch {
        setError('Failed to load dashboard data. Please refresh.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <PageSpinner />;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {error && <Alert className="mb-6">{error}</Alert>}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {company?.name ?? 'Dashboard'}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            {company && <TierBadge tier={company.subscriptionTier} />}
            {company?.verifiedAt && (
              <Badge variant="success">Verified</Badge>
            )}
          </div>
        </div>
        <Link href="/settings/escrow">
          <Button variant="secondary" size="sm">Add Funds</Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <StatCard
          label="Escrow Balance"
          value={company ? formatCents(company.escrowBalanceCents) : '—'}
          sub="Available for lead activity"
          icon={
            <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          }
        />
        <StatCard
          label="Pending Leads"
          value={pendingLeads !== null ? String(pendingLeads) : '—'}
          sub="Awaiting your review"
          iconBg="bg-yellow-50"
          icon={
            <svg className="w-5 h-5 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0H4m4 0l4-4 4 4"
              />
            </svg>
          }
        />
        <StatCard
          label="Active Listings"
          value={activeListings !== null ? String(activeListings) : '—'}
          sub="Currently accepting leads"
          iconBg="bg-green-50"
          icon={
            <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 4h6m-6 4h4"
              />
            </svg>
          }
        />
      </div>

      {/* Recent transactions */}
      <Card padding={false}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Recent Transactions</h2>
          <Link href="/settings/escrow" className="text-xs text-indigo-600 hover:text-indigo-500">
            View all
          </Link>
        </div>
        {recentTx.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">No transactions yet.</p>
        ) : (
          <ul className="divide-y divide-gray-50">
            {recentTx.map((tx) => {
              const t = txTypeLabel[tx.type] ?? { label: tx.type, sign: '', color: 'text-gray-600' };
              const isCredit = ['+'].includes(t.sign);
              return (
                <li key={tx.id} className="flex items-center justify-between px-6 py-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${isCredit ? 'bg-green-400' : 'bg-gray-300'}`} />
                    <div>
                      <p className="text-sm font-medium text-gray-800">{t.label}</p>
                      <p className="text-xs text-gray-400">{formatDateTime(tx.createdAt)}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-medium ${t.color}`}>
                      {t.sign}{formatCents(tx.amountCents)}
                    </p>
                    <p className="text-xs text-gray-400">
                      Bal: {formatCents(tx.balanceAfterCents)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
