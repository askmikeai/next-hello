import type { Logger } from "pino";
import { createLogger } from "../observability/logger.js";
import type { RetryConfig } from "../swarm/types.js";

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
};

/**
 * Error that indicates the operation should not be retried
 */
export class NonRetryableError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = "NonRetryableError";
  }
}

/**
 * Error with retry information
 */
export class RetryExhaustedError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastError: Error
  ) {
    super(message);
    this.name = "RetryExhaustedError";
  }
}

/**
 * Calculate delay with exponential backoff and jitter
 */
export function calculateDelay(
  attempt: number,
  config: RetryConfig
): number {
  // Exponential backoff
  const exponentialDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);

  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

  // Add jitter (random factor to prevent thundering herd)
  const jitter = cappedDelay * config.jitterFactor * (Math.random() * 2 - 1);

  return Math.max(0, cappedDelay + jitter);
}

/**
 * Sleep for a given duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  // Non-retryable error explicitly marked
  if (error instanceof NonRetryableError) {
    return false;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Non-retryable conditions
    const nonRetryablePatterns = [
      "invalid api key",
      "authentication failed",
      "unauthorized",
      "forbidden",
      "not found",
      "bad request",
      "invalid input",
      "validation error",
    ];

    if (nonRetryablePatterns.some((pattern) => message.includes(pattern))) {
      return false;
    }

    // Retryable conditions (network issues, rate limits, etc.)
    const retryablePatterns = [
      "timeout",
      "econnreset",
      "econnrefused",
      "etimedout",
      "socket hang up",
      "rate limit",
      "too many requests",
      "service unavailable",
      "bad gateway",
      "gateway timeout",
      "overloaded",
      "internal server error",
    ];

    if (retryablePatterns.some((pattern) => message.includes(pattern))) {
      return true;
    }
  }

  // Default: retry
  return true;
}

/**
 * Retry options for a single operation
 */
export interface RetryOptions extends Partial<RetryConfig> {
  /** Operation name for logging */
  operationName?: string;
  /** Logger instance */
  logger?: Logger;
  /** Custom retry predicate */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Callback on each retry */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/**
 * Execute an async operation with retry logic
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const config: RetryConfig = {
    ...DEFAULT_RETRY_CONFIG,
    ...options,
  };

  const logger = options.logger || createLogger({ component: "retry" });
  const operationName = options.operationName || "operation";
  const shouldRetry = options.shouldRetry || ((error) => isRetryableError(error));

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      if (attempt >= config.maxAttempts || !shouldRetry(error, attempt)) {
        logger.error(
          {
            operationName,
            attempt,
            maxAttempts: config.maxAttempts,
            error: lastError.message,
          },
          `${operationName} failed after ${attempt} attempt(s)`
        );

        if (!shouldRetry(error, attempt)) {
          throw new NonRetryableError(
            `${operationName} failed with non-retryable error: ${lastError.message}`,
            lastError
          );
        }

        throw new RetryExhaustedError(
          `${operationName} failed after ${config.maxAttempts} attempts`,
          attempt,
          lastError
        );
      }

      // Calculate delay
      const delayMs = calculateDelay(attempt, config);

      logger.warn(
        {
          operationName,
          attempt,
          maxAttempts: config.maxAttempts,
          delayMs,
          error: lastError.message,
        },
        `${operationName} failed, retrying in ${delayMs}ms`
      );

      // Call retry callback if provided
      options.onRetry?.(error, attempt, delayMs);

      // Wait before retrying
      await sleep(delayMs);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw new RetryExhaustedError(
    `${operationName} failed after ${config.maxAttempts} attempts`,
    config.maxAttempts,
    lastError || new Error("Unknown error")
  );
}

/**
 * Create a retry wrapper with pre-configured options
 */
export function createRetryWrapper(defaultOptions: RetryOptions) {
  return function <T>(
    operation: () => Promise<T>,
    options?: RetryOptions
  ): Promise<T> {
    return withRetry(operation, { ...defaultOptions, ...options });
  };
}

/**
 * Decorator-style retry wrapper for class methods
 */
export function retryable(options: RetryOptions = {}) {
  return function <T extends (...args: unknown[]) => Promise<unknown>>(
    _target: unknown,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<T>
  ): TypedPropertyDescriptor<T> {
    const originalMethod = descriptor.value;
    if (!originalMethod) return descriptor;

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      return withRetry(
        () => originalMethod.apply(this, args),
        { operationName: propertyKey, ...options }
      );
    } as T;

    return descriptor;
  };
}

/**
 * Retry with timeout
 */
export async function withRetryAndTimeout<T>(
  operation: () => Promise<T>,
  options: RetryOptions & { timeoutMs?: number } = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs || 30000;

  const withTimeout = async (): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      operation()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  };

  return withRetry(withTimeout, options);
}
