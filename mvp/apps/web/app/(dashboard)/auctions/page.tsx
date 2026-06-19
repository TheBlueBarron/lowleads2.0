'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch, ApiError } from '@/lib/api';
import { formatCents } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert } from '@/components/ui/Alert';
import { PageSpinner } from '@/components/ui/Spinner';
import type { Category } from '@lowleads/shared-types';

interface BidCredit {
  balanceCents: number;
  transactions: { id: string; type: string; amountCents: number; createdAt: string }[];
}

interface AuctionState {
  zip: string;
  categoryId: string;
  periodMonth: string;
  status: string;
  currentPriceCents: number;
  leaderCompanyName: string | null;
  leaderIsYou: boolean;
  yourMaxBidCents: number | null;
  floorPriceCents: number;
}

interface MyBid {
  auctionId: string;
  zip: string;
  categoryId: string;
  periodMonth: string;
  status: string;
  yourMaxBidCents: number;
  won: boolean | null;
  clearingPriceCents: number | null;
}

export default function AuctionsPage() {
  const [credit, setCredit] = useState<BidCredit | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [myBids, setMyBids] = useState<MyBid[]>([]);
  const [loading, setLoading] = useState(true);

  const [zip, setZip] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [auction, setAuction] = useState<AuctionState | null>(null);
  const [lookupError, setLookupError] = useState('');
  const [maxBid, setMaxBid] = useState('');
  const [bidError, setBidError] = useState('');
  const [bidding, setBidding] = useState(false);

  async function refresh() {
    const [cr, bids] = await Promise.all([
      apiFetch<BidCredit>('/v1/auctions/me/bid-credit').catch(() => null),
      apiFetch<{ data: MyBid[] }>('/v1/auctions/me/bids').catch(() => ({ data: [] })),
    ]);
    if (cr) setCredit(cr);
    setMyBids(bids.data);
  }

  useEffect(() => {
    void (async () => {
      try {
        const cats = await apiFetch<{ data: Category[] }>('/v1/categories');
        setCategories(cats.data.filter((c) => c.isLeaf));
        await refresh();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleLookup(e: FormEvent) {
    e.preventDefault();
    setLookupError('');
    setAuction(null);
    if (!zip || !categoryId) {
      setLookupError('Enter a ZIP and pick a category.');
      return;
    }
    try {
      const state = await apiFetch<AuctionState>(
        `/v1/auctions/${encodeURIComponent(zip)}/${categoryId}/current`,
      );
      setAuction(state);
    } catch (err) {
      setLookupError(err instanceof ApiError ? err.message : 'Lookup failed.');
    }
  }

  async function handleBid(e: FormEvent) {
    e.preventDefault();
    setBidError('');
    const cents = Math.round(parseFloat(maxBid) * 100);
    if (isNaN(cents) || cents < 100) {
      setBidError('Enter a valid max bid.');
      return;
    }
    setBidding(true);
    try {
      const state = await apiFetch<AuctionState>(
        `/v1/auctions/${encodeURIComponent(zip)}/${categoryId}/bid`,
        { method: 'POST', body: { maxBidCents: cents } },
      );
      setAuction({
        ...state,
        floorPriceCents: auction?.floorPriceCents ?? state.currentPriceCents,
      });
      setMaxBid('');
      await refresh();
    } catch (err) {
      setBidError(err instanceof ApiError ? err.message : 'Bid failed.');
    } finally {
      setBidding(false);
    }
  }

  if (loading) return <PageSpinner />;

  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? id;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Recommended Placement Auctions</h1>
        <p className="text-sm text-gray-500 mt-1">
          Win the monthly auction for a ZIP &amp; category to be pinned #1 when companies refer
          leads there. Sealed max bids — you only ever pay one dollar above the next-highest bidder.
        </p>
      </div>

      {/* Bid credit */}
      <Card>
        <p className="text-xs text-gray-500">Bid credit balance</p>
        <p className="text-2xl font-bold text-gray-900 mt-1">
          {credit ? formatCents(credit.balanceCents) : '—'}
        </p>
        <p className="text-xs text-gray-400 mt-1">
          Accrues $1,000/mo with your Pro membership. Only the winning bid&apos;s clearing price is
          ever drawn down.
        </p>
      </Card>

      {/* Lookup + bid */}
      <Card>
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Find an auction</h2>
        {lookupError && <Alert className="mb-4">{lookupError}</Alert>}
        <form onSubmit={(e) => void handleLookup(e)} className="flex flex-wrap items-end gap-3">
          <Input
            label="ZIP code"
            value={zip}
            onChange={(e) => {
              setZip(e.target.value);
            }}
            placeholder="85001"
            className="w-32"
          />
          <div className="flex-1 min-w-[12rem]">
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
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
          <Button type="submit" variant="secondary">
            Look up
          </Button>
        </form>

        {auction && (
          <div className="mt-6 border-t border-gray-100 pt-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-gray-500">Current price</p>
                <p className="text-lg font-bold text-gray-900">
                  {formatCents(auction.currentPriceCents)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Leader</p>
                <p className="text-lg font-semibold text-gray-800">
                  {auction.leaderIsYou ? 'You' : (auction.leaderCompanyName ?? 'Unsold (house)')}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Your max</p>
                <p className="text-lg font-semibold text-gray-800">
                  {auction.yourMaxBidCents != null ? formatCents(auction.yourMaxBidCents) : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Status</p>
                <p className="text-lg font-semibold text-gray-800 capitalize">{auction.status}</p>
              </div>
            </div>

            {auction.status === 'open' ? (
              <form onSubmit={(e) => void handleBid(e)} className="mt-4 flex items-end gap-3">
                <Input
                  label="Your max bid"
                  type="number"
                  step="1"
                  min="1"
                  prefix="$"
                  value={maxBid}
                  onChange={(e) => {
                    setMaxBid(e.target.value);
                  }}
                  placeholder="2000"
                  className="w-40"
                  hint="Can be raised later, never lowered"
                />
                <Button type="submit" loading={bidding}>
                  {auction.yourMaxBidCents != null ? 'Raise bid' : 'Place bid'}
                </Button>
              </form>
            ) : (
              <p className="mt-4 text-sm text-gray-500">This auction is closed.</p>
            )}
            {bidError && <Alert className="mt-3">{bidError}</Alert>}
          </div>
        )}
      </Card>

      {/* My bids */}
      <Card padding={false}>
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Your auctions</h2>
        </div>
        {myBids.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">No bids yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase">ZIP</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">
                  Category
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">
                  Your max
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {myBids.map((b) => (
                <tr key={b.auctionId} className="hover:bg-gray-50">
                  <td className="px-6 py-3 text-gray-800">{b.zip}</td>
                  <td className="px-4 py-3 text-gray-700">{catName(b.categoryId)}</td>
                  <td className="px-4 py-3 text-gray-700">{formatCents(b.yourMaxBidCents)}</td>
                  <td className="px-4 py-3 text-gray-600 capitalize">{b.status}</td>
                  <td className="px-4 py-3">
                    {b.status !== 'closed' ? (
                      <span className="text-gray-400">—</span>
                    ) : b.won ? (
                      <span className="text-green-600 font-medium">
                        Won ·{' '}
                        {b.clearingPriceCents != null ? formatCents(b.clearingPriceCents) : ''}
                      </span>
                    ) : (
                      <span className="text-gray-500">Lost</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
