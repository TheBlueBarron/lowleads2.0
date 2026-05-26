'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, ApiError } from '@/lib/api';
import { formatCents } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Alert } from '@/components/ui/Alert';
import { Card } from '@/components/ui/Card';
import { ListingStatusBadge } from '@/components/ui/Badge';
import { PageSpinner } from '@/components/ui/Spinner';
import type { ServiceListing } from '@lowleads/shared-types';

interface LeadSummary {
  id: string;
  status: string;
  rewardCents: number;
  submittedAt: string;
}

export default function BrowseListingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [listing, setListing] = useState<ServiceListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState<LeadSummary | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const [form, setForm] = useState({
    customerFirstName: '',
    customerLastInitial: '',
    customerPhone: '',
    customerEmail: '',
    notes: '',
  });

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiFetch<ServiceListing>(`/v1/listings/${id}`);
        setListing(data);
      } catch {
        setError('Listing not found or unavailable.');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        listingId: id,
        customerFirstName: form.customerFirstName,
        customerLastInitial: form.customerLastInitial.toUpperCase(),
        customerPhone: form.customerPhone,
      };
      if (form.customerEmail) body.customerEmail = form.customerEmail;
      if (form.notes) body.notes = form.notes;

      const result = await apiFetch<LeadSummary>('/v1/leads', { method: 'POST', body });
      setSubmitted(result);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to submit lead.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <PageSpinner />;
  if (error) {
    return (
      <div className="p-6">
        <Alert>{error}</Alert>
        <Link href="/browse" className="text-sm text-indigo-600 mt-4 inline-block">
          ← Back to browse
        </Link>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <Alert variant="success" title="Lead submitted!">
          Your lead has been submitted. You&apos;ll earn{' '}
          <strong>{formatCents(submitted.rewardCents)}</strong> when it results in a sale.
        </Alert>
        <div className="mt-6 flex gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              router.push('/browse');
            }}
          >
            Browse more
          </Button>
          <Link href="/leads">
            <Button variant="ghost">View my leads</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/browse" className="text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Submit a Lead</h1>
      </div>

      {listing && (
        <Card className="mb-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                {listing.serviceCategory}
              </p>
              <h2 className="text-lg font-semibold text-gray-900 mt-0.5">{listing.serviceName}</h2>
              {listing.description && (
                <p className="text-sm text-gray-600 mt-2">{listing.description}</p>
              )}
              <div className="flex items-center gap-3 mt-3">
                <ListingStatusBadge status={listing.status} />
                <span className="text-sm text-gray-500">
                  {listing.maxConcurrentSales - listing.activeLeadCount} slots available
                </span>
              </div>
            </div>
            <div className="text-right ml-4">
              <p className="text-2xl font-bold text-green-600">
                {formatCents(listing.rewardCents)}
              </p>
              <p className="text-xs text-gray-500">per sale</p>
              {listing.qualifiedBonusCents > 0 && (
                <p className="text-xs text-green-500 mt-0.5">
                  +{formatCents(listing.qualifiedBonusCents)} qualified bonus
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      {listing?.status !== 'active' && (
        <Alert variant="warning" className="mb-4">
          This listing is not currently accepting leads.
        </Alert>
      )}

      {listing?.status === 'active' && (
        <>
          {formError && <Alert className="mb-4">{formError}</Alert>}
          <form onSubmit={(e) => void handleSubmit(e)}>
            <Card className="space-y-4">
              <h3 className="font-semibold text-gray-900 text-sm">Customer information</h3>
              <p className="text-xs text-gray-500 -mt-2">
                Only first name, last initial, and phone are required. This information is encrypted
                and only visible to the receiving business.
              </p>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Input
                    label="First name"
                    required
                    value={form.customerFirstName}
                    onChange={(e) => {
                      set('customerFirstName', e.target.value);
                    }}
                    placeholder="Jane"
                  />
                </div>
                <Input
                  label="Last initial"
                  required
                  maxLength={1}
                  pattern="[A-Za-z]"
                  value={form.customerLastInitial}
                  onChange={(e) => {
                    set('customerLastInitial', e.target.value);
                  }}
                  placeholder="S"
                />
              </div>

              <Input
                label="Phone number"
                type="tel"
                required
                value={form.customerPhone}
                onChange={(e) => {
                  set('customerPhone', e.target.value);
                }}
                placeholder="+1 (602) 555-0100"
              />

              <Input
                label="Email (optional)"
                type="email"
                value={form.customerEmail}
                onChange={(e) => {
                  set('customerEmail', e.target.value);
                }}
                placeholder="jane@example.com"
              />

              <Textarea
                label="Notes (optional)"
                value={form.notes}
                onChange={(e) => {
                  set('notes', e.target.value);
                }}
                placeholder="Brief notes about the customer's needs, location, urgency, etc."
                rows={3}
              />

              <div className="flex justify-end gap-3 pt-2">
                <Link href="/browse">
                  <Button variant="secondary" type="button">
                    Cancel
                  </Button>
                </Link>
                <Button type="submit" loading={submitting}>
                  Submit Lead
                </Button>
              </div>
            </Card>
          </form>
        </>
      )}
    </div>
  );
}
