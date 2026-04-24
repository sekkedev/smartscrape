import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../../stores/auth';
import { useTheme, type ThemePref } from '../../stores/theme';

export function TopNav() {
  const user = useAuth((s) => s.user);
  const clear = useAuth((s) => s.clear);
  const [open, setOpen] = useState(false);

  return (
    <header className="border-b border-gray-200 bg-white/70 backdrop-blur dark:border-gray-800 dark:bg-gray-950/70">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <Link to="/" className="text-sm font-semibold tracking-tight text-gray-900 dark:text-gray-100">
            SmartScrape
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
            <NavItem to="/">Home</NavItem>
            <NavItem to="/jobs">Jobs</NavItem>
            <NavItem to="/notifications">Notifications</NavItem>
            <NavItem to="/settings">Settings</NavItem>
          </nav>
        </div>
        <div className="relative">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-xs font-medium uppercase text-white"
              aria-hidden
            >
              {(user?.name ?? user?.email ?? '?').slice(0, 1)}
            </span>
            <span className="hidden sm:inline">{user?.name ?? user?.email}</span>
          </button>
          {open && (
            <div
              className="absolute right-0 mt-2 w-56 overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-800 dark:bg-gray-900"
              onMouseLeave={() => setOpen(false)}
            >
              <div className="border-b border-gray-100 px-3 py-2 text-xs text-gray-500 dark:border-gray-800">
                {user?.email}
              </div>
              <ThemeRow />
              <button
                onClick={() => {
                  setOpen(false);
                  clear();
                }}
                className="block w-full border-t border-gray-100 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function ThemeRow() {
  const pref = useTheme((s) => s.pref);
  const setPref = useTheme((s) => s.set);
  return (
    <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
      <div className="mb-1.5">Theme</div>
      <div className="flex gap-1 rounded-md border border-gray-200 p-0.5 dark:border-gray-700">
        {THEME_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setPref(opt.value)}
            className={`flex-1 rounded px-2 py-1 text-xs transition ${
              pref === opt.value
                ? 'bg-indigo-600 text-white'
                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `rounded-md px-2.5 py-1.5 text-sm transition ${
          isActive
            ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'
        }`
      }
    >
      {children}
    </NavLink>
  );
}
