'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { API_URL, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert } from '@/components/ui/Alert';

export default function JoinPage() {
  const [form, setForm] = useState({
    email: '',
    password: '',
    displayName: '',
    companyJoinCode: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/v1/auth/register-technician`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          companyJoinCode: form.companyJoinCode.trim().toUpperCase(),
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: { message?: string } };
        throw new ApiError('JOIN_ERROR', err.error?.message ?? 'Registration failed', res.status);
      }
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <>
        <Alert variant="success" title="Account created!">
          Check your email to verify your account before signing in.
        </Alert>
        <p className="text-center mt-6">
          <Link href="/login" className="text-indigo-600 hover:text-indigo-500 text-sm font-medium">
            Go to sign in
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h2 className="text-xl font-semibold text-gray-900 mb-1">Join your company</h2>
      <p className="text-sm text-gray-500 mb-6">
        Enter the join code your employer gave you to create your employee account.
      </p>

      {error && <Alert className="mb-4">{error}</Alert>}

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <Input
          label="Company join code"
          required
          minLength={4}
          value={form.companyJoinCode}
          onChange={(e) => {
            setForm((f) => ({ ...f, companyJoinCode: e.target.value.toUpperCase() }));
          }}
          placeholder="ABCD2345"
          hint="Ask your company owner for this code"
        />
        <Input
          label="Your name"
          required
          minLength={1}
          value={form.displayName}
          onChange={(e) => {
            setForm((f) => ({ ...f, displayName: e.target.value }));
          }}
          placeholder="Jordan Smith"
        />
        <Input
          label="Email address"
          type="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={(e) => {
            setForm((f) => ({ ...f, email: e.target.value }));
          }}
          placeholder="you@company.com"
        />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          value={form.password}
          onChange={(e) => {
            setForm((f) => ({ ...f, password: e.target.value }));
          }}
          placeholder="••••••••••••"
          hint="Minimum 12 characters"
        />

        <Button type="submit" className="w-full" loading={loading}>
          Create employee account
        </Button>
      </form>

      <p className="text-center text-sm text-gray-600 mt-6">
        Already have an account?{' '}
        <Link href="/login" className="text-indigo-600 hover:text-indigo-500 font-medium">
          Sign in
        </Link>
      </p>
    </>
  );
}
