import type {
  ContactStats,
  Contact,
  QueueStats,
  HealthStatus,
  ConversationMessage,
  AgentActivity,
  SwarmState,
  AgentStats,
} from '../types';

export const mockStats: ContactStats = {
  total: 100,
  byStatus: {
    new: 20,
    qualified: 50,
    contacted: 30,
  },
  byQualification: {
    hot: 15,
    warm: 35,
    cold: 50,
  },
};

export const mockContacts: Contact[] = [
  {
    id: '1',
    phone_number: '+1555123456',
    first_name: 'John',
    last_name: 'Doe',
    email: 'john@example.com',
    company_name: 'Acme Corp',
    job_title: 'Engineer',
    status: 'qualified',
    qualification_tier: 'hot',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
  },
  {
    id: '2',
    phone_number: '+1555234567',
    first_name: 'Jane',
    last_name: 'Smith',
    email: 'jane@example.com',
    company_name: 'Tech Inc',
    job_title: 'Manager',
    status: 'new',
    qualification_tier: 'warm',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: null,
  },
];

export const mockQueues: QueueStats[] = [
  { name: 'incoming-messages', waiting: 5, active: 2, completed: 100, failed: 1, delayed: 0 },
  { name: 'outbound-messages', waiting: 3, active: 1, completed: 200, failed: 0, delayed: 0 },
  { name: 'video-generation', waiting: 1, active: 0, completed: 50, failed: 2, delayed: 0 },
];

export const mockHealth: HealthStatus = {
  redis: {
    connected: true,
    latencyMs: 5,
  },
  postgres: {
    healthy: true,
    latencyMs: 10,
  },
};

export const mockUnhealthyStatus: HealthStatus = {
  redis: {
    connected: false,
    latencyMs: 0,
    error: 'Connection refused',
  },
  postgres: {
    healthy: false,
    error: 'Connection timeout',
  },
};

export const mockMessages: ConversationMessage[] = [
  {
    id: 'msg-1',
    contactId: '1',
    phoneNumber: '+1555123456',
    correlationId: 'corr-1',
    direction: 'inbound',
    channel: 'whatsapp',
    messageType: 'text',
    content: 'Hello, I am interested in your product',
    createdAt: '2024-01-02T10:30:00Z',
  },
  {
    id: 'msg-2',
    contactId: '1',
    phoneNumber: '+1555123456',
    correlationId: 'corr-1',
    direction: 'outbound',
    channel: 'whatsapp',
    messageType: 'text',
    content: 'Hi! Thanks for reaching out. How can I help?',
    agentId: 'orchestrator',
    createdAt: '2024-01-02T10:31:00Z',
  },
];

export const mockActivities: AgentActivity[] = [
  {
    id: 'act-1',
    correlationId: 'corr-1',
    agentType: 'orchestrator',
    action: 'process_message',
    status: 'completed',
    startedAt: '2024-01-02T10:30:00Z',
    completedAt: '2024-01-02T10:30:05Z',
    durationMs: 5000,
  },
  {
    id: 'act-2',
    correlationId: 'corr-1',
    agentType: 'contact_lookup',
    action: 'lookup',
    status: 'completed',
    startedAt: '2024-01-02T10:30:01Z',
    completedAt: '2024-01-02T10:30:02Z',
    durationMs: 1000,
    toolName: 'contact_lookup',
  },
  {
    id: 'act-3',
    correlationId: 'corr-2',
    agentType: 'video_worker',
    action: 'generate_video',
    status: 'failed',
    startedAt: '2024-01-02T10:35:00Z',
    completedAt: '2024-01-02T10:35:30Z',
    durationMs: 30000,
  },
];

export const mockSwarmStates: SwarmState[] = [
  {
    correlationId: 'corr-1',
    phoneNumber: '+1555123456',
    currentAgent: 'orchestrator',
    conversationTurns: 5,
    lastActivityAt: '2024-01-02T10:30:00Z',
    taskQueueLength: 2,
    channel: 'whatsapp',
  },
  {
    correlationId: 'corr-2',
    phoneNumber: '+1555234567',
    currentAgent: 'orchestrator',
    conversationTurns: 3,
    lastActivityAt: '2024-01-02T10:25:00Z',
    taskQueueLength: 0,
    channel: 'whatsapp',
  },
];

export const mockAgentStats: AgentStats[] = [
  { agentType: 'orchestrator', executions: 100, avgDurationMs: 250, successRate: 98 },
  { agentType: 'contact_lookup', executions: 50, avgDurationMs: 45, successRate: 100 },
  { agentType: 'video_worker', executions: 20, avgDurationMs: 5000, successRate: 85 },
];

export function createMockFetch(responses: Record<string, unknown>) {
  return vi.fn().mockImplementation((url: string) => {
    const path = url.replace('/admin/api', '');
    const baseUrl = path.split('?')[0];

    if (baseUrl in responses) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(responses[baseUrl]),
      });
    }

    return Promise.resolve({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });
  });
}
