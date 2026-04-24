import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../components/layout/AuthLayout';
import { Alert } from '../components/ui/Alert';
import { api } from '../lib/api';
import type { PublicUser } from '../types/api';

type Status = 'pending' | 'success' | 'error';

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [status, setStatus] = useState<Status>('pending');
  const [message, setMessage] = useState<string>('');
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    if (!token) {
      setStatus('error');
      setMessage('Missing verification token.');
      return;
    }
    void (async () => {
      const res = await api<{ user: PublicUser }>('/api/auth/verify-email', {
        method: 'POST',
        body: { token },
        skipAuth: true,
      });
      if (res.success) {
        setStatus('success');
        setMessage(`${res.data.user.email} is verified.`);
      } else {
        setStatus('error');
        setMessage(res.error.message);
      }
    })();
  }, [token]);

  return (
    <AuthLayout
      title="Verify email"
      footer={
        <Link to="/login" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Continue to sign in
        </Link>
      }
    >
      {status === 'pending' && <p className="text-sm text-gray-500">Verifying&hellip;</p>}
      {status === 'success' && <Alert tone="success">{message}</Alert>}
      {status === 'error' && <Alert tone="error">{message}</Alert>}
    </AuthLayout>
  );
}
