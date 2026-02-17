import clsx from 'clsx';

interface StatsCardProps {
  value: string | number;
  label: string;
  variant?: 'default' | 'success' | 'danger';
}

export default function StatsCard({ value, label, variant = 'default' }: StatsCardProps) {
  return (
    <div className="stat-card">
      <div
        className={clsx('stat-value', {
          'health-ok': variant === 'success',
          'health-fail': variant === 'danger',
        })}
      >
        {value}
      </div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
