import { create } from 'zustand';

export type ToastTone = 'success' | 'error' | 'info';

export type Toast = {
  id: string;
  tone: ToastTone;
  message: string;
};

type ToastState = {
  toasts: Toast[];
  push: (tone: ToastTone, message: string, ttl?: number) => void;
  dismiss: (id: string) => void;
};

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (tone, message, ttl = 4_000) => {
    const id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    set({ toasts: [...get().toasts, { id, tone, message }] });
    setTimeout(() => get().dismiss(id), ttl);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = {
  success: (m: string) => useToasts.getState().push('success', m),
  error: (m: string) => useToasts.getState().push('error', m),
  info: (m: string) => useToasts.getState().push('info', m),
};
