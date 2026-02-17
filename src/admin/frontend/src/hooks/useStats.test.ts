import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useStats } from './useStats';
import { mockStats } from '../test/mocks';

vi.mock('../api/client', () => ({
  getStats: vi.fn(),
}));

import { getStats } from '../api/client';

describe('useStats', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should fetch stats on mount', async () => {
    vi.mocked(getStats).mockResolvedValue(mockStats);

    const { result } = renderHook(() => useStats());

    expect(result.current.loading).toBe(true);
    expect(result.current.stats).toBe(null);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.stats).toEqual(mockStats);
    expect(result.current.error).toBe(null);
  });

  it('should handle fetch error', async () => {
    const error = new Error('Network error');
    vi.mocked(getStats).mockRejectedValue(error);

    const { result } = renderHook(() => useStats());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.stats).toBe(null);
    expect(result.current.error).toEqual(error);
  });

  it('should provide refetch function', async () => {
    vi.mocked(getStats).mockResolvedValue(mockStats);

    const { result } = renderHook(() => useStats());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(getStats).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });

    expect(getStats).toHaveBeenCalledTimes(2);
  });
});
