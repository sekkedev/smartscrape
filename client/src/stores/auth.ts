import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PublicUser, Session } from '../types/api';

type AuthState = {
  accessToken: string | null;
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
      refreshExpiresAt: null,
      user: null,
      setSession: (session) =>
        set({
          accessToken: session.accessToken,
          refreshExpiresAt: session.refreshExpiresAt,
        }),
      setUser: (user) => set({ user }),
      clear: () =>
        set({
          accessToken: null,
          refreshExpiresAt: null,
          user: null,
        }),
    }),
    {
      name: 'smartscrape-auth',
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshExpiresAt: state.refreshExpiresAt,
        user: state.user,
      }),
    },
  ),
);
