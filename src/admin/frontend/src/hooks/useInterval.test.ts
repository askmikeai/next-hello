import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useInterval } from './useInterval';

describe('useInterval', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should call callback at specified interval', () => {
    const callback = vi.fn();

    renderHook(() => useInterval(callback, 1000));

    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it('should not call callback when delay is null', () => {
    const callback = vi.fn();

    renderHook(() => useInterval(callback, null));

    vi.advanceTimersByTime(5000);
    expect(callback).not.toHaveBeenCalled();
  });

  it('should clear interval on unmount', () => {
    const callback = vi.fn();

    const { unmount } = renderHook(() => useInterval(callback, 1000));

    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(1);

    unmount();

    vi.advanceTimersByTime(5000);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should update callback reference without resetting interval', () => {
    let count = 0;
    const callback1 = vi.fn(() => {
      count += 1;
    });
    const callback2 = vi.fn(() => {
      count += 10;
    });

    const { rerender } = renderHook(
      ({ callback }) => useInterval(callback, 1000),
      { initialProps: { callback: callback1 } }
    );

    vi.advanceTimersByTime(1000);
    expect(count).toBe(1);

    rerender({ callback: callback2 });

    vi.advanceTimersByTime(1000);
    expect(count).toBe(11);
  });
});
