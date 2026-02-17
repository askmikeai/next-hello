import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

interface OrchestratorData {
  label: string;
  isActive: boolean;
}

function OrchestratorNode({ data }: NodeProps) {
  const nodeData = data as unknown as OrchestratorData;

  return (
    <div
      style={{
        width: 70,
        height: 70,
        borderRadius: '50%',
        background: nodeData.isActive ? 'var(--accent)' : 'var(--bg-secondary)',
        border: `3px solid var(--accent)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        transition: 'all 0.3s ease',
      }}
    >
      <span
        style={{
          fontSize: '10px',
          color: nodeData.isActive ? 'var(--bg)' : 'var(--text)',
          textAlign: 'center',
          fontWeight: 500,
        }}
      >
        {nodeData.label}
      </span>
      <Handle type="source" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Top} id="top" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Right} id="right" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Bottom} id="bottom" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} id="left" style={{ opacity: 0 }} />
    </div>
  );
}

export default memo(OrchestratorNode);
