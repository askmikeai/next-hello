import { useState, useEffect, useCallback } from 'react';
import type { ContactStats } from '../types';
import { getStats } from '../api/client';
import { useInterval } from './useInterval';

export function useStats(pollInterval = 30000) {
  const [stats, setStats] = useState<ContactStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const data = await getStats();
      setStats(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch stats'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useInterval(fetchData, pollInterval);

  return { stats, loading, error, refetch: fetchData };
}
