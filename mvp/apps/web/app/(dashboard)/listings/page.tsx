'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch, ApiError } from '@/lib/api';
import { formatCents, formatDate } from '@/lib/utils';
import { Card, EmptyState } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PageSpinner } from '@/components/ui/Spinner';
import { Alert } from '@/components/ui/Alert';
import { ListingStatusBadge } from '@/components/ui/Badge';
import type { ServiceListing, ListingStatus } from '@lowleads/shared-types';

interface ListingsResponse {
  data: ServiceListing[];
  cursor: string | null;
  hasMore: boolean;
}

const TABS: { label: string; value: ListingStatus | '' }[] = [
  { label: 'All', value: '' },
  { label: 'Draft', value: 'draft' },
  { label: 'Active', value: 'active' },
  { label: 'Paused', value: 'paused' },
  { label: 'Archived', value: 'archived' },
];

export default function ListingsPage() {
  const [tab, setTab] = useState<ListingStatus | ''>('');
  const [listings, setListings] = useState<ServiceListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadListings = useCallback(async (status: ListingStatus | '') => {
    setLoading(true);
    setError('');
    try {
      const qs = status ? `?status=${status}&limit=50` : '?limit=50';
      const res = await apiFetch<ListingsResponse>(`/v1/listings${qs}`);
      setListings(res.data);
    } catch {
      setError('Failed to load listings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadListings(tab);
  }, [tab, loadListings]);

  async function handleAction(listingId: string, action: 'activate' | 'pause' | 'archive') {
    setActionLoading(listingId);
    try {
      if (action === 'archive') {
        await apiFetch<ServiceListing>(`/v1/listings/${listingId}`, { method: 'DELETE' });
      } else {
        await apiFetch<ServiceListing>(`/v1/listings/${listingId}/${action}`, { method: 'POST' });
      }
      await loadListings(tab);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action failed.');
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">My Listings</h1>
        <Link href="/listings/new">
          <Button size="sm">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            New Listing
          </Button>
        </Link>
      </div>

      {error && <Alert className="mb-4">{error}</Alert>}

      {/* Status tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => {
              setTab(t.value);
            }}
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
      ) : listings.length === 0 ? (
        <EmptyState
          title="No listings yet"
          description="Create a listing to start receiving referral leads from other businesses."
          action={
            <Link href="/listings/new">
              <Button size="sm">Create your first listing</Button>
            </Link>
          }
        />
      ) : (
        <Card padding={false}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Service
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Reward
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Leads
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Created
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {listings.map((listing) => (
                <tr key={listing.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-medium text-gray-900">{listing.serviceName}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{listing.serviceCategory}</p>
                  </td>
                  <td className="px-4 py-4">
                    <ListingStatusBadge status={listing.status} />
                  </td>
                  <td className="px-4 py-4 text-gray-700">
                    {formatCents(listing.rewardCents)}
                    {listing.qualifiedBonusCents > 0 && (
                      <span className="text-xs text-gray-400 ml-1">
                        +{formatCents(listing.qualifiedBonusCents)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-gray-700">
                    {listing.activeLeadCount}/{listing.maxConcurrentSales}
                  </td>
                  <td className="px-4 py-4 text-gray-500 text-xs">
                    {formatDate(listing.createdAt)}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2 justify-end">
                      <Link href={`/listings/${listing.id}/edit`}>
                        <Button variant="ghost" size="sm">
                          Edit
                        </Button>
                      </Link>
                      {listing.status === 'draft' && (
                        <Button
                          size="sm"
                          loading={actionLoading === listing.id}
                          onClick={() => void handleAction(listing.id, 'activate')}
                        >
                          Activate
                        </Button>
                      )}
                      {listing.status === 'active' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={actionLoading === listing.id}
                          onClick={() => void handleAction(listing.id, 'pause')}
                        >
                          Pause
                        </Button>
                      )}
                      {listing.status === 'paused' && (
                        <Button
                          size="sm"
                          loading={actionLoading === listing.id}
                          onClick={() => void handleAction(listing.id, 'activate')}
                        >
                          Resume
                        </Button>
                      )}
                      {listing.status !== 'archived' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={actionLoading === listing.id}
                          onClick={() => void handleAction(listing.id, 'archive')}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        >
                          Archive
                        </Button>
                      )}
                    </div>
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
