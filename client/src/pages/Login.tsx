import { type FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../components/layout/AuthLayout';
import { Button } from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';
import { Alert } from '../components/ui/Alert';
import { api } from '../lib/api';
import { useAuth } from '../stores/auth';
import type { LoginResponse } from '../types/api';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuth((s) => s.setSession);
  const setUser = useAuth((s) => s.setUser);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await api<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
      skipAuth: true,
      // cookie refresh needs credentials on the auth endpoints too
    });
    setLoading(false);
    if (!res.success) {
      setError(res.error.message);
      return;
    }
    setSession({
      accessToken: res.data.accessToken,
      refreshExpiresAt: res.data.refreshExpiresAt,
    });
    setUser(res.data.user);
    const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/';
    navigate(from, { replace: true });
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Welcome back."
      footer={
        <>
          New here?{' '}
          <Link
            to="/register"
            className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <FormField
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <FormField
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="flex items-center justify-between">
          <Link
            to="/forgot-password"
            className="text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Forgot password?
          </Link>
          <Button type="submit" loading={loading}>
            Sign in
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
