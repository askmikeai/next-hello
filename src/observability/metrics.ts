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

/**
 * Counter for LLM cost in USD (stored as micro-dollars for precision)
 */
export const llmCostTotal = new Counter({
  name: "nexthello_llm_cost_usd_total",
  help: "Total cost of LLM API calls in USD",
  labelNames: ["model"],
  registers: [metricsRegistry],
});

/**
 * Anthropic model pricing per million tokens (as of 2025)
 * https://www.anthropic.com/pricing
 */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Claude 4 models
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-opus-4-20250514": { input: 15.0, output: 75.0 },
  // Claude 3.5 models
  "claude-3-5-sonnet-20241022": { input: 3.0, output: 15.0 },
  "claude-3-5-sonnet-20240620": { input: 3.0, output: 15.0 },
  "claude-3-5-haiku-20241022": { input: 0.80, output: 4.0 },
  // Claude 3 models
  "claude-3-opus-20240229": { input: 15.0, output: 75.0 },
  "claude-3-sonnet-20240229": { input: 3.0, output: 15.0 },
  "claude-3-haiku-20240307": { input: 0.25, output: 1.25 },
};

/**
 * Calculate cost for a model based on token usage
 * Returns cost in USD
 */
export function calculateLLMCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    // Default to Sonnet pricing if model not found
    return (inputTokens * 3.0 + outputTokens * 15.0) / 1_000_000;
  }
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

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
// Database Metrics
// ============================================================================

/**
 * Counter for database queries
 */
export const dbQueriesTotal = new Counter({
  name: "nexthello_db_queries_total",
  help: "Total number of database queries",
  labelNames: ["operation", "table", "status"],
  registers: [metricsRegistry],
});

/**
 * Histogram for database query duration
 */
export const dbQueryDuration = new Histogram({
  name: "nexthello_db_query_duration_seconds",
  help: "Duration of database queries in seconds",
  labelNames: ["operation", "table"],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [metricsRegistry],
});

/**
 * Gauge for database connection pool
 */
export const dbConnectionPool = new Gauge({
  name: "nexthello_db_connection_pool",
  help: "Database connection pool status",
  labelNames: ["state"], // active, idle, waiting
  registers: [metricsRegistry],
});

// ============================================================================
// Redis Metrics
// ============================================================================

/**
 * Counter for Redis operations
 */
export const redisOpsTotal = new Counter({
  name: "nexthello_redis_ops_total",
  help: "Total number of Redis operations",
  labelNames: ["operation", "status"],
  registers: [metricsRegistry],
});

/**
 * Histogram for Redis operation duration
 */
export const redisOpDuration = new Histogram({
  name: "nexthello_redis_op_duration_seconds",
  help: "Duration of Redis operations in seconds",
  labelNames: ["operation"],
  buckets: [0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5],
  registers: [metricsRegistry],
});

/**
 * Gauge for Redis connection state
 */
export const redisConnectionState = new Gauge({
  name: "nexthello_redis_connected",
  help: "Redis connection state (1=connected, 0=disconnected)",
  registers: [metricsRegistry],
});

// ============================================================================
// HTTP Metrics
// ============================================================================

/**
 * Counter for HTTP requests
 */
export const httpRequestsTotal = new Counter({
  name: "nexthello_http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "path", "status"],
  registers: [metricsRegistry],
});

/**
 * Histogram for HTTP request duration
 */
export const httpRequestDuration = new Histogram({
  name: "nexthello_http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "path"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
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
    // Record cost
    const cost = calculateLLMCost(model, inputTokens, outputTokens);
    llmCostTotal.inc({ model }, cost);
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
 * Record a database query
 */
export function recordDbQuery(
  operation: string,
  table: string,
  status: "success" | "failure",
  durationMs: number
): void {
  dbQueriesTotal.inc({ operation, table, status });
  dbQueryDuration.observe({ operation, table }, durationMs / 1000);
}

/**
 * Record a Redis operation
 */
export function recordRedisOp(
  operation: string,
  status: "success" | "failure",
  durationMs: number
): void {
  redisOpsTotal.inc({ operation, status });
  redisOpDuration.observe({ operation }, durationMs / 1000);
}

/**
 * Record an HTTP request
 */
export function recordHttpRequest(
  method: string,
  path: string,
  status: number,
  durationMs: number
): void {
  httpRequestsTotal.inc({ method, path, status: String(status) });
  httpRequestDuration.observe({ method, path }, durationMs / 1000);
}

/**
 * Timer helper for measuring duration
 */
export function startTimer(): () => number {
  const start = process.hrtime.bigint();
  return () => {
    const end = process.hrtime.bigint();
    return Number(end - start) / 1_000_000; // Convert to milliseconds
  };
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
