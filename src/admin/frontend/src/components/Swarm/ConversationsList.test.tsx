import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ConversationsList from './ConversationsList';
import { mockSwarmStates } from '../../test/mocks';

describe('ConversationsList', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-02T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should render empty state when no conversations', () => {
    render(<ConversationsList states={[]} />);

    expect(screen.getByText('No active conversations')).toBeInTheDocument();
  });

  it('should render conversation list', () => {
    render(<ConversationsList states={mockSwarmStates} />);

    expect(screen.getByText('+1555123456')).toBeInTheDocument();
    expect(screen.getByText('+1555234567')).toBeInTheDocument();
  });

  it('should display conversation turns', () => {
    render(<ConversationsList states={mockSwarmStates} />);

    expect(screen.getByText(/5 turns/)).toBeInTheDocument();
    expect(screen.getByText(/3 turns/)).toBeInTheDocument();
  });

  it('should display pending tasks indicator', () => {
    render(<ConversationsList states={mockSwarmStates} />);

    expect(screen.getByText('(2 pending)')).toBeInTheDocument();
  });

  it('should limit display to 10 conversations', () => {
    const manyStates = Array.from({ length: 15 }, (_, i) => ({
      ...mockSwarmStates[0],
      correlationId: `corr-${i}`,
      phoneNumber: `+155500000${i.toString().padStart(2, '0')}`,
    }));

    render(<ConversationsList states={manyStates} />);

    // Should only show 10 items
    const phoneNumbers = screen.getAllByText(/\+1555000/);
    expect(phoneNumbers.length).toBe(10);
  });

  it('should render orchestrator badge', () => {
    render(<ConversationsList states={mockSwarmStates} />);

    const badges = screen.getAllByText('orchestrator');
    expect(badges.length).toBeGreaterThan(0);
  });
});
