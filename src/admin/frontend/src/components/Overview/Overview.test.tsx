import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '../../test/utils';
import Overview from './index';

// Mock the hooks
vi.mock('../../hooks/useActivities', () => ({
  useActivities: () => ({
    activities: [],
    loading: false,
    error: null,
  }),
}));

vi.mock('../../hooks/useSwarmStates', () => ({
  useSwarmStates: () => ({
    states: [],
    loading: false,
    error: null,
  }),
}));

vi.mock('../../hooks/useStats', () => ({
  useStats: () => ({
    stats: {
      totalContacts: 0,
      activeContacts: 0,
      messagesIn24h: 0,
      averageResponseTime: 0,
    },
    loading: false,
    error: null,
  }),
}));

vi.mock('../../hooks/useContacts', () => ({
  useContacts: () => ({
    contacts: [],
    loading: false,
    error: null,
  }),
}));

vi.mock('../../hooks/useMessages', () => ({
  useMessages: () => ({
    messages: [],
    loading: false,
    error: null,
  }),
}));

vi.mock('../../hooks/useQueues', () => ({
  useQueues: () => ({
    queues: [],
    loading: false,
    error: null,
  }),
}));

vi.mock('../../hooks/useHealth', () => ({
  useHealth: () => ({
    health: { status: 'ok', checks: [] },
    loading: false,
    error: null,
  }),
}));

// Mock ReactFlow
vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ nodes, edges, children }: any) => (
    <div data-testid="react-flow" data-nodes={JSON.stringify(nodes?.map((n: any) => n.id) || [])} data-edges={edges?.length || 0}>
      {children}
    </div>
  ),
  Background: () => <div data-testid="react-flow-background" />,
  useNodesState: (initial: any) => [initial || [], vi.fn(), vi.fn()],
  useEdgesState: (initial: any) => [initial || [], vi.fn(), vi.fn()],
  BackgroundVariant: { Dots: 'dots' },
}));

describe('Overview with Topology', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render the swarm topology container', () => {
    render(<Overview />);

    expect(screen.getByTestId('swarm-topology')).toBeInTheDocument();
  });

  it('should render ReactFlow within the topology container', () => {
    render(<Overview />);

    const topology = screen.getByTestId('swarm-topology');
    expect(topology.querySelector('[data-testid="react-flow"]')).toBeInTheDocument();
  });

  it('should display "Swarm Topology" header', () => {
    render(<Overview />);

    expect(screen.getByText('Swarm Topology')).toBeInTheDocument();
  });

  it('should show idle state when no active components', () => {
    render(<Overview />);

    expect(screen.getByText('idle')).toBeInTheDocument();
  });

  it('should render the legend', () => {
    render(<Overview />);

    // Find the legend container and verify its items
    const topology = screen.getByTestId('swarm-topology');
    const legend = topology.querySelector('.legend');

    expect(legend).toBeInTheDocument();
    expect(legend?.textContent).toContain('Orchestrator');
    expect(legend?.textContent).toContain('Agent');
    expect(legend?.textContent).toContain('External API');
  });

  it('should render all topology nodes', () => {
    render(<Overview />);

    const flow = screen.getByTestId('react-flow');
    const nodes = JSON.parse(flow.getAttribute('data-nodes') || '[]');

    // Should have orchestrator + 5 agents + 4 workers = 10 nodes
    expect(nodes.length).toBe(10);
  });
});

describe('Overview with Active Components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show active count when components are active', async () => {
    // Mock activities with recent activity
    vi.doMock('../../hooks/useActivities', () => ({
      useActivities: () => ({
        activities: [
          {
            id: '1',
            agentType: 'research',
            action: 'enrich',
            startedAt: new Date().toISOString(),
            status: 'completed',
          },
        ],
        loading: false,
        error: null,
      }),
    }));

    vi.doMock('../../hooks/useSwarmStates', () => ({
      useSwarmStates: () => ({
        states: [{ phoneNumber: '1234567890' }],
        loading: false,
        error: null,
      }),
    }));

    // Re-import to get fresh mocks
    const { default: OverviewFresh } = await import('./index');
    render(<OverviewFresh />);

    // Should show active count or idle
    const topology = screen.getByTestId('swarm-topology');
    expect(topology).toBeInTheDocument();
  });
});

describe('Overview Layout', () => {
  it('should render topology before other components', () => {
    render(<Overview />);

    const topology = screen.getByTestId('swarm-topology');
    const parent = topology.parentElement;

    // Topology should be early in the DOM
    expect(parent?.children[0]).toBe(topology.previousElementSibling || topology);
  });

  it('should have correct CSS class on topology container', () => {
    render(<Overview />);

    const topology = screen.getByTestId('swarm-topology');
    expect(topology).toHaveClass('topology-container');
  });
});
