'use client';

export const dynamic = 'force-dynamic';

import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { API_URL, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert } from '@/components/ui/Alert';

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/v1/auth/password/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: { message?: string } };
        throw new ApiError('RESET_ERROR', err.error?.message ?? 'Reset failed', res.status);
      }
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <Alert>Invalid or missing reset token. Please request a new password reset link.</Alert>
    );
  }

  return (
    <>
      <h2 className="text-xl font-semibold text-gray-900 mb-6">Set new password</h2>

      {success ? (
        <>
          <Alert variant="success">Password reset successfully.</Alert>
          <p className="text-center mt-6">
            <Link
              href="/login"
              className="text-indigo-600 hover:text-indigo-500 text-sm font-medium"
            >
              Sign in now
            </Link>
          </p>
        </>
      ) : (
        <>
          {error && <Alert className="mb-4">{error}</Alert>}
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <Input
              label="New password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              hint="Minimum 12 characters"
            />
            <Button type="submit" className="w-full" loading={loading}>
              Reset password
            </Button>
          </form>
        </>
      )}
    </>
  );
}
