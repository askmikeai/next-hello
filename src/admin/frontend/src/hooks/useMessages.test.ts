import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useMessages } from './useMessages';
import { mockMessages } from '../test/mocks';

vi.mock('../api/client', () => ({
  getMessages: vi.fn(),
}));

import { getMessages } from '../api/client';

describe('useMessages', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should fetch messages on mount', async () => {
    vi.mocked(getMessages).mockResolvedValue(mockMessages);

    const { result } = renderHook(() => useMessages());

    expect(result.current.loading).toBe(true);
    expect(result.current.messages).toEqual([]);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.messages).toEqual(mockMessages);
  });

  it('should pass limit and phone to getMessages', async () => {
    vi.mocked(getMessages).mockResolvedValue(mockMessages);

    renderHook(() => useMessages(100, '+1555123456'));

    await waitFor(() => {
      expect(getMessages).toHaveBeenCalledWith(100, '+1555123456');
    });
  });

  it('should handle fetch error', async () => {
    const error = new Error('Network error');
    vi.mocked(getMessages).mockRejectedValue(error);

    const { result } = renderHook(() => useMessages());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.error).toEqual(error);
  });
});
