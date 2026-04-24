import { create } from 'zustand';

export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'smartscrape-theme';

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* ignore */
  }
  return 'system';
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(pref: ThemePref): void {
  const dark = pref === 'dark' || (pref === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', dark);
}

type ThemeState = {
  pref: ThemePref;
  set: (pref: ThemePref) => void;
  toggle: () => void;
};

export const useTheme = create<ThemeState>((set, get) => ({
  pref: readPref(),
  set: (pref) => {
    try {
      localStorage.setItem(KEY, pref);
    } catch {
      /* ignore */
    }
    applyTheme(pref);
    set({ pref });
  },
  toggle: () => {
    // Cycle: system -> light -> dark -> system.
    const cur = get().pref;
    const next: ThemePref = cur === 'system' ? 'light' : cur === 'light' ? 'dark' : 'system';
    get().set(next);
  },
}));

// Re-apply when the system preference changes and the user is on 'system'.
if (typeof window !== 'undefined') {
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const pref = useTheme.getState().pref;
    if (pref === 'system') applyTheme('system');
  });
  applyTheme(readPref());
}
