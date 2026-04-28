'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { API_URL } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert } from '@/components/ui/Alert';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch(`${API_URL}/v1/auth/password/reset-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch { /* always show success */ }
    setLoading(false);
    setSubmitted(true);
  }

  return (
    <>
      <h2 className="text-xl font-semibold text-gray-900 mb-2">Reset your password</h2>
      <p className="text-sm text-gray-500 mb-6">
        Enter your email and we&apos;ll send a reset link if an account exists.
      </p>

      {submitted ? (
        <>
          <Alert variant="success">
            If an account exists for <strong>{email}</strong>, a reset link has been sent.
          </Alert>
          <p className="text-center mt-6">
            <Link href="/login" className="text-indigo-600 hover:text-indigo-500 text-sm">
              Back to sign in
            </Link>
          </p>
        </>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <Input
            label="Email address"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
          <Button type="submit" className="w-full" loading={loading}>
            Send reset link
          </Button>
          <p className="text-center">
            <Link href="/login" className="text-sm text-gray-500 hover:text-gray-700">
              Back to sign in
            </Link>
          </p>
        </form>
      )}
    </>
  );
}
