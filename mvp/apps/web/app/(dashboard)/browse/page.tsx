'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { formatCents } from '@/lib/utils';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Card } from '@/components/ui/Card';
import { PageSpinner } from '@/components/ui/Spinner';

interface SearchResult {
  id: string;
  companyId: string;
  companyName: string;
  serviceArea: string[];
  serviceName: string;
  serviceCategory: string;
  description: string | null;
  rewardCents: number;
  qualifiedBonusCents: number;
  rank: number;
}

interface SearchResponse {
  data: SearchResult[];
  cursor: string | null;
  hasMore: boolean;
}

export default function BrowsePage() {
  const [query, setQuery] = useState('');
  const [serviceArea, setServiceArea] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ q: query.trim(), limit: '20' });
      if (serviceArea.trim()) qs.set('serviceArea', serviceArea.trim());
      const res = await apiFetch<SearchResponse>(`/v1/listings/search?${qs.toString()}`);
      setResults(res.data);
      setSearched(true);
    } catch {
      setError('Search failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Browse Listings</h1>
      <p className="text-sm text-gray-500 mb-6">
        Find businesses that pay for referral leads and submit customers you can&apos;t serve.
      </p>

      {/* Search form */}
      <form onSubmit={(e) => void handleSearch(e)} className="flex gap-3 mb-6">
        <div className="flex-1">
          <Input
            placeholder="Search by service type, e.g. HVAC, plumbing…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
          />
        </div>
        <Input
          placeholder="Service area (ZIP or city)"
          className="w-48"
          value={serviceArea}
          onChange={(e) => {
            setServiceArea(e.target.value);
          }}
        />
        <Button type="submit" loading={loading}>
          Search
        </Button>
      </form>

      {error && <Alert className="mb-4">{error}</Alert>}

      {loading && <PageSpinner />}

      {!loading && searched && results.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p className="text-sm">No listings found for &ldquo;{query}&rdquo;.</p>
          <p className="text-xs mt-1">
            Try a different search term or remove the service area filter.
          </p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-3">
          {results.map((r) => (
            <Card key={r.id}>
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0 mr-4">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900">{r.serviceName}</h3>
                    <span className="text-xs text-gray-400">·</span>
                    <span className="text-xs text-gray-500">{r.serviceCategory}</span>
                  </div>
                  <p className="text-sm text-indigo-600 font-medium">{r.companyName}</p>
                  {r.serviceArea.length > 0 && (
                    <p className="text-xs text-gray-400 mt-1">Serves: {r.serviceArea.join(', ')}</p>
                  )}
                  {r.description && (
                    <p className="text-sm text-gray-600 mt-2 line-clamp-2">{r.description}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-bold text-green-600">{formatCents(r.rewardCents)}</p>
                  {r.qualifiedBonusCents > 0 && (
                    <p className="text-xs text-gray-500">
                      +{formatCents(r.qualifiedBonusCents)} bonus
                    </p>
                  )}
                  <Link href={`/browse/${r.id}`} className="mt-3 block">
                    <Button size="sm" className="mt-2">
                      Submit Lead
                    </Button>
                  </Link>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {!searched && !loading && (
        <div className="text-center py-16 text-gray-400">
          <svg
            className="w-12 h-12 mx-auto mb-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <p className="text-sm">Search for a service type to find listings.</p>
        </div>
      )}
    </div>
  );
}
