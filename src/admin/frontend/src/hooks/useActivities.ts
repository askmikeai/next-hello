import { useState, useEffect, useCallback } from 'react';
import type { AgentActivity } from '../types';
import { getActivities } from '../api/client';
import { useInterval } from './useInterval';

export function useActivities(limit = 20, agentType?: string, pollInterval = 30000) {
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const data = await getActivities(limit, agentType);
      setActivities(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch activities'));
    } finally {
      setLoading(false);
    }
  }, [limit, agentType]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useInterval(fetchData, pollInterval);

  return { activities, loading, error, refetch: fetchData };
}
