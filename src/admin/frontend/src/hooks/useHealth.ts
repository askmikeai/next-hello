import { useState, useEffect, useCallback } from 'react';
import type { HealthStatus } from '../types';
import { getHealth } from '../api/client';
import { useInterval } from './useInterval';

export function useHealth(pollInterval = 30000) {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const isHealthy = health
    ? health.redis.connected && health.postgres.healthy
    : false;

  const fetchData = useCallback(async () => {
    try {
      const data = await getHealth();
      setHealth(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch health'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useInterval(fetchData, pollInterval);

  return { health, isHealthy, loading, error, refetch: fetchData };
}
