'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { API_URL } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';
import { PageSpinner } from '@/components/ui/Spinner';

export default function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('No verification token provided.');
      return;
    }

    void (async () => {
      try {
        const res = await fetch(`${API_URL}/v1/auth/verify-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = (await res.json()) as { message?: string; error?: { message?: string } };
        if (res.ok) {
          setStatus('success');
          setMessage(data.message ?? 'Email verified successfully.');
        } else {
          setStatus('error');
          setMessage(data.error?.message ?? 'Verification failed.');
        }
      } catch {
        setStatus('error');
        setMessage('An error occurred. Please try again.');
      }
    })();
  }, [token]);

  return (
    <>
      <h2 className="text-xl font-semibold text-gray-900 mb-6">Email verification</h2>
      {status === 'loading' && <PageSpinner />}
      {status === 'success' && (
        <>
          <Alert variant="success">{message}</Alert>
          <p className="text-center mt-6">
            <Link
              href="/login"
              className="text-indigo-600 hover:text-indigo-500 text-sm font-medium"
            >
              Sign in now
            </Link>
          </p>
        </>
      )}
      {status === 'error' && (
        <>
          <Alert>{message}</Alert>
          <p className="text-center mt-6">
            <Link href="/login" className="text-indigo-600 hover:text-indigo-500 text-sm">
              Back to sign in
            </Link>
          </p>
        </>
      )}
    </>
  );
}
