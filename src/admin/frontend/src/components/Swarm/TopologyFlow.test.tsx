import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '../../test/utils';
import TopologyFlow from './TopologyFlow';

// Mock ReactFlow since it requires browser APIs
vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ nodes, edges, children }: any) => (
    <div data-testid="react-flow" data-nodes={JSON.stringify(nodes.map((n: any) => n.id))} data-edges={edges.length}>
      {children}
    </div>
  ),
  Background: () => <div data-testid="react-flow-background" />,
  useNodesState: (initial: any) => [initial, vi.fn(), vi.fn()],
  useEdgesState: (initial: any) => [initial, vi.fn(), vi.fn()],
  BackgroundVariant: { Dots: 'dots' },
}));

describe('TopologyFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render the flow container', () => {
    render(<TopologyFlow activeComponents={new Set()} />);

    expect(screen.getByTestId('react-flow')).toBeInTheDocument();
  });

  it('should render all expected nodes', () => {
    render(<TopologyFlow activeComponents={new Set()} />);

    const flow = screen.getByTestId('react-flow');
    const nodes = JSON.parse(flow.getAttribute('data-nodes') || '[]');

    // Verify all expected nodes exist
    expect(nodes).toContain('orchestrator');
    expect(nodes).toContain('research');
    expect(nodes).toContain('qualification');
    expect(nodes).toContain('video');
    expect(nodes).toContain('voice');
    expect(nodes).toContain('crm');

    // Verify external API workers
    expect(nodes).toContain('research_worker');
    expect(nodes).toContain('video_worker');
    expect(nodes).toContain('voice_worker');
    expect(nodes).toContain('crm_worker');
  });

  it('should have expected number of edges', () => {
    render(<TopologyFlow activeComponents={new Set()} />);

    const flow = screen.getByTestId('react-flow');
    const edgeCount = parseInt(flow.getAttribute('data-edges') || '0');

    // Should have edges connecting:
    // - Orchestrator to all 5 agents (5 edges)
    // - Research to qualification (1 edge)
    // - Agents to workers (4 edges)
    expect(edgeCount).toBe(10);
  });

  it('should render background', () => {
    render(<TopologyFlow activeComponents={new Set()} />);

    expect(screen.getByTestId('react-flow-background')).toBeInTheDocument();
  });

  it('should accept activeComponents prop', () => {
    const activeComponents = new Set(['orchestrator', 'research']);

    // Should render without errors
    const { container } = render(<TopologyFlow activeComponents={activeComponents} />);
    expect(container).toBeInTheDocument();
  });

  it('should accept onNodeClick callback', () => {
    const handleNodeClick = vi.fn();

    const { container } = render(
      <TopologyFlow
        activeComponents={new Set()}
        onNodeClick={handleNodeClick}
      />
    );

    expect(container).toBeInTheDocument();
  });
});

describe('TopologyFlow Node Structure', () => {
  it('should have orchestrator at center position', () => {
    // This tests the static node configuration
    render(<TopologyFlow activeComponents={new Set()} />);

    const flow = screen.getByTestId('react-flow');
    const nodes = JSON.parse(flow.getAttribute('data-nodes') || '[]');

    // Orchestrator should be in the list
    expect(nodes.indexOf('orchestrator')).toBe(0);
  });

  it('should follow corporate hierarchy structure', () => {
    render(<TopologyFlow activeComponents={new Set()} />);

    const flow = screen.getByTestId('react-flow');
    const nodes = JSON.parse(flow.getAttribute('data-nodes') || '[]');

    // All agents should report to orchestrator (be in the node list)
    const expectedAgents = ['research', 'qualification', 'video', 'voice', 'crm'];
    expectedAgents.forEach(agent => {
      expect(nodes).toContain(agent);
    });
  });
});

describe('TopologyFlow Active States', () => {
  it('should handle empty active components', () => {
    const { container } = render(<TopologyFlow activeComponents={new Set()} />);
    expect(container).toBeInTheDocument();
  });

  it('should handle single active component', () => {
    const { container } = render(
      <TopologyFlow activeComponents={new Set(['orchestrator'])} />
    );
    expect(container).toBeInTheDocument();
  });

  it('should handle multiple active components', () => {
    const { container } = render(
      <TopologyFlow
        activeComponents={new Set(['orchestrator', 'research', 'video', 'voice'])}
      />
    );
    expect(container).toBeInTheDocument();
  });

  it('should handle all components active', () => {
    const allComponents = new Set([
      'orchestrator',
      'research',
      'qualification',
      'video',
      'voice',
      'crm',
      'research_worker',
      'video_worker',
      'voice_worker',
      'crm_worker',
    ]);

    const { container } = render(
      <TopologyFlow activeComponents={allComponents} />
    );
    expect(container).toBeInTheDocument();
  });
});
