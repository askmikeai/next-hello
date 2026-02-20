import { useState, useEffect, useCallback } from 'react';
import type { GreetingVideoInfo } from '../types';
import { getGreetingVideo } from '../api/client';

export function useGreetingVideo() {
  const [video, setVideo] = useState<GreetingVideoInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getGreetingVideo();
      setVideo(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch greeting video');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { video, loading, error, refetch: fetchData };
}
