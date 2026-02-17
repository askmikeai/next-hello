export interface ContactStats {
  total: number;
  byStatus: Record<string, number>;
  byQualification: Record<string, number>;
}

export interface Contact {
  id: string;
  phone_number: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company_name: string | null;
  job_title: string | null;
  status: string | null;
  qualification_tier: 'hot' | 'warm' | 'cold' | null;
  created_at: string;
  updated_at: string | null;
}

export interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export interface HealthStatus {
  redis: {
    connected: boolean;
    latencyMs: number;
    error?: string;
  };
  postgres: {
    healthy: boolean;
    latencyMs?: number;
    error?: string;
  };
}

export interface ConversationMessage {
  id: string;
  contactId: string;
  phoneNumber: string;
  correlationId: string;
  direction: 'inbound' | 'outbound';
  channel: string;
  messageType: string;
  content?: string;
  agentId?: string;
  createdAt: string;
  contactName?: string;
}

export interface AgentActivity {
  id: string;
  correlationId: string;
  agentType: string;
  action: string;
  status: 'started' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  toolName?: string;
  metadata?: Record<string, unknown>;
}

export interface SwarmState {
  correlationId: string;
  phoneNumber: string;
  currentAgent: string | null;
  conversationTurns: number;
  lastActivityAt: string;
  taskQueueLength: number;
  channel: string;
}

export interface AgentStats {
  agentType: string;
  executions: number;
  avgDurationMs: number;
  successRate: number;
}

export type Tab = 'overview' | 'swarm';
