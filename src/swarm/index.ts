/**
 * NextHello AI Swarm - Multi-Agent Architecture
 *
 * This module provides a multi-agent AI system using the Orchestrator Pattern.
 * It coordinates specialized agents for conversation, research, qualification,
 * personalization, video generation, and CRM synchronization.
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

// Import agents to register their factories
import "./agents/conversation.agent.js";
import "./agents/research.agent.js";
import "./agents/qualification.agent.js";
import "./agents/crm.agent.js";
import "./agents/personalization.agent.js";
import "./agents/video.agent.js";

// Re-export agents for direct use if needed
export { ConversationAgent } from "./agents/conversation.agent.js";
export { ResearchAgent } from "./agents/research.agent.js";
export { QualificationAgent } from "./agents/qualification.agent.js";
export { CRMAgent } from "./agents/crm.agent.js";
export { PersonalizationAgent } from "./agents/personalization.agent.js";
export { VideoAgent } from "./agents/video.agent.js";

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
  logEvent(logger, "swarm_initializing", {
    enabled: config.swarm?.enabled,
    rolloutPercentage: config.swarm?.rolloutPercentage,
  });

  // Initialize message store
  const messageStore = getMessageStore({
    supabase: config.supabase,
    tableName: "message_history",
  });

  // Initialize context builder
  const contextBuilder = getContextBuilder({
    tokenBudget: config.swarm?.contextTokenBudget,
  });

  // Initialize orchestrator
  const orchestrator = getOrchestrator(config, {
    maxConversationTurns: config.swarm?.maxConversationTurns,
    fallbackToRules: config.swarm?.fallbackToRules,
  });

  logEvent(logger, "swarm_initialized", {
    availableAgents: orchestrator.getAvailableAgents(),
    isOperational: orchestrator.isOperational(),
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
