import { useState, useEffect, useCallback } from 'react';
import type { AgentStats } from '../types';
import { getAgentStats } from '../api/client';
import { useInterval } from './useInterval';

export function useAgentStats(pollInterval = 10000) {
  const [stats, setStats] = useState<AgentStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const data = await getAgentStats();
      setStats(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch agent stats'));
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
