import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDemoMode } from './DemoMode';

describe('useDemoMode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start inactive', () => {
    const { result } = renderHook(() => useDemoMode());

    expect(result.current.isActive).toBe(false);
    expect(result.current.conversations).toEqual([]);
    expect(result.current.activities).toEqual([]);
  });

  it('should activate demo mode when startDemo called', () => {
    const { result } = renderHook(() => useDemoMode());

    act(() => {
      result.current.startDemo();
    });

    expect(result.current.isActive).toBe(true);
    expect(result.current.conversations.length).toBeGreaterThan(0);
  });

  it('should generate activities while active', () => {
    const { result } = renderHook(() => useDemoMode());

    act(() => {
      result.current.startDemo();
    });

    expect(result.current.activities).toEqual([]);

    act(() => {
      vi.advanceTimersByTime(800);
    });

    expect(result.current.activities.length).toBeGreaterThan(0);
  });

  it('should stop demo mode when stopDemo called', () => {
    const { result } = renderHook(() => useDemoMode());

    act(() => {
      result.current.startDemo();
    });

    act(() => {
      vi.advanceTimersByTime(800);
    });

    expect(result.current.activities.length).toBeGreaterThan(0);

    act(() => {
      result.current.stopDemo();
    });

    expect(result.current.isActive).toBe(false);
    expect(result.current.conversations).toEqual([]);
    expect(result.current.activities).toEqual([]);
  });

  it('should toggle demo mode', () => {
    const { result } = renderHook(() => useDemoMode());

    act(() => {
      result.current.toggleDemo();
    });

    expect(result.current.isActive).toBe(true);

    act(() => {
      result.current.toggleDemo();
    });

    expect(result.current.isActive).toBe(false);
  });

  it('should track active components', () => {
    const { result } = renderHook(() => useDemoMode());

    act(() => {
      result.current.startDemo();
    });

    // Initially should have orchestrator active
    expect(result.current.activeComponents.has('orchestrator')).toBe(true);

    act(() => {
      vi.advanceTimersByTime(800);
    });

    // After activity, should have more active components
    expect(result.current.activeComponents.size).toBeGreaterThanOrEqual(1);
  });

  it('should clean up interval on unmount', () => {
    const { result, unmount } = renderHook(() => useDemoMode());

    act(() => {
      result.current.startDemo();
    });

    unmount();

    // Should not throw or cause issues
    act(() => {
      vi.advanceTimersByTime(2000);
    });
  });
});
