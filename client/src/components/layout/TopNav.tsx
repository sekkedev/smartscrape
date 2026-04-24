import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../../stores/auth';

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
              <button
                onClick={() => {
                  setOpen(false);
                  clear();
                }}
                className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
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
