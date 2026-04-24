import type { InputHTMLAttributes, ReactNode } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string | null;
  hint?: ReactNode;
};

export function FormField({ label, error, hint, id, className = '', ...rest }: Props) {
  const inputId = id ?? `f-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div className={className}>
      <label
        htmlFor={inputId}
        className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
      >
        {label}
      </label>
      <input
        id={inputId}
        {...rest}
        className={`block w-full rounded-md border bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:bg-gray-900 dark:text-gray-100 ${
          error
            ? 'border-red-400 focus:border-red-500 focus:ring-red-500 dark:border-red-500'
            : 'border-gray-300 dark:border-gray-700'
        }`}
      />
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {!error && hint && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
    </div>
  );
}
