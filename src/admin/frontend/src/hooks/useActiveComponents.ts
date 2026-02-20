import { useMemo } from 'react';
import type { AgentActivity, SwarmState } from '../types';

interface UseActiveComponentsOptions {
  enableLogging?: boolean;
}

interface UseActiveComponentsResult {
  activeComponents: Set<string>;
}

/**
 * Shared hook for calculating active swarm components from activities.
 * Uses a 30-second window for activity detection.
 */
export function useActiveComponents(
  activities: AgentActivity[],
  states: SwarmState[],
  options: UseActiveComponentsOptions = {}
): UseActiveComponentsResult {
  const { enableLogging = false } = options;

  const activeComponents = useMemo(() => {
    const active = new Set<string>();
    const recentCutoff = Date.now() - 30000; // Last 30 seconds

    // Map agent types to their external worker nodes
    const agentToWorker: Record<string, string> = {
      voice: 'voice_worker',
      video: 'video_worker',
      research: 'research_worker',
      crm: 'crm_worker',
    };

    activities.forEach((a) => {
      const activityTime = new Date(a.startedAt).getTime();
      if (activityTime > recentCutoff) {
        active.add(a.agentType);
        // Also activate orchestrator when any agent is active
        active.add('orchestrator');
        // Activate the corresponding worker node
        const worker = agentToWorker[a.agentType];
        if (worker) {
          active.add(worker);
        }
      }
    });

    // Show orchestrator as active if there are any active conversations
    if (states.length > 0) {
      active.add('orchestrator');
    }

    // Debug logging with token burn (only when enabled)
    if (enableLogging && active.size > 0) {
      const recentActivities = activities.filter((a) => {
        const age = Date.now() - new Date(a.startedAt).getTime();
        return age < 30000;
      });
      const totalTokens = recentActivities.reduce(
        (sum, a) => sum + (a.inputTokens || 0) + (a.outputTokens || 0),
        0
      );
      console.log(
        '[Swarm Topology] Active components:',
        Array.from(active),
        `| Total tokens: ${totalTokens}`
      );
    }

    return active;
  }, [activities, states.length, enableLogging]);

  return { activeComponents };
}
