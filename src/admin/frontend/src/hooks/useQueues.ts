import { useState, useEffect, useCallback } from 'react';
import type { QueueStats } from '../types';
import { getQueues } from '../api/client';
import { useInterval } from './useInterval';

export function useQueues(pollInterval = 30000) {
  const [queues, setQueues] = useState<QueueStats[]>([]);
  const [totalJobs, setTotalJobs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const data = await getQueues();
      setQueues(data);
      const total = data.reduce((sum, q) => sum + q.waiting + q.active, 0);
      setTotalJobs(total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch queues'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useInterval(fetchData, pollInterval);

  return { queues, totalJobs, loading, error, refetch: fetchData };
}
