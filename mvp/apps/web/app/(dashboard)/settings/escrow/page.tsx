'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch, ApiError } from '@/lib/api';
import { formatCents, formatDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert } from '@/components/ui/Alert';
import { Card } from '@/components/ui/Card';
import { PageSpinner } from '@/components/ui/Spinner';

interface EscrowBalance {
  balanceCents: number;
  reservedCents: number;
  availableCents: number;
}

interface EscrowTx {
  id: string;
  type: string;
  amountCents: number;
  balanceAfterCents: number;
  leadId: string | null;
  stripePaymentIntentId: string | null;
  createdAt: string;
}

interface EscrowHistoryResponse {
  transactions: EscrowTx[];
  cursor: string | null;
  hasMore: boolean;
}

interface CheckoutSession {
  sessionId: string;
  url: string;
}

const txMeta: Record<string, { label: string; positive: boolean }> = {
  deposit: { label: 'Deposit', positive: true },
  replenish: { label: 'Replenish', positive: true },
  release: { label: 'Release', positive: true },
  refund: { label: 'Refund', positive: true },
  reserve: { label: 'Reserve', positive: false },
  fee: { label: 'Fee', positive: false },
};

export default function EscrowPage() {
  const [balance, setBalance] = useState<EscrowBalance | null>(null);
  const [history, setHistory] = useState<EscrowTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [depositAmount, setDepositAmount] = useState('');
  const [depositing, setDepositing] = useState(false);
  const [depositError, setDepositError] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const [bal, hist] = await Promise.all([
          apiFetch<EscrowBalance>('/v1/companies/me/escrow'),
          apiFetch<EscrowHistoryResponse>('/v1/companies/me/escrow/history?limit=50'),
        ]);
        setBalance(bal);
        setHistory(hist.transactions);
      } catch {
        /* silently show empty */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleDeposit(e: FormEvent) {
    e.preventDefault();
    setDepositError('');
    const amountCents = Math.round(parseFloat(depositAmount) * 100);
    if (isNaN(amountCents) || amountCents < 1000) {
      setDepositError('Minimum deposit is $10.00.');
      return;
    }
    setDepositing(true);
    try {
      const session = await apiFetch<CheckoutSession>('/v1/billing/deposit', {
        method: 'POST',
        body: {
          amountCents,
          returnUrl: `${window.location.origin}/settings/escrow`,
        },
      });
      window.location.href = session.url;
    } catch (err) {
      setDepositError(err instanceof ApiError ? err.message : 'Failed to create checkout session.');
      setDepositing(false);
    }
  }

  if (loading) return <PageSpinner />;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Escrow Balance</h1>

      {/* Balance summary */}
      {balance && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <p className="text-xs text-gray-500">Total Balance</p>
            <p className="text-xl font-bold text-gray-900 mt-1">
              {formatCents(balance.balanceCents)}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-gray-500">Reserved</p>
            <p className="text-xl font-bold text-gray-700 mt-1">
              {formatCents(balance.reservedCents)}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-gray-500">Available</p>
            <p className="text-xl font-bold text-green-600 mt-1">
              {formatCents(balance.availableCents)}
            </p>
          </Card>
        </div>
      )}

      {/* Deposit form */}
      <Card>
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Add Funds</h2>
        {depositError && <Alert className="mb-4">{depositError}</Alert>}
        <form onSubmit={(e) => void handleDeposit(e)} className="flex gap-3">
          <Input
            type="number"
            step="5"
            min="10"
            placeholder="100.00"
            value={depositAmount}
            onChange={(e) => {
              setDepositAmount(e.target.value);
            }}
            prefix="$"
            className="flex-1"
          />
          <Button type="submit" loading={depositing}>
            Deposit via Stripe
          </Button>
        </form>
        <p className="text-xs text-gray-400 mt-2">Minimum $10.00. Processed securely via Stripe.</p>
      </Card>

      {/* Transaction history */}
      <Card padding={false}>
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Transaction History</h2>
        </div>
        {history.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">No transactions yet.</p>
        ) : (
          <ul className="divide-y divide-gray-50">
            {history.map((tx) => {
              const meta = txMeta[tx.type] ?? { label: tx.type, positive: true };
              return (
                <li key={tx.id} className="flex items-center justify-between px-6 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{meta.label}</p>
                    <p className="text-xs text-gray-400">{formatDateTime(tx.createdAt)}</p>
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-sm font-medium ${
                        meta.positive ? 'text-green-600' : 'text-gray-700'
                      }`}
                    >
                      {meta.positive ? '+' : '-'}
                      {formatCents(tx.amountCents)}
                    </p>
                    <p className="text-xs text-gray-400">
                      Balance: {formatCents(tx.balanceAfterCents)}
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
