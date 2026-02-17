import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PerformanceTable from './PerformanceTable';
import { mockAgentStats } from '../../test/mocks';

describe('PerformanceTable', () => {
  it('should render headers', () => {
    render(<PerformanceTable stats={mockAgentStats} />);

    expect(screen.getByText('Component')).toBeInTheDocument();
    expect(screen.getByText('Calls')).toBeInTheDocument();
    expect(screen.getByText('Success')).toBeInTheDocument();
    expect(screen.getByText('Avg Time')).toBeInTheDocument();
  });

  it('should render stats data', () => {
    render(<PerformanceTable stats={mockAgentStats} />);

    expect(screen.getByText('Orchestrator')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('98%')).toBeInTheDocument();
    expect(screen.getByText('250ms')).toBeInTheDocument();
  });

  it('should apply health-ok class for high success rate', () => {
    render(<PerformanceTable stats={mockAgentStats} />);

    // 98% and 100% should have health-ok
    const successCells = screen.getAllByText(/100%|98%/);
    successCells.forEach((cell) => {
      expect(cell).toHaveClass('health-ok');
    });
  });

  it('should show empty state when no stats', () => {
    render(<PerformanceTable stats={[]} />);

    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('should map agent types to component names', () => {
    const stats = [
      { agentType: 'conversation', executions: 10, avgDurationMs: 100, successRate: 95 },
      { agentType: 'video', executions: 5, avgDurationMs: 500, successRate: 90 },
      { agentType: 'research', executions: 3, avgDurationMs: 200, successRate: 100 },
    ];

    render(<PerformanceTable stats={stats} />);

    expect(screen.getByText('Orchestrator')).toBeInTheDocument();
    expect(screen.getByText('Video Worker')).toBeInTheDocument();
    expect(screen.getByText('Research Worker')).toBeInTheDocument();
  });
});
