interface TopologyLegendProps {
  connected?: boolean;
  showConnectionStatus?: boolean;
}

export default function TopologyLegend({
  connected,
  showConnectionStatus = false,
}: TopologyLegendProps) {
  return (
    <div className="legend">
      <div className="legend-item">
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: 'var(--accent)',
            display: 'inline-block',
            boxShadow: '0 0 8px var(--accent)',
          }}
        ></span>{' '}
        Orchestrator
      </div>
      <div className="legend-item">
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: 3,
            background: 'var(--info)',
            display: 'inline-block',
          }}
        ></span>{' '}
        Agent
      </div>
      <div className="legend-item">
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: 3,
            background: 'var(--warning)',
            display: 'inline-block',
          }}
        ></span>{' '}
        External API
      </div>

      {showConnectionStatus && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            marginLeft: '1rem',
            fontSize: '0.75rem',
            color: connected ? 'var(--success)' : 'var(--text-muted)',
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: connected ? 'var(--success)' : 'var(--text-muted)',
              animation: connected ? 'pulse 2s infinite' : 'none',
            }}
          ></span>
          {connected ? 'Live' : 'Connecting...'}
        </span>
      )}
    </div>
  );
}
