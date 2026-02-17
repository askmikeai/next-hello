import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useHealth } from './useHealth';
import { mockHealth, mockUnhealthyStatus } from '../test/mocks';

vi.mock('../api/client', () => ({
  getHealth: vi.fn(),
}));

import { getHealth } from '../api/client';

describe('useHealth', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should fetch health status on mount', async () => {
    vi.mocked(getHealth).mockResolvedValue(mockHealth);

    const { result } = renderHook(() => useHealth());

    expect(result.current.loading).toBe(true);
    expect(result.current.health).toBe(null);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.health).toEqual(mockHealth);
  });

  it('should return isHealthy true when all services healthy', async () => {
    vi.mocked(getHealth).mockResolvedValue(mockHealth);

    const { result } = renderHook(() => useHealth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isHealthy).toBe(true);
  });

  it('should return isHealthy false when services unhealthy', async () => {
    vi.mocked(getHealth).mockResolvedValue(mockUnhealthyStatus);

    const { result } = renderHook(() => useHealth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isHealthy).toBe(false);
  });

  it('should return isHealthy false on error', async () => {
    vi.mocked(getHealth).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useHealth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isHealthy).toBe(false);
  });
});
