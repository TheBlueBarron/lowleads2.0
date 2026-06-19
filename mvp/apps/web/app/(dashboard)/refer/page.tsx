'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch, ApiError } from '@/lib/api';
import { formatCents } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert } from '@/components/ui/Alert';
import type { Category } from '@lowleads/shared-types';

interface RankedCompany {
  listingId: string;
  companyId: string;
  companyName: string;
  serviceName: string;
  serviceCategory: string;
  rewardCents: number;
  qualifiedBonusCents: number;
  closeRate: number;
  score: number;
  recommended: boolean;
}

const EMPTY = {
  customerFirstName: '',
  customerLastInitial: '',
  customerPhone: '',
  customerEmail: '',
  notes: '',
  customerAddressStreet: '',
  customerZip: '',
};

export default function ReferPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState({ ...EMPTY });
  const [categoryId, setCategoryId] = useState('');
  const [q, setQ] = useState('');

  const [companies, setCompanies] = useState<RankedCompany[] | null>(null);
  const [finding, setFinding] = useState(false);
  const [error, setError] = useState('');
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [doneCompany, setDoneCompany] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const cats = await apiFetch<{ data: Category[] }>('/v1/categories').catch(() => ({
        data: [],
      }));
      setCategories(cats.data.filter((c) => c.isLeaf));
    })();
  }, []);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleFind(e: FormEvent) {
    e.preventDefault();
    setError('');
    setDoneCompany(null);
    if (!form.customerZip || !categoryId) {
      setError('Customer ZIP and a category are required to find companies.');
      return;
    }
    setFinding(true);
    try {
      const qs = new URLSearchParams({ zip: form.customerZip, category_id: categoryId });
      if (q) qs.set('q', q);
      const res = await apiFetch<{ data: RankedCompany[] }>(
        `/v1/leads/refer/companies?${qs.toString()}`,
      );
      setCompanies(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to find companies.');
    } finally {
      setFinding(false);
    }
  }

  async function handleSelect(listingId: string, companyName: string) {
    setSubmittingId(listingId);
    setError('');
    try {
      await apiFetch('/v1/leads', {
        method: 'POST',
        body: {
          listingId,
          customerFirstName: form.customerFirstName,
          customerLastInitial: form.customerLastInitial,
          customerPhone: form.customerPhone,
          ...(form.customerEmail ? { customerEmail: form.customerEmail } : {}),
          ...(form.notes ? { notes: form.notes } : {}),
          ...(form.customerAddressStreet
            ? { customerAddressStreet: form.customerAddressStreet }
            : {}),
          customerZip: form.customerZip,
        },
      });
      setDoneCompany(companyName);
      setCompanies(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit the lead.');
    } finally {
      setSubmittingId(null);
    }
  }

  function referAnother() {
    // Prefill name/address from the prior referral (§5.3 convenience).
    setForm((f) => ({
      ...EMPTY,
      customerFirstName: f.customerFirstName,
      customerLastInitial: f.customerLastInitial,
      customerPhone: f.customerPhone,
      customerAddressStreet: f.customerAddressStreet,
      customerZip: f.customerZip,
    }));
    setCategoryId('');
    setQ('');
    setCompanies(null);
    setDoneCompany(null);
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Refer a customer</h1>
        <p className="text-sm text-gray-500 mt-1">
          Enter the customer&apos;s details, pick the service they need, then choose which company
          to send the lead to.
        </p>
      </div>

      {error && <Alert>{error}</Alert>}

      {doneCompany && (
        <Alert variant="success" title="Lead sent!">
          Your referral was sent to {doneCompany}.{' '}
          <button onClick={referAnother} className="underline font-medium">
            Refer another problem for this customer
          </button>
        </Alert>
      )}

      {/* Step 1: customer + category */}
      <Card>
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Customer details</h2>
        <form onSubmit={(e) => void handleFind(e)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="First name"
              required
              value={form.customerFirstName}
              onChange={(e) => {
                set('customerFirstName', e.target.value);
              }}
            />
            <Input
              label="Last initial"
              required
              maxLength={1}
              value={form.customerLastInitial}
              onChange={(e) => {
                set('customerLastInitial', e.target.value);
              }}
            />
          </div>
          <Input
            label="Phone"
            required
            value={form.customerPhone}
            onChange={(e) => {
              set('customerPhone', e.target.value);
            }}
            placeholder="6025551234"
          />
          <Input
            label="Email (optional)"
            type="email"
            value={form.customerEmail}
            onChange={(e) => {
              set('customerEmail', e.target.value);
            }}
          />
          <Input
            label="Street address (optional)"
            value={form.customerAddressStreet}
            onChange={(e) => {
              set('customerAddressStreet', e.target.value);
            }}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="ZIP"
              required
              value={form.customerZip}
              onChange={(e) => {
                set('customerZip', e.target.value);
              }}
              placeholder="85001"
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Service needed</label>
              <select
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                }}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <option value="">Select a category…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Input
            label="Notes (optional)"
            value={form.notes}
            onChange={(e) => {
              set('notes', e.target.value);
            }}
          />
          <Button type="submit" loading={finding}>
            Find companies
          </Button>
        </form>
      </Card>

      {/* Step 2: ranked companies */}
      {companies && (
        <Card padding={false}>
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Choose a company</h2>
            <Input
              placeholder="Search by name…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
              }}
              className="w-48"
            />
          </div>
          {companies.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">
              No eligible companies for this ZIP and category.
            </p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {companies.map((c) => (
                <li key={c.listingId} className="flex items-center justify-between px-6 py-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-gray-900">{c.companyName}</p>
                      {c.recommended && (
                        <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 rounded px-2 py-0.5">
                          Recommended
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {c.serviceName} · {Math.round(c.closeRate * 100)}% close rate · reward{' '}
                      {formatCents(c.rewardCents)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    loading={submittingId === c.listingId}
                    onClick={() => void handleSelect(c.listingId, c.companyName)}
                  >
                    Send lead
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
