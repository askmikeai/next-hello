import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAgentStats } from './useAgentStats';
import { mockAgentStats } from '../test/mocks';

vi.mock('../api/client', () => ({
  getAgentStats: vi.fn(),
}));

import { getAgentStats } from '../api/client';

describe('useAgentStats', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should fetch agent stats on mount', async () => {
    vi.mocked(getAgentStats).mockResolvedValue(mockAgentStats);

    const { result } = renderHook(() => useAgentStats());

    expect(result.current.loading).toBe(true);
    expect(result.current.stats).toEqual([]);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.stats).toEqual(mockAgentStats);
  });

  it('should handle fetch error', async () => {
    const error = new Error('Network error');
    vi.mocked(getAgentStats).mockRejectedValue(error);

    const { result } = renderHook(() => useAgentStats());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.stats).toEqual([]);
    expect(result.current.error).toEqual(error);
  });
});
