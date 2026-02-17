import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSwarmStates } from './useSwarmStates';
import { mockSwarmStates } from '../test/mocks';

vi.mock('../api/client', () => ({
  getSwarmStates: vi.fn(),
}));

import { getSwarmStates } from '../api/client';

describe('useSwarmStates', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should fetch swarm states on mount', async () => {
    vi.mocked(getSwarmStates).mockResolvedValue(mockSwarmStates);

    const { result } = renderHook(() => useSwarmStates());

    expect(result.current.loading).toBe(true);
    expect(result.current.states).toEqual([]);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.states).toEqual(mockSwarmStates);
  });

  it('should handle fetch error', async () => {
    const error = new Error('Network error');
    vi.mocked(getSwarmStates).mockRejectedValue(error);

    const { result } = renderHook(() => useSwarmStates());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.states).toEqual([]);
    expect(result.current.error).toEqual(error);
  });
});
