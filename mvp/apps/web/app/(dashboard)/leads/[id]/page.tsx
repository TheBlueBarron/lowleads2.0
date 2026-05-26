'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatCents, formatDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Card } from '@/components/ui/Card';
import { LeadStatusBadge } from '@/components/ui/Badge';
import { PageSpinner } from '@/components/ui/Spinner';
import type { LeadStatus } from '@lowleads/shared-types';

interface LeadDetail {
  id: string;
  listingId: string;
  receivingCompanyId: string;
  submitterUserId: string;
  technicianId: string | null;
  customerFirstName: string;
  customerLastInitial: string;
  customerPhone: string | null;
  customerEmail: string | null;
  notes: string | null;
  status: LeadStatus;
  rewardCents: number;
  qualifiedBonusCents: number;
  viewedAt: string | null;
  resolvedAt: string | null;
  submittedAt: string;
  createdAt: string;
}

const TERMINAL_STATUSES: LeadStatus[] = ['sale', 'no_sale', 'not_qualified'];

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<LeadStatus | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiFetch<LeadDetail>(`/v1/leads/${id}`);
        setLead(data);
      } catch {
        setError('Lead not found or you do not have access.');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  async function updateStatus(status: LeadStatus) {
    if (!lead) return;
    setUpdating(status);
    setError('');
    try {
      await apiFetch<unknown>(`/v1/leads/${id}/status`, {
        method: 'PATCH',
        body: { status },
      });
      // Re-fetch full detail to get updated status + PII
      const refreshed = await apiFetch<LeadDetail>(`/v1/leads/${id}`);
      setLead(refreshed);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update status.');
    } finally {
      setUpdating(null);
    }
  }

  if (loading) return <PageSpinner />;
  if (error && !lead) {
    return (
      <div className="p-6">
        <Alert>{error}</Alert>
        <Link href="/leads" className="text-sm text-indigo-600 mt-4 inline-block">
          ← Back to leads
        </Link>
      </div>
    );
  }

  const isReceiver = user?.companyId === lead?.receivingCompanyId;
  const isTerminal = lead ? TERMINAL_STATUSES.includes(lead.status) : false;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/leads" className="text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Lead Details</h1>
      </div>

      {error && <Alert className="mb-4">{error}</Alert>}

      {lead && (
        <>
          {/* Status + reward header */}
          <Card className="mb-4">
            <div className="flex items-start justify-between">
              <div>
                <LeadStatusBadge status={lead.status} />
                <p className="text-sm text-gray-500 mt-2">
                  Submitted {formatDateTime(lead.submittedAt)}
                </p>
                {lead.resolvedAt && (
                  <p className="text-sm text-gray-500">
                    Resolved {formatDateTime(lead.resolvedAt)}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-green-600">{formatCents(lead.rewardCents)}</p>
                {lead.qualifiedBonusCents > 0 && (
                  <p className="text-xs text-gray-500">
                    +{formatCents(lead.qualifiedBonusCents)} qualified bonus
                  </p>
                )}
              </div>
            </div>
          </Card>

          {/* Customer info */}
          <Card className="mb-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Customer</h3>
            <dl className="space-y-2">
              <Row label="Name" value={`${lead.customerFirstName} ${lead.customerLastInitial}.`} />
              {lead.customerPhone && <Row label="Phone" value={lead.customerPhone} />}
              {lead.customerEmail && <Row label="Email" value={lead.customerEmail} />}
              {lead.notes && <Row label="Notes" value={lead.notes} />}
            </dl>
          </Card>

          {/* Status actions — only visible to the receiver on pending leads */}
          {isReceiver && !isTerminal && (
            <Card>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Update outcome</h3>
              <p className="text-xs text-gray-500 mb-4">
                Once set, the outcome cannot be changed. Escrow will be adjusted automatically.
              </p>
              <div className="flex gap-3">
                <Button
                  size="sm"
                  loading={updating === 'sale'}
                  disabled={updating !== null && updating !== 'sale'}
                  onClick={() => void updateStatus('sale')}
                >
                  Mark as Sale
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={updating === 'no_sale'}
                  disabled={updating !== null && updating !== 'no_sale'}
                  onClick={() => void updateStatus('no_sale')}
                >
                  No Sale
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={updating === 'not_qualified'}
                  disabled={updating !== null && updating !== 'not_qualified'}
                  onClick={() => void updateStatus('not_qualified')}
                  className="text-gray-500"
                >
                  Not Qualified
                </Button>
              </div>
            </Card>
          )}

          {isTerminal && (
            <div className="text-center text-sm text-gray-400 pt-2">
              This lead is resolved and cannot be updated.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="text-xs font-medium text-gray-500 w-20 shrink-0 pt-0.5">{label}</dt>
      <dd className="text-sm text-gray-800 flex-1 break-words">{value}</dd>
    </div>
  );
}
