'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert } from '@/components/ui/Alert';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [needsMfa, setNeedsMfa] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password, needsMfa ? mfaToken : undefined);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'AUTHENTICATION_ERROR' && err.message.includes('MFA')) {
          setNeedsMfa(true);
          setError('Enter your 6-digit authenticator code.');
        } else {
          setError(err.message);
        }
      } else {
        setError('An unexpected error occurred. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h2 className="text-xl font-semibold text-gray-900 mb-6">Sign in to your account</h2>

      {error && (
        <Alert variant={needsMfa ? 'info' : 'error'} className="mb-4">
          {error}
        </Alert>
      )}

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {!needsMfa ? (
          <>
            <Input
              label="Email address"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              placeholder="you@company.com"
            />
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
              }}
              placeholder="••••••••••••"
            />
            <div className="flex items-center justify-end">
              <Link
                href="/forgot-password"
                className="text-sm text-indigo-600 hover:text-indigo-500"
              >
                Forgot password?
              </Link>
            </div>
          </>
        ) : (
          <Input
            label="Authenticator code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            autoFocus
            value={mfaToken}
            onChange={(e) => {
              setMfaToken(e.target.value);
            }}
            placeholder="000000"
          />
        )}

        <Button type="submit" className="w-full" loading={loading}>
          {needsMfa ? 'Verify' : 'Sign in'}
        </Button>
      </form>

      <p className="text-center text-sm text-gray-600 mt-6">
        Don&apos;t have an account?{' '}
        <Link href="/register" className="text-indigo-600 hover:text-indigo-500 font-medium">
          Register
        </Link>
      </p>
    </>
  );
}
