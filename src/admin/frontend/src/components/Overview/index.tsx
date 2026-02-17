import { useMemo } from 'react';
import StatsGrid from './StatsGrid';
import ContactsTable from './ContactsTable';
import MessagesTable from './MessagesTable';
import QueuesTable from './QueuesTable';
import ActivityTable from './ActivityTable';
import StatusBreakdown from './StatusBreakdown';
import TopologyFlow from '../Swarm/TopologyFlow';
import { useActivities } from '../../hooks/useActivities';
import { useSwarmStates } from '../../hooks/useSwarmStates';

export default function Overview() {
  // Get real-time activity data for topology visualization
  const { activities } = useActivities(20, undefined, 2000);
  const { states } = useSwarmStates();

  // Calculate active components from recent activities
  const activeComponents = useMemo(() => {
    const active = new Set<string>();
    const recentCutoff = Date.now() - 10000; // Last 10 seconds

    activities.forEach((a) => {
      const activityTime = new Date(a.startedAt).getTime();
      if (activityTime > recentCutoff) {
        active.add(a.agentType);
      }
    });

    // Show orchestrator as active if there are any active conversations
    if (states.length > 0) {
      active.add('orchestrator');
    }

    return active;
  }, [activities, states.length]);

  return (
    <>
      <StatsGrid />

      {/* Swarm Topology - Live visualization */}
      <div className="topology-container" data-testid="swarm-topology">
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div className="panel-header">
            <span>Swarm Topology</span>
            <span className="text-muted text-sm">
              {activeComponents.size > 0 ? `${activeComponents.size} active` : 'idle'}
            </span>
          </div>
          <div style={{ flex: 1 }}>
            <TopologyFlow activeComponents={activeComponents} />
          </div>
          <div className="legend">
            <div className="legend-item">
              <span style={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: 'var(--accent)',
                display: 'inline-block',
                boxShadow: '0 0 8px var(--accent)'
              }}></span> Orchestrator
            </div>
            <div className="legend-item">
              <span style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                background: 'var(--info)',
                display: 'inline-block',
              }}></span> Agent
            </div>
            <div className="legend-item">
              <span style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                background: 'var(--warning)',
                display: 'inline-block',
              }}></span> External API
            </div>
          </div>
        </div>
      </div>

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
