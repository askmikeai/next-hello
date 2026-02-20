import TopologyFlow from './TopologyFlow';
import TopologyLegend from './TopologyLegend';

interface SwarmTopologyPanelProps {
  activeComponents: Set<string>;
  onNodeClick?: (nodeId: string) => void;
  showConnectionStatus?: boolean;
  connected?: boolean;
  showHeader?: boolean;
  headerTitle?: string;
}

export default function SwarmTopologyPanel({
  activeComponents,
  onNodeClick,
  showConnectionStatus = false,
  connected,
  showHeader = false,
  headerTitle = 'Swarm Topology',
}: SwarmTopologyPanelProps) {
  return (
    <div className="topology-container" data-testid="swarm-topology">
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {showHeader && (
          <div className="panel-header">
            <span>{headerTitle}</span>
            <span className="text-muted text-sm">
              {activeComponents.size > 0 ? `${activeComponents.size} active` : 'idle'}
            </span>
          </div>
        )}
        <div style={{ flex: 1 }}>
          <TopologyFlow activeComponents={activeComponents} onNodeClick={onNodeClick} />
        </div>
        <TopologyLegend connected={connected} showConnectionStatus={showConnectionStatus} />
      </div>
    </div>
  );
}
