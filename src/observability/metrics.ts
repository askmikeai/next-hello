import {
  Counter,
  Histogram,
  Gauge,
  Registry,
  collectDefaultMetrics,
} from "prom-client";

/**
 * Prometheus metrics registry
 */
export const metricsRegistry = new Registry();

// Collect default Node.js metrics
collectDefaultMetrics({ register: metricsRegistry });

// ============================================================================
// Agent Metrics
// ============================================================================

/**
 * Counter for agent executions
 */
export const agentExecutionsTotal = new Counter({
  name: "nexthello_agent_executions_total",
  help: "Total number of agent executions",
  labelNames: ["agent_type", "action", "status"],
  registers: [metricsRegistry],
});

/**
 * Histogram for agent execution duration
 */
export const agentExecutionDuration = new Histogram({
  name: "nexthello_agent_execution_duration_seconds",
  help: "Duration of agent executions in seconds",
  labelNames: ["agent_type", "action"],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [metricsRegistry],
});

/**
 * Gauge for currently active agents
 */
export const activeAgents = new Gauge({
  name: "nexthello_active_agents",
  help: "Number of currently active agent executions",
  labelNames: ["agent_type"],
  registers: [metricsRegistry],
});

// ============================================================================
// LLM Metrics
// ============================================================================

/**
 * Counter for LLM API calls
 */
export const llmCallsTotal = new Counter({
  name: "nexthello_llm_calls_total",
  help: "Total number of LLM API calls",
  labelNames: ["model", "status"],
  registers: [metricsRegistry],
});

/**
 * Histogram for LLM call duration
 */
export const llmCallDuration = new Histogram({
  name: "nexthello_llm_call_duration_seconds",
  help: "Duration of LLM API calls in seconds",
  labelNames: ["model"],
  buckets: [0.5, 1, 2, 5, 10, 20, 30, 60],
  registers: [metricsRegistry],
});

/**
 * Counter for tokens used
 */
export const tokensUsedTotal = new Counter({
  name: "nexthello_tokens_used_total",
  help: "Total number of tokens used",
  labelNames: ["model", "type"], // type: input/output
  registers: [metricsRegistry],
});

// ============================================================================
// Queue Metrics
// ============================================================================

/**
 * Gauge for queue depth (waiting jobs)
 */
export const queueDepth = new Gauge({
  name: "nexthello_queue_depth",
  help: "Number of jobs waiting in queue",
  labelNames: ["queue"],
  registers: [metricsRegistry],
});

/**
 * Gauge for active jobs
 */
export const queueActiveJobs = new Gauge({
  name: "nexthello_queue_active_jobs",
  help: "Number of jobs currently being processed",
  labelNames: ["queue"],
  registers: [metricsRegistry],
});

/**
 * Counter for jobs processed
 */
export const jobsProcessedTotal = new Counter({
  name: "nexthello_jobs_processed_total",
  help: "Total number of jobs processed",
  labelNames: ["queue", "status"],
  registers: [metricsRegistry],
});

/**
 * Histogram for job processing duration
 */
export const jobProcessingDuration = new Histogram({
  name: "nexthello_job_processing_duration_seconds",
  help: "Duration of job processing in seconds",
  labelNames: ["queue"],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120],
  registers: [metricsRegistry],
});

// ============================================================================
// Message Metrics
// ============================================================================

/**
 * Counter for messages received
 */
export const messagesReceivedTotal = new Counter({
  name: "nexthello_messages_received_total",
  help: "Total number of messages received",
  labelNames: ["channel"],
  registers: [metricsRegistry],
});

/**
 * Counter for messages sent
 */
export const messagesSentTotal = new Counter({
  name: "nexthello_messages_sent_total",
  help: "Total number of messages sent",
  labelNames: ["channel", "agent_type"],
  registers: [metricsRegistry],
});

/**
 * Histogram for message processing time (end-to-end)
 */
export const messageProcessingDuration = new Histogram({
  name: "nexthello_message_processing_duration_seconds",
  help: "End-to-end message processing duration in seconds",
  labelNames: ["channel"],
  buckets: [0.5, 1, 2, 5, 10, 20, 30, 60],
  registers: [metricsRegistry],
});

// ============================================================================
// Contact Metrics
// ============================================================================

/**
 * Gauge for contacts by status
 */
export const contactsByStatus = new Gauge({
  name: "nexthello_contacts_by_status",
  help: "Number of contacts by status",
  labelNames: ["status"],
  registers: [metricsRegistry],
});

/**
 * Gauge for contacts by qualification tier
 */
export const contactsByQualification = new Gauge({
  name: "nexthello_contacts_by_qualification",
  help: "Number of contacts by qualification tier",
  labelNames: ["tier"],
  registers: [metricsRegistry],
});

/**
 * Counter for contacts created
 */
export const contactsCreatedTotal = new Counter({
  name: "nexthello_contacts_created_total",
  help: "Total number of contacts created",
  labelNames: ["channel"],
  registers: [metricsRegistry],
});

// ============================================================================
// Integration Metrics
// ============================================================================

/**
 * Counter for integration calls
 */
export const integrationCallsTotal = new Counter({
  name: "nexthello_integration_calls_total",
  help: "Total number of integration API calls",
  labelNames: ["integration", "operation", "status"],
  registers: [metricsRegistry],
});

/**
 * Histogram for integration call duration
 */
export const integrationCallDuration = new Histogram({
  name: "nexthello_integration_call_duration_seconds",
  help: "Duration of integration API calls in seconds",
  labelNames: ["integration", "operation"],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [metricsRegistry],
});

/**
 * Gauge for circuit breaker state
 */
export const circuitBreakerState = new Gauge({
  name: "nexthello_circuit_breaker_state",
  help: "Circuit breaker state (0=closed, 1=half-open, 2=open)",
  labelNames: ["breaker"],
  registers: [metricsRegistry],
});

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Record an agent execution
 */
export function recordAgentExecution(
  agentType: string,
  action: string,
  status: "success" | "failure",
  durationMs: number
): void {
  agentExecutionsTotal.inc({ agent_type: agentType, action, status });
  agentExecutionDuration.observe({ agent_type: agentType, action }, durationMs / 1000);
}

/**
 * Record an LLM call
 */
export function recordLLMCall(
  model: string,
  status: "success" | "failure",
  durationMs: number,
  inputTokens: number,
  outputTokens: number
): void {
  llmCallsTotal.inc({ model, status });
  llmCallDuration.observe({ model }, durationMs / 1000);
  if (status === "success") {
    tokensUsedTotal.inc({ model, type: "input" }, inputTokens);
    tokensUsedTotal.inc({ model, type: "output" }, outputTokens);
  }
}

/**
 * Record a job processed
 */
export function recordJobProcessed(
  queue: string,
  status: "success" | "failure",
  durationMs: number
): void {
  jobsProcessedTotal.inc({ queue, status });
  jobProcessingDuration.observe({ queue }, durationMs / 1000);
}

/**
 * Record an integration call
 */
export function recordIntegrationCall(
  integration: string,
  operation: string,
  status: "success" | "failure",
  durationMs: number
): void {
  integrationCallsTotal.inc({ integration, operation, status });
  integrationCallDuration.observe({ integration, operation }, durationMs / 1000);
}

/**
 * Update circuit breaker state metric
 */
export function updateCircuitBreakerMetric(
  breaker: string,
  state: "closed" | "half-open" | "open"
): void {
  const stateValue = state === "closed" ? 0 : state === "half-open" ? 1 : 2;
  circuitBreakerState.set({ breaker }, stateValue);
}

/**
 * Get metrics in Prometheus format
 */
export async function getMetrics(): Promise<string> {
  return metricsRegistry.metrics();
}

/**
 * Get metrics content type
 */
export function getMetricsContentType(): string {
  return metricsRegistry.contentType;
}

/**
 * Reset all metrics (for testing)
 */
export async function resetMetrics(): Promise<void> {
  metricsRegistry.resetMetrics();
}
