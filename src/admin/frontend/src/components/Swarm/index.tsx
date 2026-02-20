import { useState } from 'react';
import SwarmTopologyPanel from './SwarmTopologyPanel';
import ConversationsList from './ConversationsList';
import PerformanceTable from './PerformanceTable';
import ActivityTimeline from './ActivityTimeline';
import { useSwarmEvents } from '../../hooks/useSwarmEvents';
import { useAgentStats } from '../../hooks/useAgentStats';
import { useActiveComponents } from '../../hooks/useActiveComponents';

export default function Swarm() {
  const [activityFilter, setActivityFilter] = useState<string | undefined>();

  // Real-time data via SSE
  const { activities, states, connected } = useSwarmEvents();
  const { stats } = useAgentStats();

  // Calculate active components from activities
  const { activeComponents } = useActiveComponents(activities, states, {
    enableLogging: true,
  });

  const handleNodeClick = (nodeId: string) => {
    setActivityFilter(nodeId);
  };

  return (
    <>
      <SwarmTopologyPanel
        activeComponents={activeComponents}
        onNodeClick={handleNodeClick}
        showConnectionStatus={true}
        connected={connected}
      />

      <div className="swarm-grid">
        <ConversationsList states={states} />
        <PerformanceTable stats={stats} />
      </div>

      <ActivityTimeline initialFilter={activityFilter} />
    </>
  );
}
