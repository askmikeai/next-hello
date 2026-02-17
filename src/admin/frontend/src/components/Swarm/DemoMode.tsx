import { useState, useEffect, useCallback, useRef } from 'react';
import type { SwarmState, AgentActivity, AgentStats } from '../../types';

const DEMO_PHONES = ['+1555123456', '+1555234567', '+1555345678', '+1555456789'];
const DEMO_TOOLS = [
  'contact_lookup',
  'contact_update',
  'get_calendly_link',
  'send_video',
  'generate_video',
  'research_contact',
  'delete_contact',
];
const DEMO_WORKERS = ['video_worker', 'research_worker', 'crm_worker', 'voice_worker'];

const DEMO_ACTIONS: Record<string, string[]> = {
  contact_lookup: ['Looking up contact', 'Fetching contact details', 'Querying database'],
  contact_update: ['Updating email', 'Saving company info', 'Updating job title'],
  get_calendly_link: ['Fetching scheduling link', 'Getting availability'],
  send_video: ['Sending personalized video', 'Delivering video message'],
  generate_video: ['Generating HeyGen video', 'Creating personalized intro'],
  research_contact: ['Researching on LinkedIn', 'Finding company info'],
  delete_contact: ['Processing deletion request', 'Removing contact data'],
  video_worker: ['Processing video job', 'Polling HeyGen status', 'Video ready'],
  research_worker: ['Fetching LinkedIn data', 'Enriching contact'],
  crm_worker: ['Syncing to HubSpot', 'Creating CRM contact'],
  voice_worker: ['Generating voice message', 'ElevenLabs processing'],
};

interface DemoState {
  conversations: SwarmState[];
  activities: AgentActivity[];
  activeComponents: Set<string>;
  stats: AgentStats[];
}

export function useDemoMode() {
  const [isActive, setIsActive] = useState(false);
  const [demoState, setDemoState] = useState<DemoState>({
    conversations: [],
    activities: [],
    activeComponents: new Set(),
    stats: [],
  });
  const intervalRef = useRef<number | null>(null);

  const generateActivity = useCallback(() => {
    const useWorker = Math.random() < 0.3;
    const component = useWorker
      ? DEMO_WORKERS[Math.floor(Math.random() * DEMO_WORKERS.length)]
      : DEMO_TOOLS[Math.floor(Math.random() * DEMO_TOOLS.length)];

    const actions = DEMO_ACTIONS[component];
    const action = actions[Math.floor(Math.random() * actions.length)];
    const phone = DEMO_PHONES[Math.floor(Math.random() * DEMO_PHONES.length)];

    const activity: AgentActivity = {
      id: `demo-${Date.now()}-${Math.random()}`,
      correlationId: `demo-${phone.slice(-4)}`,
      agentType: component,
      action,
      status: Math.random() < 0.95 ? 'completed' : 'failed',
      startedAt: new Date().toISOString(),
      durationMs: Math.floor(Math.random() * 500) + 50,
      toolName: useWorker ? undefined : component,
    };

    setDemoState((prev) => {
      const newActivities = [activity, ...prev.activities].slice(0, 20);
      const newActiveComponents = new Set(['orchestrator', component]);

      // Update conversations
      let newConversations = [...prev.conversations];
      const existingConv = newConversations.find((c) => c.phoneNumber === phone);
      if (existingConv) {
        existingConv.conversationTurns++;
        existingConv.lastActivityAt = new Date().toISOString();
      } else if (newConversations.length < 4) {
        newConversations.push({
          correlationId: `demo-${Math.random().toString(36).slice(2, 10)}`,
          phoneNumber: phone,
          currentAgent: 'orchestrator',
          conversationTurns: 1,
          lastActivityAt: new Date().toISOString(),
          taskQueueLength: Math.floor(Math.random() * 3),
          channel: 'whatsapp',
        });
      }

      // Generate demo stats
      const demoStats: AgentStats[] = [
        { agentType: 'Orchestrator', executions: 47, avgDurationMs: 234, successRate: 98 },
        { agentType: 'Lookup', executions: 23, avgDurationMs: 45, successRate: 100 },
        { agentType: 'Update', executions: 18, avgDurationMs: 78, successRate: 94 },
        { agentType: 'Video Worker', executions: 8, avgDurationMs: 4521, successRate: 87 },
        { agentType: 'Research Worker', executions: 12, avgDurationMs: 2340, successRate: 92 },
      ];

      return {
        conversations: newConversations,
        activities: newActivities,
        activeComponents: newActiveComponents,
        stats: demoStats,
      };
    });
  }, []);

  const startDemo = useCallback(() => {
    setIsActive(true);
    setDemoState({
      conversations: DEMO_PHONES.slice(0, 2).map((phone) => ({
        correlationId: `demo-${Math.random().toString(36).slice(2, 10)}`,
        phoneNumber: phone,
        currentAgent: 'orchestrator',
        conversationTurns: Math.floor(Math.random() * 10) + 1,
        lastActivityAt: new Date().toISOString(),
        taskQueueLength: Math.floor(Math.random() * 3),
        channel: 'whatsapp',
      })),
      activities: [],
      activeComponents: new Set(['orchestrator']),
      stats: [],
    });

    intervalRef.current = window.setInterval(generateActivity, 800);
  }, [generateActivity]);

  const stopDemo = useCallback(() => {
    setIsActive(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setDemoState({
      conversations: [],
      activities: [],
      activeComponents: new Set(),
      stats: [],
    });
  }, []);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return {
    isActive,
    startDemo,
    stopDemo,
    toggleDemo: isActive ? stopDemo : startDemo,
    ...demoState,
  };
}
