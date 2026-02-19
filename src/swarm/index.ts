/**
 * NextHello AI Swarm - Multi-Agent Architecture
 *
 * This module provides a multi-agent AI system using the Orchestrator Pattern.
 * The orchestrator handles all conversations and coordinates specialized agents:
 *
 * - Research Agent: Contact enrichment via PDL API + Luma event attendee matching
 * - Qualification Agent: Lead scoring and tier assignment (hot/warm/cold)
 * - Personalization Agent: Content generation (scripts, messages, emails)
 * - Video Agent: HeyGen video generation
 * - Voice Agent: ElevenLabs text-to-speech generation
 * - CRM Agent: HubSpot CRM synchronization
 * - Email Agent: Email reading (IMAP) and sending (SendGrid/Resend)
 *
 * Agents run in parallel using the ParallelTaskRunner for non-blocking execution.
 */

// Core types
export * from "./types.js";

// LLM client
export { LLMClient, getLLMClient, createLLMClient, DEFAULT_MODEL } from "./llm/client.js";
export { ToolExecutor, getToolExecutor, createToolExecutor, defineTool } from "./llm/tool-executor.js";

// Base agent
export { BaseAgent, registerAgentFactory, createAgent, getRegisteredAgentTypes } from "./base-agent.js";
export type { AgentConfig, AgentFactory } from "./base-agent.js";

// Orchestrator
export { SwarmOrchestrator, getOrchestrator, resetOrchestrator } from "./orchestrator.js";
export type { OrchestratorConfig } from "./orchestrator.js";

// Agent Registry (Dynamic Orchestration)
export * from "./registry/index.js";

// Dynamic Orchestration Tools
export * from "./tools/index.js";

// Agent Reasoning Prompts
export * from "./prompts/index.js";

// Import agents to register their factories
import "./agents/research.agent.js";
import "./agents/qualification.agent.js";
import "./agents/crm.agent.js";
import "./agents/personalization.agent.js";
import "./agents/video.agent.js";
import "./agents/voice.agent.js";
import "./agents/email.agent.js";

// Re-export agents for direct use if needed
export { ResearchAgent } from "./agents/research.agent.js";
export { QualificationAgent } from "./agents/qualification.agent.js";
export { CRMAgent } from "./agents/crm.agent.js";
export { PersonalizationAgent } from "./agents/personalization.agent.js";
export { VideoAgent } from "./agents/video.agent.js";
export { VoiceAgent } from "./agents/voice.agent.js";
export { EmailAgent } from "./agents/email.agent.js";

/**
 * Initialize the swarm system with configuration
 */
import type { NetworkingEventConfig } from "../config/types.js";
import { getOrchestrator } from "./orchestrator.js";
import { getMessageStore } from "../history/message-store.js";
import { getContextBuilder } from "../history/context-builder.js";
import { createLogger, logEvent } from "../observability/logger.js";

const logger = createLogger({ component: "swarm" });

/**
 * Initialize all swarm components
 */
export function initializeSwarm(config: NetworkingEventConfig): {
  orchestrator: ReturnType<typeof getOrchestrator>;
  messageStore: ReturnType<typeof getMessageStore>;
  contextBuilder: ReturnType<typeof getContextBuilder>;
} {
  const dynamicOrchConfig = config.swarm?.dynamicOrchestration;

  logEvent(logger, "swarm_initializing", {
    enabled: config.swarm?.enabled,
    rolloutPercentage: config.swarm?.rolloutPercentage,
    dynamicOrchestration: dynamicOrchConfig?.enabled ?? true,
  });

  // Initialize message store
  const messageStore = getMessageStore({
    tableName: "message_history",
  });

  // Initialize context builder
  const contextBuilder = getContextBuilder({
    tokenBudget: config.swarm?.contextTokenBudget,
  });

  // Initialize orchestrator with dynamic orchestration config
  const orchestrator = getOrchestrator(config, {
    maxConversationTurns: config.swarm?.maxConversationTurns,
    fallbackToRules: config.swarm?.fallbackToRules,
    dynamicOrchestration: {
      enabled: dynamicOrchConfig?.enabled ?? true,
      enableAgentSelection: dynamicOrchConfig?.enableAgentSelection ?? true,
      enableDynamicDependencies: dynamicOrchConfig?.enableDynamicDependencies ?? true,
      enableResultAwareness: dynamicOrchConfig?.enableResultAwareness ?? true,
    },
  });

  logEvent(logger, "swarm_initialized", {
    availableAgents: orchestrator.getAvailableAgents(),
    isOperational: orchestrator.isOperational(),
    dynamicOrchestrationEnabled: dynamicOrchConfig?.enabled ?? true,
  });

  return {
    orchestrator,
    messageStore,
    contextBuilder,
  };
}

/**
 * Check if swarm should handle a request (based on rollout percentage)
 */
export function shouldUseSwarm(config: NetworkingEventConfig, phoneNumber?: string): boolean {
  // Check if swarm is enabled
  if (!config.swarm?.enabled) {
    return false;
  }

  // Check rollout percentage
  const rolloutPercentage = config.swarm.rolloutPercentage ?? 0;
  if (rolloutPercentage <= 0) {
    return false;
  }
  if (rolloutPercentage >= 100) {
    return true;
  }

  // Deterministic rollout based on phone number hash
  if (phoneNumber) {
    const hash = simpleHash(phoneNumber);
    return (hash % 100) < rolloutPercentage;
  }

  // Random rollout if no phone number
  return Math.random() * 100 < rolloutPercentage;
}

/**
 * Simple hash function for deterministic rollout
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}
