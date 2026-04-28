'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Alert } from '@/components/ui/Alert';
import { Card } from '@/components/ui/Card';
import { PageSpinner } from '@/components/ui/Spinner';
import type { ServiceListing } from '@lowleads/shared-types';

const SERVICE_CATEGORIES = [
  'HVAC','Plumbing','Electrical','Roofing','Landscaping','Pest Control',
  'Cleaning','Painting','Flooring','Windows & Doors','Garage Doors',
  'Pool & Spa','Solar','Security','Other',
];

export default function EditListingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [listing, setListing] = useState<ServiceListing | null>(null);
  const [form, setForm] = useState({
    serviceName: '',
    serviceCategory: '',
    description: '',
    rewardDollars: '',
    qualifiedBonusDollars: '',
    maxConcurrentSales: '1',
    autoReplenish: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiFetch<ServiceListing>(`/v1/listings/${id}`);
        setListing(data);
        setForm({
          serviceName: data.serviceName,
          serviceCategory: data.serviceCategory,
          description: data.description ?? '',
          rewardDollars: (data.rewardCents / 100).toFixed(2),
          qualifiedBonusDollars: data.qualifiedBonusCents ? (data.qualifiedBonusCents / 100).toFixed(2) : '',
          maxConcurrentSales: String(data.maxConcurrentSales),
          autoReplenish: data.autoReplenish,
        });
      } catch {
        setError('Failed to load listing.');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  function set(field: string, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        serviceName: form.serviceName,
        serviceCategory: form.serviceCategory,
        rewardCents: Math.round(parseFloat(form.rewardDollars) * 100),
        maxConcurrentSales: parseInt(form.maxConcurrentSales, 10),
        autoReplenish: form.autoReplenish,
      };
      if (form.description) body['description'] = form.description;
      if (form.qualifiedBonusDollars) {
        body['qualifiedBonusCents'] = Math.round(parseFloat(form.qualifiedBonusDollars) * 100);
      }
      await apiFetch<ServiceListing>(`/v1/listings/${id}`, { method: 'PATCH', body });
      router.push('/listings');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update listing.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageSpinner />;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/listings" className="text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Edit Listing</h1>
      </div>

      {error && <Alert className="mb-4">{error}</Alert>}

      {listing?.status === 'archived' && (
        <Alert variant="warning" className="mb-4">
          This listing is archived and cannot be edited.
        </Alert>
      )}

      <form onSubmit={(e) => void handleSubmit(e)}>
        <Card className="space-y-5">
          <Input
            label="Service name"
            required
            disabled={listing?.status === 'archived'}
            value={form.serviceName}
            onChange={(e) => set('serviceName', e.target.value)}
          />

          <Select
            label="Service category"
            required
            disabled={listing?.status === 'archived'}
            value={form.serviceCategory}
            onChange={(e) => set('serviceCategory', e.target.value)}
          >
            <option value="">Select a category…</option>
            {SERVICE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>

          <Textarea
            label="Description (optional)"
            disabled={listing?.status === 'archived'}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            rows={3}
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Reward ($)"
              type="number"
              step="0.01"
              min="1"
              required
              disabled={listing?.status === 'archived'}
              value={form.rewardDollars}
              onChange={(e) => set('rewardDollars', e.target.value)}
            />
            <Input
              label="Qualified bonus ($)"
              type="number"
              step="0.01"
              min="0"
              disabled={listing?.status === 'archived'}
              value={form.qualifiedBonusDollars}
              onChange={(e) => set('qualifiedBonusDollars', e.target.value)}
            />
          </div>

          <Input
            label="Max concurrent leads"
            type="number"
            min="1"
            max="100"
            required
            disabled={listing?.status === 'archived'}
            value={form.maxConcurrentSales}
            onChange={(e) => set('maxConcurrentSales', e.target.value)}
          />

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              disabled={listing?.status === 'archived'}
              checked={form.autoReplenish}
              onChange={(e) => set('autoReplenish', e.target.checked)}
              className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
            />
            <span className="text-sm text-gray-700">Auto-replenish escrow when balance is low</span>
          </label>

          <div className="flex justify-end gap-3 pt-2">
            <Link href="/listings">
              <Button variant="secondary" type="button">Cancel</Button>
            </Link>
            <Button type="submit" loading={saving} disabled={listing?.status === 'archived'}>
              Save Changes
            </Button>
          </div>
        </Card>
      </form>
    </div>
  );
}
