import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../stores/auth';

function isExpired(expiry: string | null): boolean {
  if (!expiry) return true;
  return Date.now() >= new Date(expiry).getTime();
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const accessToken = useAuth((s) => s.accessToken);
  const refreshExpiresAt = useAuth((s) => s.refreshExpiresAt);
  const location = useLocation();
  if (!accessToken || isExpired(refreshExpiresAt)) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}

export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const accessToken = useAuth((s) => s.accessToken);
  if (accessToken) return <Navigate to="/" replace />;
  return <>{children}</>;
}
