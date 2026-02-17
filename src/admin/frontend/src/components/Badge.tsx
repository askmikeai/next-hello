import clsx from 'clsx';
import type { ReactNode } from 'react';

type BadgeVariant = 'hot' | 'warm' | 'cold' | 'status' | 'success' | 'fail' | 'in' | 'out';

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
}

export default function Badge({ children, variant = 'status' }: BadgeProps) {
  return (
    <span
      className={clsx('badge', {
        'badge-hot': variant === 'hot',
        'badge-warm': variant === 'warm',
        'badge-cold': variant === 'cold',
        'badge-status': variant === 'status',
        'badge-success': variant === 'success',
        'badge-fail': variant === 'fail',
        'badge-in': variant === 'in',
        'badge-out': variant === 'out',
      })}
    >
      {children}
    </span>
  );
}

export function QualificationBadge({ tier }: { tier: string | null }) {
  if (!tier) {
    return <Badge variant="status">-</Badge>;
  }
  const variant = tier as 'hot' | 'warm' | 'cold';
  return <Badge variant={variant}>{tier}</Badge>;
}

export function StatusBadge({ status }: { status: string | null }) {
  return <Badge variant="status">{status || '-'}</Badge>;
}

export function ActivityStatusBadge({ status }: { status: string }) {
  if (status === 'completed') {
    return <Badge variant="success">OK</Badge>;
  }
  if (status === 'failed') {
    return <Badge variant="fail">FAIL</Badge>;
  }
  return <Badge variant="status">...</Badge>;
}

export function DirectionBadge({ direction }: { direction: 'inbound' | 'outbound' }) {
  if (direction === 'inbound') {
    return <Badge variant="in">IN</Badge>;
  }
  return <Badge variant="out">OUT</Badge>;
}
