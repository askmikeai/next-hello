import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useContacts } from './useContacts';
import { mockContacts } from '../test/mocks';

vi.mock('../api/client', () => ({
  getContacts: vi.fn(),
}));

import { getContacts } from '../api/client';

describe('useContacts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should fetch contacts on mount', async () => {
    vi.mocked(getContacts).mockResolvedValue(mockContacts);

    const { result } = renderHook(() => useContacts());

    expect(result.current.loading).toBe(true);
    expect(result.current.contacts).toEqual([]);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.contacts).toEqual(mockContacts);
  });

  it('should pass limit to getContacts', async () => {
    vi.mocked(getContacts).mockResolvedValue(mockContacts);

    renderHook(() => useContacts(25));

    await waitFor(() => {
      expect(getContacts).toHaveBeenCalledWith(25);
    });
  });

  it('should handle fetch error', async () => {
    const error = new Error('Network error');
    vi.mocked(getContacts).mockRejectedValue(error);

    const { result } = renderHook(() => useContacts());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.contacts).toEqual([]);
    expect(result.current.error).toEqual(error);
  });
});
