import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthLayout } from '../components/layout/AuthLayout';
import { Button } from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';
import { Alert } from '../components/ui/Alert';
import { api } from '../lib/api';
import type { RegisterResponse } from '../types/api';

type FieldErrors = Record<string, string>;

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [success, setSuccess] = useState<{ devToken?: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    if (password !== confirm) {
      setFieldErrors({ confirm: 'Passwords do not match' });
      return;
    }
    setLoading(true);
    const res = await api<RegisterResponse>('/api/auth/register', {
      method: 'POST',
      body: { email, password, name: name || undefined },
      skipAuth: true,
    });
    setLoading(false);
    if (!res.success) {
      if (res.error.code === 'VALIDATION_ERROR' && res.error.details) {
        const errs: FieldErrors = {};
        for (const d of res.error.details) errs[d.path] = d.message;
        setFieldErrors(errs);
      } else {
        setError(res.error.message);
      }
      return;
    }
    setSuccess({ devToken: res.data.devToken });
  }

  if (success) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle="We sent a verification link to your inbox."
        footer={
          <Link to="/login" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Continue to sign in
          </Link>
        }
      >
        <Alert tone="success">
          Account created. Open the verification link to activate your account.
        </Alert>
        {success.devToken && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-900/60 dark:bg-amber-950/40">
            <p className="mb-2 font-medium uppercase tracking-wide text-amber-800 dark:text-amber-300">
              Dev shortcut
            </p>
            <p className="text-amber-900 dark:text-amber-200">
              No SMTP configured. Use this dev-only link to verify directly:
            </p>
            <a
              href={`/verify-email?token=${encodeURIComponent(success.devToken)}`}
              className="mt-2 block break-all font-mono text-xs text-indigo-700 hover:underline dark:text-indigo-300"
            >
              /verify-email?token={success.devToken}
            </a>
          </div>
        )}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create account"
      subtitle="Track anything on the web."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <FormField
          label="Name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fieldErrors.name}
          placeholder="Optional"
        />
        <FormField
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
        />
        <FormField
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          hint="At least 8 characters."
        />
        <FormField
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={fieldErrors.confirm}
        />
        <Button type="submit" loading={loading} className="w-full">
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
