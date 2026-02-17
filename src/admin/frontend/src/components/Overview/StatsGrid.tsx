import StatsCard from '../StatsCard';
import { useStats } from '../../hooks/useStats';
import { useQueues } from '../../hooks/useQueues';
import { useHealth } from '../../hooks/useHealth';

export default function StatsGrid() {
  const { stats } = useStats();
  const { totalJobs } = useQueues();
  const { isHealthy, error } = useHealth();

  const healthStatus = error ? 'ERR' : isHealthy ? 'OK' : 'FAIL';
  const healthVariant = error ? 'danger' : isHealthy ? 'success' : 'danger';

  return (
    <div className="stats-grid">
      <StatsCard value={stats?.total ?? '-'} label="Contacts" />
      <StatsCard value={stats?.byQualification?.hot ?? '-'} label="Hot Leads" />
      <StatsCard value={totalJobs} label="Queue Jobs" />
      <StatsCard value={healthStatus} label="Health" variant={healthVariant} />
    </div>
  );
}
