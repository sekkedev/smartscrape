import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PublicUser, Session } from '../types/api';

type AuthState = {
  accessToken: string | null;
  refreshToken: string | null;
  refreshExpiresAt: string | null;
  user: PublicUser | null;
  setSession: (session: Session) => void;
  setUser: (user: PublicUser | null) => void;
  clear: () => void;
};

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      refreshExpiresAt: null,
      user: null,
      setSession: (session) =>
        set({
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          refreshExpiresAt: session.refreshExpiresAt,
        }),
      setUser: (user) => set({ user }),
      clear: () =>
        set({
          accessToken: null,
          refreshToken: null,
          refreshExpiresAt: null,
          user: null,
        }),
    }),
    {
      name: 'smartscrape-auth',
      // Only persist session-relevant fields; user is refetched on mount.
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        refreshExpiresAt: state.refreshExpiresAt,
        user: state.user,
      }),
    },
  ),
);
