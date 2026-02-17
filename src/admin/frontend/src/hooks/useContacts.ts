import { useState, useEffect, useCallback } from 'react';
import type { Contact } from '../types';
import { getContacts } from '../api/client';
import { useInterval } from './useInterval';

export function useContacts(limit = 15, pollInterval = 30000) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const data = await getContacts(limit);
      setContacts(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch contacts'));
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useInterval(fetchData, pollInterval);

  return { contacts, loading, error, refetch: fetchData };
}
