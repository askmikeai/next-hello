import { useCallback, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeTypes,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

interface TopologyFlowProps {
  activeComponents: Set<string>;
  onNodeClick?: (nodeId: string) => void;
}

// Node component with handles for proper edge connections
function SimpleNode({ data }: { data: { label: string; isActive: boolean; type: string } }) {
  const colors: Record<string, { active: string; border: string }> = {
    orchestrator: { active: '#58a6ff', border: '#58a6ff' },
    agent: { active: '#a371f7', border: '#a371f7' },
    worker: { active: '#d29922', border: '#d29922' },
  };

  const color = colors[data.type] || colors.agent;
  const size = data.type === 'orchestrator' ? 80 : 60;

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: data.type === 'orchestrator' ? '50%' : '12px',
        background: data.isActive ? color.active : 'var(--bg)',
        border: `2px solid ${data.isActive ? color.active : 'var(--border)'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        opacity: data.isActive ? 1 : 0.5,
        boxShadow: data.isActive ? `0 0 20px ${color.active}50` : 'none',
        position: 'relative',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <span
        style={{
          fontSize: data.type === 'orchestrator' ? '11px' : '10px',
          color: data.isActive ? '#fff' : 'var(--text-muted)',
          textAlign: 'center',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        {data.label}
      </span>
    </div>
  );
}

const nodeTypes: NodeTypes = {
  simple: SimpleNode,
};

// Center position for radial layout
const CENTER = { x: 300, y: 180 };
const AGENT_RADIUS = 130;
const WORKER_RADIUS = 200;

// Helper to calculate position on a circle
function radialPosition(angle: number, radius: number) {
  return {
    x: CENTER.x + radius * Math.cos(angle) - 30,
    y: CENTER.y + radius * Math.sin(angle) - 30,
  };
}

// Agents positioned radially around orchestrator
const AGENT_ANGLES = {
  research: -Math.PI / 2,          // Top
  qualification: -Math.PI / 6,     // Top-right (depends on research)
  crm: Math.PI / 6,                // Right
  voice: Math.PI / 2 + Math.PI / 6, // Bottom-right
  video: Math.PI - Math.PI / 6,    // Bottom-left
};

// Node layout - radial organization
const INITIAL_NODES: Node[] = [
  // Center: Orchestrator
  {
    id: 'orchestrator',
    type: 'simple',
    position: { x: CENTER.x - 40, y: CENTER.y - 40 },
    data: { label: 'Orchestrator', isActive: false, type: 'orchestrator' },
  },
  // Agents radiating from orchestrator
  {
    id: 'research',
    type: 'simple',
    position: radialPosition(AGENT_ANGLES.research, AGENT_RADIUS),
    data: { label: 'Research', isActive: false, type: 'agent' },
  },
  {
    id: 'qualification',
    type: 'simple',
    position: radialPosition(AGENT_ANGLES.qualification, AGENT_RADIUS),
    data: { label: 'Qualify', isActive: false, type: 'agent' },
  },
  {
    id: 'crm',
    type: 'simple',
    position: radialPosition(AGENT_ANGLES.crm, AGENT_RADIUS),
    data: { label: 'CRM', isActive: false, type: 'agent' },
  },
  {
    id: 'voice',
    type: 'simple',
    position: radialPosition(AGENT_ANGLES.voice, AGENT_RADIUS),
    data: { label: 'Voice', isActive: false, type: 'agent' },
  },
  {
    id: 'video',
    type: 'simple',
    position: radialPosition(AGENT_ANGLES.video, AGENT_RADIUS),
    data: { label: 'Video', isActive: false, type: 'agent' },
  },
  // External API workers (outer ring)
  {
    id: 'research_worker',
    type: 'simple',
    position: radialPosition(AGENT_ANGLES.research, WORKER_RADIUS),
    data: { label: 'PDL', isActive: false, type: 'worker' },
  },
  {
    id: 'crm_worker',
    type: 'simple',
    position: radialPosition(AGENT_ANGLES.crm, WORKER_RADIUS),
    data: { label: 'HubSpot', isActive: false, type: 'worker' },
  },
  {
    id: 'voice_worker',
    type: 'simple',
    position: radialPosition(AGENT_ANGLES.voice, WORKER_RADIUS),
    data: { label: 'ElevenLabs', isActive: false, type: 'worker' },
  },
  {
    id: 'video_worker',
    type: 'simple',
    position: radialPosition(AGENT_ANGLES.video, WORKER_RADIUS),
    data: { label: 'HeyGen', isActive: false, type: 'worker' },
  },
];

// Base edge style - always visible
const baseEdgeStyle = {
  stroke: 'var(--border)',
  strokeWidth: 1,
  opacity: 0.4,
};

// Edges connecting orchestrator to agents, and agents to workers
const INITIAL_EDGES: Edge[] = [
  // Orchestrator to agents (5 edges)
  { id: 'e-o-research', source: 'orchestrator', target: 'research', style: baseEdgeStyle },
  { id: 'e-o-qualification', source: 'orchestrator', target: 'qualification', style: baseEdgeStyle },
  { id: 'e-o-crm', source: 'orchestrator', target: 'crm', style: baseEdgeStyle },
  { id: 'e-o-voice', source: 'orchestrator', target: 'voice', style: baseEdgeStyle },
  { id: 'e-o-video', source: 'orchestrator', target: 'video', style: baseEdgeStyle },
  // Research to qualification (1 edge - qualification depends on research)
  { id: 'e-research-qualification', source: 'research', target: 'qualification', style: baseEdgeStyle },
  // Agents to external workers (4 edges)
  { id: 'e-research-worker', source: 'research', target: 'research_worker', style: baseEdgeStyle },
  { id: 'e-crm-worker', source: 'crm', target: 'crm_worker', style: baseEdgeStyle },
  { id: 'e-voice-worker', source: 'voice', target: 'voice_worker', style: baseEdgeStyle },
  { id: 'e-video-worker', source: 'video', target: 'video_worker', style: baseEdgeStyle },
];

export default function TopologyFlow({ activeComponents, onNodeClick }: TopologyFlowProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES);

  // Update nodes and edges based on active components
  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        data: {
          ...node.data,
          isActive: activeComponents.has(node.id),
        },
      }))
    );

    // Update edge styles - edge is active only when BOTH source and target are active
    setEdges((eds) =>
      eds.map((edge) => {
        const isActive = activeComponents.has(edge.source) && activeComponents.has(edge.target);
        return {
          ...edge,
          animated: isActive,
          style: {
            stroke: isActive ? 'var(--accent)' : 'var(--border)',
            strokeWidth: isActive ? 2 : 1,
            opacity: isActive ? 1 : 0.4,
            transition: 'all 0.3s ease',
          },
        };
      })
    );
  }, [activeComponents, setNodes, setEdges]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onNodeClick?.(node.id);
    },
    [onNodeClick]
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={handleNodeClick}
      nodeTypes={nodeTypes}
      fitView
      proOptions={{ hideAttribution: true }}
      minZoom={0.5}
      maxZoom={2}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnDrag={false}
      zoomOnScroll={false}
      zoomOnPinch={false}
      zoomOnDoubleClick={false}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--border)" />
    </ReactFlow>
  );
}
