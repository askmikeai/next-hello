import type { Logger } from "pino";
import { createLogger, logAgentActivity, createCorrelationId } from "../observability/logger.js";
import { BaseAgent, createAgent, getRegisteredAgentTypes } from "./base-agent.js";
import type {
  AgentType,
  AgentContext,
  AgentResult,
  AgentTask,
  RoutingDecision,
  SwarmState,
  Channel,
  TaskStatus,
} from "./types.js";
import type { NetworkingContact, NetworkingEventConfig } from "../config/types.js";
import { getRedisConnection } from "../queue/client.js";

/**
 * Orchestrator configuration
 */
export interface OrchestratorConfig {
  maxConversationTurns?: number;
  fallbackToRules?: boolean;
  defaultChannel?: Channel;
  stateExpirySecs?: number;
}

const DEFAULT_CONFIG: Required<OrchestratorConfig> = {
  maxConversationTurns: 20,
  fallbackToRules: true,
  defaultChannel: "whatsapp",
  stateExpirySecs: 86400, // 24 hours
};

/**
 * SwarmOrchestrator - Central coordinator for the multi-agent system
 *
 * Responsibilities:
 * - Routes incoming messages to appropriate agents
 * - Manages swarm state in Redis
 * - Handles agent-to-agent handoffs
 * - Provides fallback to rule-based handling when AI fails
 */
export class SwarmOrchestrator {
  private config: Required<OrchestratorConfig>;
  private agents: Map<AgentType, BaseAgent> = new Map();
  private logger: Logger;

  constructor(
    private eventConfig: NetworkingEventConfig,
    orchestratorConfig?: OrchestratorConfig
  ) {
    this.config = { ...DEFAULT_CONFIG, ...orchestratorConfig };
    this.logger = createLogger({ component: "orchestrator" });
    this.initializeAgents();
  }

  /**
   * Initialize all available agents
   */
  private initializeAgents(): void {
    const registeredTypes = getRegisteredAgentTypes();

    for (const type of registeredTypes) {
      if (type === "orchestrator") continue; // Don't create orchestrator agent

      try {
        const agent = createAgent(type);
        this.agents.set(type, agent);
        this.logger.debug({ agentType: type }, "Agent initialized");
      } catch (error) {
        this.logger.warn(
          { agentType: type, error: (error as Error).message },
          "Failed to initialize agent"
        );
      }
    }

    this.logger.info(
      { agentCount: this.agents.size },
      "Orchestrator initialized with agents"
    );
  }

  /**
   * Process an incoming message
   */
  async processMessage(
    phoneNumber: string,
    message: string,
    channel: Channel = this.config.defaultChannel,
    contact?: NetworkingContact
  ): Promise<AgentResult> {
    const correlationId = createCorrelationId();
    const logger = this.logger.child({ correlationId, phoneNumber });

    logAgentActivity(logger, {
      agentType: "orchestrator",
      action: "process_message",
      status: "started",
      contactId: contact?.id,
    });

    try {
      // Load or create swarm state
      const state = await this.loadOrCreateState(correlationId, phoneNumber, channel);

      // Build context
      const context: AgentContext = {
        correlationId,
        config: this.eventConfig,
        contact,
        phoneNumber,
        channel,
        logger,
      };

      // Route to appropriate agent
      const routing = await this.route(message, state, context);

      // Execute the selected agent
      const result = await this.executeAgent(routing, context, message);

      // Update state
      await this.updateState(state, routing, result);

      logAgentActivity(logger, {
        agentType: "orchestrator",
        action: "process_message",
        status: "completed",
        contactId: contact?.id,
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      logAgentActivity(logger, {
        agentType: "orchestrator",
        action: "process_message",
        status: "failed",
        contactId: contact?.id,
        error: errorMessage,
      });

      // Fallback to rules if configured
      if (this.config.fallbackToRules) {
        return this.fallbackResult(errorMessage);
      }

      return {
        success: false,
        agentType: "orchestrator",
        error: errorMessage,
      };
    }
  }

  /**
   * Route a message to the appropriate agent
   */
  private async route(
    message: string,
    state: SwarmState,
    context: AgentContext
  ): Promise<RoutingDecision> {
    // If we have a current agent and conversation is ongoing, continue with it
    if (state.currentAgent && state.conversationTurns < this.config.maxConversationTurns) {
      return {
        targetAgent: state.currentAgent,
        action: "continue_conversation",
        priority: 1,
        reason: "Continuing with current agent",
      };
    }

    // Analyze the message to determine intent
    const intent = this.analyzeIntent(message, context);

    // Route based on intent
    return this.routeByIntent(intent, state);
  }

  /**
   * Simple intent analysis (can be enhanced with LLM)
   */
  private analyzeIntent(
    message: string,
    context: AgentContext
  ): {
    category: string;
    confidence: number;
    entities: Record<string, string>;
  } {
    const lowerMessage = message.toLowerCase();

    // Check for email mentions
    if (lowerMessage.includes("@") || lowerMessage.includes("email")) {
      return {
        category: "collecting_info",
        confidence: 0.9,
        entities: { field: "email" },
      };
    }

    // Check for LinkedIn mentions
    if (lowerMessage.includes("linkedin") || lowerMessage.includes("linkedin.com")) {
      return {
        category: "collecting_info",
        confidence: 0.9,
        entities: { field: "linkedin" },
      };
    }

    // Check for company mentions
    if (lowerMessage.includes("work at") || lowerMessage.includes("company")) {
      return {
        category: "collecting_info",
        confidence: 0.8,
        entities: { field: "company" },
      };
    }

    // Check for meeting/scheduling intent
    if (
      lowerMessage.includes("meet") ||
      lowerMessage.includes("schedule") ||
      lowerMessage.includes("call") ||
      lowerMessage.includes("calendly")
    ) {
      return {
        category: "scheduling",
        confidence: 0.85,
        entities: {},
      };
    }

    // Check for questions
    if (message.includes("?")) {
      return {
        category: "question",
        confidence: 0.7,
        entities: {},
      };
    }

    // Default to general conversation
    return {
      category: "general",
      confidence: 0.5,
      entities: {},
    };
  }

  /**
   * Route based on analyzed intent
   */
  private routeByIntent(
    intent: { category: string; confidence: number; entities: Record<string, string> },
    state: SwarmState
  ): RoutingDecision {
    switch (intent.category) {
      case "collecting_info":
      case "scheduling":
      case "general":
      case "question":
        return {
          targetAgent: "conversation",
          action: "handle_message",
          priority: 1,
          reason: `Intent: ${intent.category} (confidence: ${intent.confidence})`,
          input: { intent },
        };

      default:
        return {
          targetAgent: "conversation",
          action: "handle_message",
          priority: 1,
          reason: "Default routing to conversation agent",
        };
    }
  }

  /**
   * Execute the selected agent
   */
  private async executeAgent(
    routing: RoutingDecision,
    context: AgentContext,
    message: string
  ): Promise<AgentResult> {
    const agent = this.agents.get(routing.targetAgent);

    if (!agent) {
      // If agent not available, try conversation agent as fallback
      const fallbackAgent = this.agents.get("conversation");
      if (fallbackAgent) {
        context.logger.warn(
          { targetAgent: routing.targetAgent },
          "Target agent not available, using conversation agent"
        );
        return fallbackAgent.process(context, message);
      }

      throw new Error(`Agent not available: ${routing.targetAgent}`);
    }

    return agent.process(context, message);
  }

  /**
   * Load or create swarm state from Redis
   */
  private async loadOrCreateState(
    correlationId: string,
    phoneNumber: string,
    channel: Channel
  ): Promise<SwarmState> {
    const redis = getRedisConnection();
    const key = `swarm:state:${phoneNumber}`;

    if (redis) {
      try {
        const existing = await redis.get(key);
        if (existing) {
          const state = JSON.parse(existing) as SwarmState;
          state.lastActivityAt = new Date();
          return state;
        }
      } catch (error) {
        this.logger.warn({ error: (error as Error).message }, "Failed to load state from Redis");
      }
    }

    // Create new state
    return {
      correlationId,
      phoneNumber,
      channel,
      taskQueue: [],
      completedTasks: [],
      conversationTurns: 0,
      lastActivityAt: new Date(),
    };
  }

  /**
   * Update and persist swarm state
   */
  private async updateState(
    state: SwarmState,
    routing: RoutingDecision,
    result: AgentResult
  ): Promise<void> {
    const redis = getRedisConnection();
    const key = `swarm:state:${state.phoneNumber}`;

    // Update state
    state.currentAgent = result.nextAgent || routing.targetAgent;
    state.conversationTurns += 1;
    state.lastActivityAt = new Date();

    // Add to completed tasks
    const task: AgentTask = {
      id: `task-${Date.now()}`,
      correlationId: state.correlationId,
      agentType: routing.targetAgent,
      action: routing.action,
      input: { data: routing.input },
      priority: routing.priority,
      createdAt: new Date(),
      status: result.success ? "completed" : "failed",
      result,
    };
    state.completedTasks.push(task);

    // Keep only last 20 completed tasks
    if (state.completedTasks.length > 20) {
      state.completedTasks = state.completedTasks.slice(-20);
    }

    if (redis) {
      try {
        await redis.setex(key, this.config.stateExpirySecs, JSON.stringify(state));
      } catch (error) {
        this.logger.warn({ error: (error as Error).message }, "Failed to save state to Redis");
      }
    }
  }

  /**
   * Create a fallback result when AI fails
   */
  private fallbackResult(errorMessage: string): AgentResult {
    return {
      success: false,
      agentType: "orchestrator",
      response: undefined,
      data: { fallback: true, error: errorMessage },
      error: errorMessage,
    };
  }

  /**
   * Request background research for a contact
   */
  async requestResearch(
    contactId: string,
    phoneNumber: string,
    linkedinUrl?: string,
    companyName?: string
  ): Promise<void> {
    const researchAgent = this.agents.get("research");
    if (!researchAgent) {
      this.logger.warn("Research agent not available");
      return;
    }

    // This would normally queue a job, but for now we log the request
    this.logger.info(
      { contactId, phoneNumber, linkedinUrl, companyName },
      "Research requested"
    );
  }

  /**
   * Request lead qualification for a contact
   */
  async requestQualification(contactId: string, phoneNumber: string): Promise<void> {
    const qualificationAgent = this.agents.get("qualification");
    if (!qualificationAgent) {
      this.logger.warn("Qualification agent not available");
      return;
    }

    this.logger.info({ contactId, phoneNumber }, "Qualification requested");
  }

  /**
   * Request CRM sync for a contact
   */
  async requestCrmSync(contactId: string, phoneNumber: string): Promise<void> {
    const crmAgent = this.agents.get("crm");
    if (!crmAgent) {
      this.logger.warn("CRM agent not available");
      return;
    }

    this.logger.info({ contactId, phoneNumber }, "CRM sync requested");
  }

  /**
   * Get agent by type
   */
  getAgent(type: AgentType): BaseAgent | undefined {
    return this.agents.get(type);
  }

  /**
   * Get all available agents
   */
  getAvailableAgents(): AgentType[] {
    return Array.from(this.agents.keys());
  }

  /**
   * Check if swarm is operational
   */
  isOperational(): boolean {
    // At minimum, we need the conversation agent
    return this.agents.has("conversation");
  }
}

// Singleton orchestrator instance
let instance: SwarmOrchestrator | null = null;

/**
 * Get or create the orchestrator instance
 */
export function getOrchestrator(
  eventConfig?: NetworkingEventConfig,
  orchestratorConfig?: OrchestratorConfig
): SwarmOrchestrator {
  if (!instance) {
    if (!eventConfig) {
      throw new Error("Event config required to initialize orchestrator");
    }
    instance = new SwarmOrchestrator(eventConfig, orchestratorConfig);
  }
  return instance;
}

/**
 * Reset the orchestrator (for testing)
 */
export function resetOrchestrator(): void {
  instance = null;
}
