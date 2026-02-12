import pino, { type Logger, type LoggerOptions } from "pino";
import { randomUUID } from "crypto";

/**
 * Logging levels available in the application
 */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/**
 * Context that can be attached to log entries
 */
export interface LogContext {
  correlationId?: string;
  contactId?: string;
  phoneNumber?: string;
  agentType?: string;
  agentId?: string;
  jobId?: string;
  channel?: string;
  [key: string]: unknown;
}

/**
 * Creates a correlation ID for request tracing
 */
export function createCorrelationId(): string {
  return randomUUID();
}

/**
 * Redacts sensitive information from log entries
 */
const redactPaths = [
  "password",
  "apiKey",
  "api_key",
  "token",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "secret",
  "authorization",
  "cookie",
];

/**
 * Default logger configuration
 */
function createLoggerConfig(): LoggerOptions {
  const isDevelopment = process.env.NODE_ENV !== "production";
  const level = (process.env.LOG_LEVEL as LogLevel) || (isDevelopment ? "debug" : "info");

  return {
    level,
    name: "nexthello",
    redact: {
      paths: redactPaths,
      censor: "[REDACTED]",
    },
    formatters: {
      level: (label) => ({ level: label }),
      bindings: (bindings) => ({
        pid: bindings.pid,
        hostname: bindings.hostname,
        service: "nexthello",
        version: process.env.npm_package_version || "1.0.0",
      }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Use pino-pretty in development for readable output
    transport: isDevelopment
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss.l",
            ignore: "pid,hostname",
          },
        }
      : undefined,
  };
}

/**
 * Root logger instance
 */
const rootLogger: Logger = pino(createLoggerConfig());

/**
 * Creates a child logger with additional context
 */
export function createLogger(context: LogContext): Logger {
  return rootLogger.child(context);
}

/**
 * Creates a logger for a specific agent
 */
export function createAgentLogger(agentType: string, agentId?: string): Logger {
  return rootLogger.child({
    agentType,
    agentId: agentId || createCorrelationId(),
  });
}

/**
 * Creates a logger for a specific request/message
 */
export function createRequestLogger(correlationId?: string): Logger {
  return rootLogger.child({
    correlationId: correlationId || createCorrelationId(),
  });
}

/**
 * Creates a logger for queue workers
 */
export function createWorkerLogger(workerName: string, jobId?: string): Logger {
  return rootLogger.child({
    worker: workerName,
    jobId,
  });
}

/**
 * Log a structured event with standardized fields
 */
export function logEvent(
  logger: Logger,
  event: string,
  data?: Record<string, unknown>
): void {
  logger.info({ event, ...data });
}

/**
 * Log an error with standardized fields
 */
export function logError(
  logger: Logger,
  error: Error,
  message?: string,
  data?: Record<string, unknown>
): void {
  logger.error(
    {
      err: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      ...data,
    },
    message || error.message
  );
}

/**
 * Log LLM interaction with token counts
 */
export function logLLMInteraction(
  logger: Logger,
  data: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    toolCalls?: string[];
    success: boolean;
    error?: string;
  }
): void {
  logger.info(
    {
      event: "llm_interaction",
      llm: {
        model: data.model,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        totalTokens: data.inputTokens + data.outputTokens,
        durationMs: data.durationMs,
        toolCalls: data.toolCalls,
        success: data.success,
        error: data.error,
      },
    },
    `LLM ${data.success ? "completed" : "failed"} in ${data.durationMs}ms`
  );
}

/**
 * Log agent activity
 */
export function logAgentActivity(
  logger: Logger,
  data: {
    agentType: string;
    action: string;
    status: "started" | "completed" | "failed";
    durationMs?: number;
    contactId?: string;
    error?: string;
  }
): void {
  const level = data.status === "failed" ? "error" : "info";
  logger[level](
    {
      event: "agent_activity",
      agent: {
        type: data.agentType,
        action: data.action,
        status: data.status,
        durationMs: data.durationMs,
        contactId: data.contactId,
        error: data.error,
      },
    },
    `Agent ${data.agentType} ${data.action} ${data.status}`
  );
}

/**
 * Log queue job processing
 */
export function logQueueJob(
  logger: Logger,
  data: {
    queue: string;
    jobId: string;
    status: "started" | "completed" | "failed" | "retrying";
    attempt?: number;
    durationMs?: number;
    error?: string;
  }
): void {
  const level = data.status === "failed" ? "error" : "info";
  logger[level](
    {
      event: "queue_job",
      job: {
        queue: data.queue,
        jobId: data.jobId,
        status: data.status,
        attempt: data.attempt,
        durationMs: data.durationMs,
        error: data.error,
      },
    },
    `Job ${data.jobId} on ${data.queue} ${data.status}`
  );
}

// Export the root logger as default
export { rootLogger as logger };
export default rootLogger;
