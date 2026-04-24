import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../stores/auth';

export function RequireAuth({ children }: { children: ReactNode }) {
  const accessToken = useAuth((s) => s.accessToken);
  const location = useLocation();
  if (!accessToken) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}

export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const accessToken = useAuth((s) => s.accessToken);
  if (accessToken) return <Navigate to="/" replace />;
  return <>{children}</>;
}
