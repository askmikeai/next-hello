import type { Logger } from "pino";
import type { NetworkingContact, NetworkingEventConfig } from "../config/types.js";

/**
 * Agent types in the swarm - Corporate Hierarchy
 *
 * ORCHESTRATOR (CEO / AI Brain)
 * └── Handles ALL conversations, coordinates all agents
 *     │
 *     ├── RESEARCH Agent ──► PDL API, Luma Scraper
 *     │   └── Contact enrichment & event attendee matching
 *     │
 *     ├── QUALIFICATION Agent (depends on Research)
 *     │   └── Lead scoring (0-100) & tier assignment
 *     │
 *     ├── CRM Agent ──► HubSpot API
 *     │   └── HubSpot synchronization
 *     │
 *     ├── PERSONALIZATION Agent
 *     │   └── Content generation (scripts, messages, emails)
 *     │
 *     ├── VIDEO Agent ──► HeyGen API
 *     │   └── HeyGen video generation
 *     │
 *     ├── VOICE Agent ──► ElevenLabs API
 *     │   └── ElevenLabs text-to-speech
 *     │
 *     └── EMAIL Agent ──► IMAP / SendGrid
 *         └── Email reading (MFA codes) & sending
 *
 * All agents report directly to Orchestrator.
 * Only Qualification depends on Research completing first.
 */
export type AgentType =
  | "orchestrator"
  | "research"
  | "qualification"
  | "personalization"
  | "video"
  | "voice"
  | "crm"
  | "email";

/**
 * Task status tracking
 */
export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "cancelled";

/**
 * Message direction
 */
export type MessageDirection = "inbound" | "outbound";

/**
 * Communication channel
 */
export type Channel = "whatsapp" | "telegram" | "email";

/**
 * Message content type
 */
export type MessageType = "text" | "image" | "video" | "audio" | "document" | "sticker" | "location";

/**
 * Lead qualification tiers
 */
export type QualificationTier = "hot" | "warm" | "cold" | "unqualified";

/**
 * Research status
 */
export type ResearchStatus = "pending" | "in_progress" | "complete" | "failed";

/**
 * Tool definition for agents
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Tool call request from LLM
 */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Tool execution result
 */
export interface ToolResult {
  toolCallId: string;
  result: unknown;
  error?: string;
}

/**
 * Message in conversation history
 */
export interface ConversationMessage {
  id: string;
  contactId: string;
  phoneNumber: string;
  correlationId: string;
  direction: MessageDirection;
  channel: Channel;
  messageType: MessageType;
  content?: string;
  agentId?: string;
  modelUsed?: string;
  tokensUsed?: number;
  toolCalls?: ToolCall[];
  createdAt: Date;
  // Media fields
  mediaUrl?: string;
  mediaMimetype?: string;
  mediaSizeBytes?: number;
  mediaDurationSeconds?: number;
  mediaWidth?: number;
  mediaHeight?: number;
  // Location fields
  locationLatitude?: number;
  locationLongitude?: number;
  locationName?: string;
  locationAddress?: string;
  // Flags
  isVoiceNote?: boolean;
  isVideoNote?: boolean;
  isGif?: boolean;
  isViewOnce?: boolean;
  isAnimated?: boolean;
}

/**
 * Agent activity log entry
 */
export interface AgentActivityLog {
  id: string;
  correlationId: string;
  contactId?: string;
  agentType: AgentType;
  action: string;
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
  status: TaskStatus;
  inputTokens?: number;
  outputTokens?: number;
  errorMessage?: string;
}

/**
 * Context for agent execution
 */
export interface AgentContext {
  correlationId: string;
  config: NetworkingEventConfig;
  contact?: NetworkingContact;
  phoneNumber?: string;
  channel?: Channel;
  logger: Logger;
  messageHistory?: ConversationMessage[];
  /** The most recent user message - used for parsing user selections */
  lastUserMessage?: string;
  /** Additional context for agent-specific operations */
  additionalContext?: string;
}

/**
 * Result from agent execution
 */
export interface AgentResult {
  success: boolean;
  agentType: AgentType;
  response?: string;
  data?: Record<string, unknown>;
  toolCalls?: ToolCall[];
  tokensUsed?: {
    input: number;
    output: number;
  };
  nextAgent?: AgentType;
  error?: string;
}

/**
 * Task for agent execution
 */
export interface AgentTask {
  id: string;
  correlationId: string;
  agentType: AgentType;
  action: string;
  input: {
    message?: string;
    contact?: NetworkingContact;
    phoneNumber?: string;
    channel?: Channel;
    data?: Record<string, unknown>;
  };
  priority?: number;
  createdAt: Date;
  status: TaskStatus;
  result?: AgentResult;
}

/**
 * Strategy types for dynamic orchestration
 */
export type StrategyType = "direct_response" | "rule_based" | "agent_orchestration";

/**
 * Strategy decision recorded in state
 */
export interface StrategyDecision {
  strategy: StrategyType;
  reasoning: string;
  suggestedAgents?: AgentType[];
  priority: "immediate" | "background";
  decidedAt: Date;
}

/**
 * Recent agent result stored in state
 */
export interface RecentAgentResult {
  agentType: AgentType;
  success: boolean;
  response?: string;
  data?: Record<string, unknown>;
  error?: string;
  completedAt: Date;
}

/**
 * Swarm state stored in Redis
 */
export interface SwarmState {
  correlationId: string;
  contactId?: string;
  phoneNumber: string;
  channel: Channel;
  currentAgent?: AgentType;
  taskQueue: AgentTask[];
  completedTasks: AgentTask[];
  conversationTurns: number;
  lastActivityAt: Date;
  metadata?: Record<string, unknown>;
  /** Last strategy decision made by Claude */
  lastStrategy?: StrategyDecision;
  /** Recent results from agent invocations (keyed by agent type) */
  recentAgentResults?: Record<AgentType, RecentAgentResult>;
}

/**
 * Orchestrator routing decision
 */
export interface RoutingDecision {
  targetAgent: AgentType;
  action: string;
  priority: number;
  reason: string;
  input?: Record<string, unknown>;
}

/**
 * LLM response from Claude
 */
export interface LLMResponse {
  id: string;
  content: string;
  stopReason: string;
  toolCalls?: ToolCall[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * LLM request to Claude
 */
export interface LLMRequest {
  model?: string;
  maxTokens?: number;
  systemPrompt: string;
  messages: Array<{
    role: "user" | "assistant";
    content: string | Array<{
      type: "text" | "tool_use" | "tool_result";
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
      tool_use_id?: string;
      content?: string;
    }>;
  }>;
  tools?: ToolDefinition[];
  temperature?: number;
}

/**
 * Queue job types
 */
export type QueueName =
  | "incoming-messages"
  | "outbound-messages"
  | "agent-tasks"
  | "research-jobs"
  | "video-generation"
  | "voice-generation"
  | "crm-sync"
  | "lead-qualification"
  | "pdl-enrichment"
  | "luma-sync";

/**
 * Queue job data for incoming messages
 */
export interface IncomingMessageJob {
  correlationId: string;
  phoneNumber: string;
  channel: Channel;
  message: string;
  timestamp: Date;
  // Voice message metadata
  isVoiceMessage?: boolean;
  voiceMessageDurationSeconds?: number;
  transcriptionSource?: "whisper";
}

/**
 * Queue job data for outbound messages (videos, follow-ups, etc.)
 */
export interface OutboundMessageJob {
  correlationId: string;
  phoneNumber: string;
  channel: Channel;
  messageType: "text" | "video" | "image" | "voice";
  content: string; // Text message or URL for media
  caption?: string; // Caption for video/image
  metadata?: Record<string, unknown>;
}

/**
 * Queue job data for agent tasks
 */
export interface AgentTaskJob {
  task: AgentTask;
  context: Omit<AgentContext, "logger">;
}

/**
 * Queue job data for research
 */
export interface ResearchJob {
  correlationId: string;
  contactId: string;
  phoneNumber: string;
  linkedinUrl?: string;
  companyName?: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Queue job data for video generation
 */
export interface VideoGenerationJob {
  correlationId: string;
  contactId: string;
  phoneNumber: string;
  firstName: string;
  scriptTemplate: string;
  variables: Record<string, string>;
}

/**
 * Queue job data for voice message generation
 */
export interface VoiceGenerationJob {
  correlationId: string;
  contactId: string;
  phoneNumber: string;
  firstName: string;
  lastName?: string;
  companyName?: string;
  scriptText?: string;
  variables?: Record<string, string>;
}

/**
 * Queue job data for CRM sync
 */
export interface CrmSyncJob {
  correlationId: string;
  contactId: string;
  phoneNumber: string;
  operation: "create" | "update" | "sync";
}

/**
 * Queue job data for lead qualification
 */
export interface LeadQualificationJob {
  correlationId: string;
  contactId: string;
  phoneNumber: string;
  researchData?: Record<string, unknown>;
}

/**
 * Swarm configuration
 */
export interface SwarmConfig {
  enabled?: boolean;
  rolloutPercentage?: number;
  fallbackToRules?: boolean;
  maxConversationTurns?: number;
  contextTokenBudget?: number;
  defaultModel?: string;
  agents?: {
    research?: { enabled?: boolean };
    qualification?: { enabled?: boolean };
    personalization?: { enabled?: boolean };
    video?: { enabled?: boolean };
    voice?: { enabled?: boolean };
    crm?: { enabled?: boolean };
  };
}

/**
 * Extended contact fields for swarm
 */
export interface SwarmContactExtensions {
  qualificationScore?: number;
  qualificationTier?: QualificationTier;
  researchStatus?: ResearchStatus;
  researchData?: {
    linkedinProfile?: Record<string, unknown>;
    companyInfo?: Record<string, unknown>;
    enrichedAt?: Date;
  };
  totalTurns?: number;
  swarmMetadata?: {
    lastAgentType?: AgentType;
    lastCorrelationId?: string;
    aiGeneratedResponses?: number;
    ruleFallbacks?: number;
  };
}

/**
 * Circuit breaker state
 */
export interface CircuitBreakerState {
  name: string;
  state: "closed" | "open" | "half-open";
  failures: number;
  successes: number;
  lastFailure?: Date;
  lastSuccess?: Date;
  nextRetry?: Date;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterFactor: number;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  name: string;
  status: "healthy" | "unhealthy" | "degraded";
  latencyMs?: number;
  message?: string;
  lastChecked: Date;
}

/**
 * Overall health status
 */
export interface HealthStatus {
  status: "healthy" | "unhealthy" | "degraded";
  version: string;
  uptime: number;
  checks: HealthCheckResult[];
}
