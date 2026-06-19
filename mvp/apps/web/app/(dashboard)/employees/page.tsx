'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';
import { formatCents } from '@/lib/utils';
import { Card, EmptyState } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { PageSpinner } from '@/components/ui/Spinner';

interface CompanyProfile {
  joinCode: string;
}

interface EmployeePerformance {
  technicianId: string;
  displayName: string;
  isActive: boolean;
  leadsSubmitted: number;
  leadsClosed: number;
  closeRate: number;
  totalEarnedCents: number;
  balanceCents: number;
}

interface PerformanceResponse {
  data: EmployeePerformance[];
  total: number;
}

export default function EmployeesPage() {
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [employees, setEmployees] = useState<EmployeePerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const [company, perf] = await Promise.all([
          apiFetch<CompanyProfile>('/v1/companies/me'),
          apiFetch<PerformanceResponse>('/v1/technicians/performance'),
        ]);
        setJoinCode(company.joinCode);
        setEmployees(perf.data);
      } catch {
        setError('Failed to load employees.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleRegenerate() {
    if (
      !window.confirm(
        'Regenerate the join code? The current code will stop working immediately and you will need to share the new one.',
      )
    ) {
      return;
    }
    setRegenerating(true);
    setError('');
    try {
      const res = await apiFetch<{ joinCode: string }>('/v1/companies/me/join-code/regenerate', {
        method: 'POST',
      });
      setJoinCode(res.joinCode);
      setCopied(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to regenerate join code.');
    } finally {
      setRegenerating(false);
    }
  }

  function handleCopy() {
    if (!joinCode) return;
    void navigator.clipboard.writeText(joinCode);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  }

  if (loading) return <PageSpinner />;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Employees</h1>

      {error && <Alert>{error}</Alert>}

      {/* Join code */}
      <Card>
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Employee join code</h2>
        <p className="text-sm text-gray-500 mb-4">
          Share this code with your employees so they can create their own accounts at{' '}
          <span className="font-medium">/join</span>. Each closed referral they submit splits the
          reward 50/50 between them and your company.
        </p>
        <div className="flex items-center gap-3">
          <code className="px-4 py-2 rounded-lg bg-gray-100 text-lg font-mono font-semibold tracking-widest text-gray-900">
            {joinCode}
          </code>
          <Button variant="secondary" size="sm" onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            loading={regenerating}
            onClick={() => void handleRegenerate()}
            className="text-red-500 hover:text-red-700 hover:bg-red-50"
          >
            Regenerate
          </Button>
        </div>
      </Card>

      {/* Performance table */}
      {employees.length === 0 ? (
        <EmptyState
          title="No employees yet"
          description="Share your join code above and employees can self-register to start submitting referrals."
        />
      ) : (
        <Card padding={false}>
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Performance</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Employee
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Leads
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Closed
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Close rate
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Earned
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Balance
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {employees.map((emp) => (
                <tr key={emp.technicianId} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-medium text-gray-900">{emp.displayName}</p>
                    {!emp.isActive && <p className="text-xs text-gray-400 mt-0.5">Inactive</p>}
                  </td>
                  <td className="px-4 py-4 text-gray-700">{emp.leadsSubmitted}</td>
                  <td className="px-4 py-4 text-gray-700">{emp.leadsClosed}</td>
                  <td className="px-4 py-4 text-gray-700">{(emp.closeRate * 100).toFixed(0)}%</td>
                  <td className="px-4 py-4 text-gray-700">{formatCents(emp.totalEarnedCents)}</td>
                  <td className="px-4 py-4 font-medium text-green-600">
                    {formatCents(emp.balanceCents)}
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
