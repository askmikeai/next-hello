import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

interface AgentData {
  label: string;
  isActive: boolean;
}

function AgentNode({ data }: NodeProps) {
  const nodeData = data as unknown as AgentData;

  return (
    <div
      style={{
        width: 50,
        height: 50,
        borderRadius: '8px',
        background: nodeData.isActive
          ? 'linear-gradient(135deg, var(--info), var(--accent))'
          : 'var(--bg-secondary)',
        border: `2px solid var(--info)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        boxShadow: nodeData.isActive
          ? '0 0 12px var(--info)'
          : 'none',
        transform: 'rotate(45deg)',
      }}
    >
      <span
        style={{
          fontSize: '9px',
          color: nodeData.isActive ? 'white' : 'var(--text)',
          textAlign: 'center',
          fontWeight: 600,
          transform: 'rotate(-45deg)',
        }}
      >
        {nodeData.label}
      </span>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Right} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Top} id="top" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} id="right" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Left} id="left" style={{ opacity: 0 }} />
    </div>
  );
}

export default memo(AgentNode);
