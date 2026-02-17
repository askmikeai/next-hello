import { useState, useEffect, useCallback } from 'react';
import type { ConversationMessage } from '../types';
import { getMessages } from '../api/client';
import { useInterval } from './useInterval';

export function useMessages(limit = 50, phone?: string, pollInterval = 30000) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const data = await getMessages(limit, phone);
      setMessages(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch messages'));
    } finally {
      setLoading(false);
    }
  }, [limit, phone]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useInterval(fetchData, pollInterval);

  return { messages, loading, error, refetch: fetchData };
}
