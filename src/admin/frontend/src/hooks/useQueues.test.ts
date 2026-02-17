import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useQueues } from './useQueues';
import { mockQueues } from '../test/mocks';

vi.mock('../api/client', () => ({
  getQueues: vi.fn(),
}));

import { getQueues } from '../api/client';

describe('useQueues', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should fetch queues on mount', async () => {
    vi.mocked(getQueues).mockResolvedValue(mockQueues);

    const { result } = renderHook(() => useQueues());

    expect(result.current.loading).toBe(true);
    expect(result.current.queues).toEqual([]);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.queues).toEqual(mockQueues);
  });

  it('should calculate total jobs correctly', async () => {
    vi.mocked(getQueues).mockResolvedValue(mockQueues);

    const { result } = renderHook(() => useQueues());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Total: (5+2) + (3+1) + (1+0) = 12
    expect(result.current.totalJobs).toBe(12);
  });

  it('should handle fetch error', async () => {
    const error = new Error('Network error');
    vi.mocked(getQueues).mockRejectedValue(error);

    const { result } = renderHook(() => useQueues());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.queues).toEqual([]);
    expect(result.current.error).toEqual(error);
  });
});
