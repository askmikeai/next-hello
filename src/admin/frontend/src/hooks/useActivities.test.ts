import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useActivities } from './useActivities';
import { mockActivities } from '../test/mocks';

vi.mock('../api/client', () => ({
  getActivities: vi.fn(),
}));

import { getActivities } from '../api/client';

describe('useActivities', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should fetch activities on mount', async () => {
    vi.mocked(getActivities).mockResolvedValue(mockActivities);

    const { result } = renderHook(() => useActivities());

    expect(result.current.loading).toBe(true);
    expect(result.current.activities).toEqual([]);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.activities).toEqual(mockActivities);
  });

  it('should pass limit and agentType to getActivities', async () => {
    vi.mocked(getActivities).mockResolvedValue(mockActivities);

    renderHook(() => useActivities(30, 'orchestrator'));

    await waitFor(() => {
      expect(getActivities).toHaveBeenCalledWith(30, 'orchestrator');
    });
  });

  it('should handle fetch error', async () => {
    const error = new Error('Network error');
    vi.mocked(getActivities).mockRejectedValue(error);

    const { result } = renderHook(() => useActivities());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.activities).toEqual([]);
    expect(result.current.error).toEqual(error);
  });
});
