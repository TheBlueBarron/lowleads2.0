'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { Card, EmptyState } from '@/components/ui/Card';
import { PageSpinner } from '@/components/ui/Spinner';
import { Alert } from '@/components/ui/Alert';
import { LeadStatusBadge } from '@/components/ui/Badge';
import type { LeadStatus } from '@lowleads/shared-types';

interface LeadSummary {
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
}

interface LeadsResponse {
  data: LeadSummary[];
  cursor: string | null;
  hasMore: boolean;
}

const TABS: { label: string; value: LeadStatus | '' }[] = [
  { label: 'All', value: '' },
  { label: 'Pending', value: 'pending' },
  { label: 'Sale', value: 'sale' },
  { label: 'No Sale', value: 'no_sale' },
  { label: 'Not Qualified', value: 'not_qualified' },
];

export default function LeadsPage() {
  const [tab, setTab] = useState<LeadStatus | ''>('');
  const [role, setRole] = useState<'receiver' | 'submitter'>('receiver');
  const [leads, setLeads] = useState<LeadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadLeads = useCallback(async (status: LeadStatus | '', r: 'receiver' | 'submitter') => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ role: r, limit: '50' });
      if (status) qs.set('status', status);
      const res = await apiFetch<LeadsResponse>(`/v1/leads?${qs.toString()}`);
      setLeads(res.data);
    } catch {
      setError('Failed to load leads.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLeads(tab, role);
  }, [tab, role, loadLeads]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
        <div className="flex bg-gray-100 rounded-lg p-1 gap-1">
          <button
            onClick={() => setRole('receiver')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors font-medium ${
              role === 'receiver' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Received
          </button>
          <button
            onClick={() => setRole('submitter')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors font-medium ${
              role === 'submitter' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Submitted
          </button>
        </div>
      </div>

      {error && <Alert className="mb-4">{error}</Alert>}

      {/* Status tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t.value
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <PageSpinner />
      ) : leads.length === 0 ? (
        <EmptyState
          title={role === 'receiver' ? 'No leads received yet' : 'No leads submitted yet'}
          description={
            role === 'receiver'
              ? 'Leads submitted to your active listings will appear here.'
              : 'Browse listings and submit leads to earn referral rewards.'
          }
          action={
            role === 'submitter' ? (
              <Link
                href="/browse"
                className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
              >
                Browse Listings
              </Link>
            ) : undefined
          }
        />
      ) : (
        <Card padding={false}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Customer
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  {role === 'receiver' ? 'Reward' : 'Earned'}
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Submitted
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {!lead.viewedAt && role === 'receiver' && (
                        <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" title="Unread" />
                      )}
                      <p className="font-medium text-gray-900">
                        {lead.customerFirstName} {lead.customerLastInitial}.
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <LeadStatusBadge status={lead.status} />
                  </td>
                  <td className="px-4 py-4 text-gray-700">
                    ${(lead.rewardCents / 100).toFixed(2)}
                  </td>
                  <td className="px-4 py-4 text-gray-500 text-xs">
                    {formatDateTime(lead.submittedAt)}
                  </td>
                  <td className="px-4 py-4 text-right">
                    <Link
                      href={`/leads/${lead.id}`}
                      className="text-sm text-indigo-600 hover:text-indigo-500 font-medium"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
