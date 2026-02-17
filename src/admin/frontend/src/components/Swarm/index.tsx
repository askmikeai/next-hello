import { useState, useMemo } from 'react';
import TopologyFlow from './TopologyFlow';
import ConversationsList from './ConversationsList';
import PerformanceTable from './PerformanceTable';
import ActivityTimeline from './ActivityTimeline';
import { useDemoMode } from './DemoMode';
import { useSwarmStates } from '../../hooks/useSwarmStates';
import { useAgentStats } from '../../hooks/useAgentStats';
import { useActivities } from '../../hooks/useActivities';

export default function Swarm() {
  const [activityFilter, setActivityFilter] = useState<string | undefined>();
  const demoMode = useDemoMode();

  // Real data hooks
  const { states: realStates } = useSwarmStates();
  const { stats: realStats } = useAgentStats();
  const { activities: realActivities } = useActivities(20, undefined, 2000);

  // Determine which data to use (demo or real)
  const states = demoMode.isActive ? demoMode.conversations : realStates;
  const stats = demoMode.isActive ? demoMode.stats : realStats;

  // Calculate active components from activities
  const activeComponents = useMemo(() => {
    if (demoMode.isActive) {
      return demoMode.activeComponents;
    }

    const active = new Set<string>();
    const recentCutoff = Date.now() - 10000; // Last 10 seconds

    realActivities.forEach((a) => {
      const activityTime = new Date(a.startedAt).getTime();
      if (activityTime > recentCutoff) {
        active.add(a.agentType);
      }
    });

    if (realStates.length > 0) {
      active.add('orchestrator');
    }

    return active;
  }, [demoMode.isActive, demoMode.activeComponents, realActivities, realStates.length]);

  const handleNodeClick = (nodeId: string) => {
    setActivityFilter(nodeId);
  };

  return (
    <>
      <div className="topology-container">
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1 }}>
            <TopologyFlow activeComponents={activeComponents} onNodeClick={handleNodeClick} />
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
            <button
              className={`demo-btn ${demoMode.isActive ? 'active' : ''}`}
              onClick={demoMode.toggleDemo}
              style={{ marginLeft: '1rem' }}
            >
              {demoMode.isActive ? '⏹ Stop Demo' : '▶ Demo Mode'}
            </button>
          </div>
        </div>
      </div>

      <div className="swarm-grid">
        <ConversationsList states={states} />
        <PerformanceTable stats={stats} />
      </div>

      <ActivityTimeline initialFilter={activityFilter} />
    </>
  );
}
