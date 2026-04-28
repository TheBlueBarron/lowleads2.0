'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Alert } from '@/components/ui/Alert';
import { Card } from '@/components/ui/Card';
import type { ServiceListing } from '@lowleads/shared-types';

const SERVICE_CATEGORIES = [
  'HVAC',
  'Plumbing',
  'Electrical',
  'Roofing',
  'Landscaping',
  'Pest Control',
  'Cleaning',
  'Painting',
  'Flooring',
  'Windows & Doors',
  'Garage Doors',
  'Pool & Spa',
  'Solar',
  'Security',
  'Other',
];

export default function NewListingPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    serviceName: '',
    serviceCategory: '',
    description: '',
    rewardDollars: '',
    qualifiedBonusDollars: '',
    maxConcurrentSales: '1',
    autoReplenish: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function set(field: string, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const body = {
        serviceName: form.serviceName,
        serviceCategory: form.serviceCategory,
        ...(form.description ? { description: form.description } : {}),
        rewardCents: Math.round(parseFloat(form.rewardDollars) * 100),
        qualifiedBonusCents: form.qualifiedBonusDollars
          ? Math.round(parseFloat(form.qualifiedBonusDollars) * 100)
          : 0,
        maxConcurrentSales: parseInt(form.maxConcurrentSales, 10),
        autoReplenish: form.autoReplenish,
      };
      await apiFetch<ServiceListing>('/v1/listings', { method: 'POST', body });
      router.push('/listings');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create listing.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/listings" className="text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">New Listing</h1>
      </div>

      {error && <Alert className="mb-4">{error}</Alert>}

      <form onSubmit={(e) => void handleSubmit(e)}>
        <Card className="space-y-5">
          <Input
            label="Service name"
            required
            value={form.serviceName}
            onChange={(e) => set('serviceName', e.target.value)}
            placeholder="HVAC Installation"
          />

          <Select
            label="Service category"
            required
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
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Describe what kind of leads you're looking for…"
            rows={3}
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Reward ($)"
              type="number"
              step="0.01"
              min="1"
              required
              value={form.rewardDollars}
              onChange={(e) => set('rewardDollars', e.target.value)}
              placeholder="75.00"
              hint="Paid to submitter on successful sale"
            />
            <Input
              label="Qualified bonus ($)"
              type="number"
              step="0.01"
              min="0"
              value={form.qualifiedBonusDollars}
              onChange={(e) => set('qualifiedBonusDollars', e.target.value)}
              placeholder="0.00"
              hint="Optional Pro/Enterprise bonus"
            />
          </div>

          <Input
            label="Max concurrent leads"
            type="number"
            min="1"
            max="100"
            required
            value={form.maxConcurrentSales}
            onChange={(e) => set('maxConcurrentSales', e.target.value)}
            hint="Maximum open leads at one time"
          />

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.autoReplenish}
              onChange={(e) => set('autoReplenish', e.target.checked)}
              className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
            />
            <span className="text-sm text-gray-700">
              Auto-replenish escrow when balance is low
            </span>
          </label>

          <div className="flex justify-end gap-3 pt-2">
            <Link href="/listings">
              <Button variant="secondary" type="button">Cancel</Button>
            </Link>
            <Button type="submit" loading={loading}>Create Listing</Button>
          </div>
        </Card>
      </form>
    </div>
  );
}
