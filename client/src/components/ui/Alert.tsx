import type { ReactNode } from 'react';

type Props = {
  tone: 'info' | 'success' | 'error';
  children: ReactNode;
  className?: string;
};

const tones: Record<Props['tone'], string> = {
  info: 'border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-200',
  success:
    'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200',
  error:
    'border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200',
};

export function Alert({ tone, children, className = '' }: Props) {
  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${tones[tone]} ${className}`}>
      {children}
    </div>
  );
}
