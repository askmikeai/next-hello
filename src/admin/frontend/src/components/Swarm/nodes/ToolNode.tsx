import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

interface ToolData {
  label: string;
  isActive: boolean;
}

function ToolNode({ data }: NodeProps) {
  const nodeData = data as unknown as ToolData;

  return (
    <div
      style={{
        width: 36,
        height: 36,
        borderRadius: '50%',
        background: nodeData.isActive ? 'var(--success)' : 'var(--bg-secondary)',
        border: `2px solid var(--success)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        transition: 'all 0.3s ease',
      }}
    >
      <span
        style={{
          fontSize: '8px',
          color: nodeData.isActive ? 'var(--bg)' : 'var(--text)',
          textAlign: 'center',
          fontWeight: 500,
        }}
      >
        {nodeData.label}
      </span>
      <Handle type="target" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Left} style={{ opacity: 0 }} />
    </div>
  );
}

export default memo(ToolNode);
