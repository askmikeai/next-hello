import { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  useNodesState,
  useEdgesState,
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

// Simple node component that changes appearance based on active state
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
        background: data.isActive ? color.active : 'transparent',
        border: `2px solid ${data.isActive ? color.active : 'var(--border)'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        opacity: data.isActive ? 1 : 0.4,
        boxShadow: data.isActive ? `0 0 20px ${color.active}50` : 'none',
      }}
    >
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

// Node layout - all agents radiate from orchestrator
const INITIAL_NODES: Node[] = [
  // Center: Orchestrator
  {
    id: 'orchestrator',
    type: 'simple',
    position: { x: 300, y: 200 },
    data: { label: 'Orchestrator', isActive: false, type: 'orchestrator' },
  },
  // Agents radiating from orchestrator
  {
    id: 'research',
    type: 'simple',
    position: { x: 300, y: 50 },
    data: { label: 'Research', isActive: false, type: 'agent' },
  },
  {
    id: 'qualification',
    type: 'simple',
    position: { x: 500, y: 120 },
    data: { label: 'Qualify', isActive: false, type: 'agent' },
  },
  {
    id: 'video',
    type: 'simple',
    position: { x: 500, y: 280 },
    data: { label: 'Video', isActive: false, type: 'agent' },
  },
  {
    id: 'voice',
    type: 'simple',
    position: { x: 300, y: 350 },
    data: { label: 'Voice', isActive: false, type: 'agent' },
  },
  {
    id: 'crm',
    type: 'simple',
    position: { x: 100, y: 200 },
    data: { label: 'CRM', isActive: false, type: 'agent' },
  },
  // External API workers
  {
    id: 'research_worker',
    type: 'simple',
    position: { x: 170, y: 50 },
    data: { label: 'PDL', isActive: false, type: 'worker' },
  },
  {
    id: 'video_worker',
    type: 'simple',
    position: { x: 620, y: 280 },
    data: { label: 'HeyGen', isActive: false, type: 'worker' },
  },
  {
    id: 'voice_worker',
    type: 'simple',
    position: { x: 430, y: 350 },
    data: { label: 'ElevenLabs', isActive: false, type: 'worker' },
  },
  {
    id: 'crm_worker',
    type: 'simple',
    position: { x: 0, y: 200 },
    data: { label: 'HubSpot', isActive: false, type: 'worker' },
  },
];

// Edges - only visible when active
const INITIAL_EDGES: Edge[] = [
  // Orchestrator to agents
  { id: 'e-o-research', source: 'orchestrator', target: 'research' },
  { id: 'e-o-qualify', source: 'orchestrator', target: 'qualification' },
  { id: 'e-o-video', source: 'orchestrator', target: 'video' },
  { id: 'e-o-voice', source: 'orchestrator', target: 'voice' },
  { id: 'e-o-crm', source: 'orchestrator', target: 'crm' },
  // Research to qualification dependency
  { id: 'e-research-qualify', source: 'research', target: 'qualification' },
  // Agents to workers
  { id: 'e-research-worker', source: 'research', target: 'research_worker' },
  { id: 'e-video-worker', source: 'video', target: 'video_worker' },
  { id: 'e-voice-worker', source: 'voice', target: 'voice_worker' },
  { id: 'e-crm-worker', source: 'crm', target: 'crm_worker' },
];

export default function TopologyFlow({ activeComponents, onNodeClick }: TopologyFlowProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES);

  // Update nodes and edges based on active components
  useMemo(() => {
    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        data: {
          ...node.data,
          isActive: activeComponents.has(node.id),
        },
      }))
    );

    // Only show edges when source or target is active
    setEdges((eds) =>
      eds.map((edge) => {
        const isActive = activeComponents.has(edge.source) || activeComponents.has(edge.target);
        return {
          ...edge,
          animated: isActive,
          style: {
            stroke: isActive ? 'var(--accent)' : 'transparent',
            strokeWidth: isActive ? 2 : 1,
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
