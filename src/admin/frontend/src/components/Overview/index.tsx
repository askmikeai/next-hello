import { useMemo } from 'react';
import StatsGrid from './StatsGrid';
import ContactsTable from './ContactsTable';
import MessagesTable from './MessagesTable';
import QueuesTable from './QueuesTable';
import ActivityTable from './ActivityTable';
import StatusBreakdown from './StatusBreakdown';
import SwarmTopologyPanel from '../Swarm/SwarmTopologyPanel';
import { useActivities } from '../../hooks/useActivities';

export default function Overview() {
  const { activities } = useActivities();

  // Compute active components from recent activities (within last 30 seconds)
  const activeComponents = useMemo(() => {
    const now = Date.now();
    const thirtySecondsAgo = now - 30000;
    const active = new Set<string>();

    activities.forEach((activity) => {
      const activityTime = new Date(activity.startedAt).getTime();
      if (activityTime > thirtySecondsAgo && activity.status !== 'completed') {
        active.add(activity.agentType);
      }
    });

    return active;
  }, [activities]);

  return (
    <>
      <SwarmTopologyPanel
        activeComponents={activeComponents}
        showHeader={true}
        headerTitle="Swarm Topology"
      />

      <StatsGrid />

      <div className="grid-2">
        <StatusBreakdown />
        <QueuesTable />
      </div>

      <div className="panel" style={{ marginBottom: '1.5rem' }}>
        <ContactsTable />
      </div>

      <div className="panel" style={{ marginBottom: '1.5rem' }}>
        <MessagesTable />
      </div>

      <div className="panel">
        <ActivityTable />
      </div>
    </>
  );
}
