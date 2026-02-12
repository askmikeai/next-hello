import {
  CircuitBreakerPolicy,
  ConsecutiveBreaker,
  ExponentialBackoff,
  handleAll,
  retry,
  wrap,
  type IPolicy,
} from "cockatiel";
import type { Logger } from "pino";
import { createLogger, logEvent, logError } from "../observability/logger.js";
import type { CircuitBreakerState } from "../swarm/types.js";

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Threshold of consecutive failures before opening */
  failureThreshold?: number;
  /** Time in ms before attempting to close a half-open circuit */
  halfOpenAfterMs?: number;
  /** Number of successes needed to close a half-open circuit */
  successThreshold?: number;
}

/**
 * Default circuit breaker configuration
 */
const DEFAULT_CONFIG: Required<CircuitBreakerConfig> = {
  failureThreshold: 5,
  halfOpenAfterMs: 30000, // 30 seconds
  successThreshold: 2,
};

/**
 * Circuit breaker states
 */
type CircuitState = "closed" | "open" | "half-open";

/**
 * CircuitBreaker - Protects against cascading failures
 *
 * Uses the circuit breaker pattern to:
 * - Track failures for external services
 * - "Open" the circuit when failures exceed threshold
 * - Reject requests while circuit is open
 * - Gradually test with "half-open" state
 * - Close circuit when service recovers
 */
export class CircuitBreaker {
  private name: string;
  private config: Required<CircuitBreakerConfig>;
  private policy: IPolicy;
  private breaker: ConsecutiveBreaker;
  private logger: Logger;
  private failures: number = 0;
  private successes: number = 0;
  private lastFailure?: Date;
  private lastSuccess?: Date;
  private state: CircuitState = "closed";

  constructor(name: string, config?: CircuitBreakerConfig) {
    this.name = name;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = createLogger({ component: "circuit-breaker", breaker: name });

    // Create the circuit breaker
    this.breaker = new ConsecutiveBreaker(this.config.failureThreshold);

    // Create circuit breaker policy
    const circuitBreakerPolicy = new CircuitBreakerPolicy(
      handleAll,
      {
        halfOpenAfter: this.config.halfOpenAfterMs,
        breaker: this.breaker,
      }
    );

    // Subscribe to state changes
    circuitBreakerPolicy.onStateChange((state) => {
      this.state = state as CircuitState;
      logEvent(this.logger, "circuit_state_changed", {
        breaker: this.name,
        state,
        failures: this.failures,
        successes: this.successes,
      });
    });

    circuitBreakerPolicy.onFailure((failure) => {
      this.failures++;
      this.lastFailure = new Date();
      logEvent(this.logger, "circuit_failure", {
        breaker: this.name,
        failures: this.failures,
        error: failure.reason?.message,
      });
    });

    circuitBreakerPolicy.onSuccess(() => {
      this.successes++;
      this.lastSuccess = new Date();
      if (this.state === "half-open") {
        logEvent(this.logger, "circuit_success_halfopen", {
          breaker: this.name,
          successes: this.successes,
        });
      }
    });

    // Create retry policy with exponential backoff
    const retryPolicy = retry(handleAll, {
      maxAttempts: 3,
      backoff: new ExponentialBackoff({
        initialDelay: 1000,
        maxDelay: 10000,
      }),
    });

    // Wrap retry inside circuit breaker
    this.policy = wrap(circuitBreakerPolicy, retryPolicy);

    logEvent(this.logger, "circuit_created", {
      breaker: this.name,
      config: this.config,
    });
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return this.policy.execute(fn);
  }

  /**
   * Check if the circuit is open (rejecting requests)
   */
  isOpen(): boolean {
    return this.state === "open";
  }

  /**
   * Check if the circuit is closed (allowing requests)
   */
  isClosed(): boolean {
    return this.state === "closed";
  }

  /**
   * Check if the circuit is half-open (testing recovery)
   */
  isHalfOpen(): boolean {
    return this.state === "half-open";
  }

  /**
   * Get the current state
   */
  getState(): CircuitBreakerState {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess,
      nextRetry:
        this.state === "open"
          ? new Date(
              (this.lastFailure?.getTime() || Date.now()) + this.config.halfOpenAfterMs
            )
          : undefined,
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.failures = 0;
    this.successes = 0;
    this.state = "closed";
    logEvent(this.logger, "circuit_reset", { breaker: this.name });
  }

  /**
   * Get the name of this circuit breaker
   */
  getName(): string {
    return this.name;
  }
}

// Registry of circuit breakers
const breakers: Map<string, CircuitBreaker> = new Map();

/**
 * Get or create a circuit breaker by name
 */
export function getCircuitBreaker(
  name: string,
  config?: CircuitBreakerConfig
): CircuitBreaker {
  if (!breakers.has(name)) {
    breakers.set(name, new CircuitBreaker(name, config));
  }
  return breakers.get(name)!;
}

/**
 * Get all circuit breaker states
 */
export function getAllCircuitBreakerStates(): CircuitBreakerState[] {
  return Array.from(breakers.values()).map((b) => b.getState());
}

/**
 * Reset all circuit breakers
 */
export function resetAllCircuitBreakers(): void {
  for (const breaker of breakers.values()) {
    breaker.reset();
  }
}

/**
 * Pre-configured circuit breakers for common integrations
 */
export const circuitBreakers = {
  /** Claude API circuit breaker */
  claude: () => getCircuitBreaker("claude", {
    failureThreshold: 3,
    halfOpenAfterMs: 60000, // 1 minute for LLM
  }),

  /** HeyGen API circuit breaker */
  heygen: () => getCircuitBreaker("heygen", {
    failureThreshold: 5,
    halfOpenAfterMs: 120000, // 2 minutes for video
  }),

  /** ProxyCurl/LinkedIn circuit breaker */
  proxycurl: () => getCircuitBreaker("proxycurl", {
    failureThreshold: 3,
    halfOpenAfterMs: 60000,
  }),

  /** HubSpot CRM circuit breaker */
  hubspot: () => getCircuitBreaker("hubspot", {
    failureThreshold: 5,
    halfOpenAfterMs: 30000,
  }),

  /** Supabase circuit breaker */
  supabase: () => getCircuitBreaker("supabase", {
    failureThreshold: 3,
    halfOpenAfterMs: 15000, // 15 seconds for DB
  }),

  /** Redis circuit breaker */
  redis: () => getCircuitBreaker("redis", {
    failureThreshold: 3,
    halfOpenAfterMs: 10000, // 10 seconds for cache
  }),
};

/**
 * Decorator for applying circuit breaker to class methods
 */
export function withCircuitBreaker(breakerName: string) {
  return function <T extends (...args: unknown[]) => Promise<unknown>>(
    _target: unknown,
    _propertyKey: string,
    descriptor: TypedPropertyDescriptor<T>
  ): TypedPropertyDescriptor<T> {
    const originalMethod = descriptor.value;
    if (!originalMethod) return descriptor;

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      const breaker = getCircuitBreaker(breakerName);
      return breaker.execute(() => originalMethod.apply(this, args));
    } as T;

    return descriptor;
  };
}
