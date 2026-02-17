import { useState, useEffect, useCallback } from 'react';
import type { SwarmState } from '../types';
import { getSwarmStates } from '../api/client';
import { useInterval } from './useInterval';

export function useSwarmStates(pollInterval = 2000) {
  const [states, setStates] = useState<SwarmState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const data = await getSwarmStates();
      setStates(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch swarm states'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useInterval(fetchData, pollInterval);

  return { states, loading, error, refetch: fetchData };
}
