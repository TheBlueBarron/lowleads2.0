import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface AlertProps {
  variant?: 'error' | 'success' | 'warning' | 'info';
  title?: string;
  children: ReactNode;
  className?: string;
}

const alertStyles = {
  error: { container: 'bg-red-50 border-red-200', title: 'text-red-800', body: 'text-red-700' },
  success: {
    container: 'bg-green-50 border-green-200',
    title: 'text-green-800',
    body: 'text-green-700',
  },
  warning: {
    container: 'bg-yellow-50 border-yellow-200',
    title: 'text-yellow-800',
    body: 'text-yellow-700',
  },
  info: { container: 'bg-blue-50 border-blue-200', title: 'text-blue-800', body: 'text-blue-700' },
};

export function Alert({ variant = 'error', title, children, className }: AlertProps) {
  const s = alertStyles[variant];
  return (
    <div className={cn('rounded-lg border p-4', s.container, className)}>
      {title && <p className={cn('text-sm font-semibold', s.title)}>{title}</p>}
      <p className={cn('text-sm', s.body, title && 'mt-1')}>{children}</p>
    </div>
  );
}
