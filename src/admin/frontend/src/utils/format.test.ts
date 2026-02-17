import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatTime, formatDate, truncate } from './format';

describe('formatTime', () => {
  it('should format ISO string to time', () => {
    const result = formatTime('2024-01-15T14:30:45Z');
    // Result will depend on local timezone, so just check it's a valid time format
    expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });

  it('should return dash for empty string', () => {
    expect(formatTime('')).toBe('-');
  });
});

describe('formatDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return "just now" for recent times', () => {
    const now = new Date();
    expect(formatDate(now.toISOString())).toBe('just now');
  });

  it('should return minutes ago for times within an hour', () => {
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
    expect(formatDate(thirtyMinsAgo.toISOString())).toBe('30m ago');
  });

  it('should return hours ago for times within a day', () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
    expect(formatDate(fiveHoursAgo.toISOString())).toBe('5h ago');
  });

  it('should return date string for older times', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const result = formatDate(twoDaysAgo.toISOString());
    // Should be a localized date string
    expect(result).not.toContain('ago');
  });

  it('should return dash for empty string', () => {
    expect(formatDate('')).toBe('-');
  });
});

describe('truncate', () => {
  it('should return string unchanged if shorter than limit', () => {
    expect(truncate('Hello', 10)).toBe('Hello');
  });

  it('should truncate string with ellipsis if longer than limit', () => {
    expect(truncate('Hello World', 5)).toBe('Hello...');
  });

  it('should use default limit of 80', () => {
    const longString = 'a'.repeat(100);
    const result = truncate(longString);
    expect(result.length).toBe(83); // 80 chars + '...'
  });

  it('should replace newlines with spaces', () => {
    expect(truncate('Hello\nWorld', 20)).toBe('Hello World');
  });

  it('should return dash for empty string', () => {
    expect(truncate('')).toBe('-');
  });
});
