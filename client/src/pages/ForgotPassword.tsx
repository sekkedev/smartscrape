import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthLayout } from '../components/layout/AuthLayout';
import { Button } from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';
import { Alert } from '../components/ui/Alert';
import { api } from '../lib/api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await api<{ sent: boolean }>('/api/auth/forgot-password', {
      method: 'POST',
      body: { email },
      skipAuth: true,
    });
    setLoading(false);
    if (!res.success) {
      setError(res.error.message);
      return;
    }
    setSent(true);
  }

  return (
    <AuthLayout
      title="Reset password"
      subtitle="We'll send a reset link if an account exists for this email."
      footer={
        <Link to="/login" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <Alert tone="success">
          If an account matches <span className="font-mono">{email}</span>, a reset link is on its way.
          The link expires in 1 hour.
        </Alert>
      ) : (
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
          <Button type="submit" loading={loading} className="w-full">
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
