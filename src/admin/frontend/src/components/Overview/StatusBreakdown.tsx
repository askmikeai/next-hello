import { useStats } from '../../hooks/useStats';

export default function StatusBreakdown() {
  const { stats } = useStats();

  const entries = stats?.byStatus
    ? Object.entries(stats.byStatus).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div className="panel">
      <div className="panel-header">Status Breakdown</div>
      <ul className="breakdown-list">
        {entries.length === 0 ? (
          <li className="text-muted">No data</li>
        ) : (
          entries.map(([status, count]) => (
            <li key={status}>
              <span>{status}</span>
              <span>{count}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
