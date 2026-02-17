import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

interface WorkerData {
  label: string;
  isActive: boolean;
}

function WorkerNode({ data }: NodeProps) {
  const nodeData = data as unknown as WorkerData;

  return (
    <div
      style={{
        width: 30,
        height: 30,
        borderRadius: '50%',
        background: nodeData.isActive ? 'var(--warning)' : 'var(--bg-secondary)',
        border: `2px solid var(--warning)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        transition: 'all 0.3s ease',
      }}
    >
      <span
        style={{
          fontSize: '7px',
          color: nodeData.isActive ? 'var(--bg)' : 'var(--text)',
          textAlign: 'center',
          fontWeight: 500,
        }}
      >
        {nodeData.label}
      </span>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
    </div>
  );
}

export default memo(WorkerNode);
