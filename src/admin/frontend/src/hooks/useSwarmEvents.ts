import { useState, useEffect, useCallback, useRef } from 'react';
import type { AgentActivity, SwarmState } from '../types';

interface SwarmEvent {
  type: string;
  timestamp: string;
  data: {
    activities?: AgentActivity[];
    states?: SwarmState[];
    agentType?: string;
    action?: string;
    status?: string;
    correlationId?: string;
  };
}

export function useSwarmEvents() {
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [states, setStates] = useState<SwarmState[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    // Clean up any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource('/admin/api/swarm/events');
    eventSourceRef.current = eventSource;

    eventSource.addEventListener('connected', () => {
      setConnected(true);
      setError(null);
    });

    eventSource.addEventListener('state:sync', (event) => {
      try {
        const data = JSON.parse(event.data) as SwarmEvent;
        if (data.data.activities) {
          setActivities(data.data.activities);
          // Debug: log recent activities with token burn
          const recent = data.data.activities.filter(a => {
            const age = Date.now() - new Date(a.startedAt).getTime();
            return age < 30000;
          });
          if (recent.length > 0) {
            console.log('[SSE] Recent activities:');
            recent.forEach(a => {
              const tokens = (a.inputTokens || 0) + (a.outputTokens || 0);
              console.log(`  ${a.agentType}: ${a.status} | tokens: ${tokens} (in:${a.inputTokens || 0} out:${a.outputTokens || 0}) | ${a.durationMs || 0}ms`);
            });
          }
        }
        if (data.data.states) {
          setStates(data.data.states);
        }
      } catch {
        // Ignore parse errors
      }
    });

    eventSource.addEventListener('activity:started', (event) => {
      try {
        const data = JSON.parse(event.data) as SwarmEvent;
        // Add to activities list (will be replaced on next sync)
        if (data.data.agentType) {
          setActivities((prev) => [
            {
              id: `temp-${Date.now()}`,
              correlationId: data.data.correlationId || '',
              agentType: data.data.agentType || '',
              action: data.data.action || '',
              status: 'started' as const,
              startedAt: data.timestamp,
            },
            ...prev.slice(0, 19), // Keep last 20
          ]);
        }
      } catch {
        // Ignore parse errors
      }
    });

    eventSource.addEventListener('activity:completed', (event) => {
      try {
        const data = JSON.parse(event.data) as SwarmEvent;
        if (data.data.agentType) {
          setActivities((prev) => [
            {
              id: `temp-${Date.now()}`,
              correlationId: data.data.correlationId || '',
              agentType: data.data.agentType || '',
              action: data.data.action || '',
              status: (data.data.status as 'completed' | 'failed') || 'completed',
              startedAt: data.timestamp,
              completedAt: data.timestamp,
            },
            ...prev.slice(0, 19),
          ]);
        }
      } catch {
        // Ignore parse errors
      }
    });

    eventSource.onerror = () => {
      setConnected(false);
      setError('Connection lost');
      eventSource.close();

      // Reconnect after 3 seconds
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 3000);
    };
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  return { activities, states, connected, error };
}
