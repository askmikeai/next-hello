import type { Logger } from "pino";
import { createLogger, logEvent, logError } from "./logger.js";
import { checkRedisHealth } from "../queue/client.js";
import { getAllCircuitBreakerStates } from "../resilience/circuit-breaker.js";
import type { HealthCheckResult, HealthStatus } from "../swarm/types.js";
import type { NetworkingEventConfig } from "../config/types.js";

const logger = createLogger({ component: "health" });

/**
 * Start time for uptime calculation
 */
const startTime = Date.now();

/**
 * Get application version
 */
function getVersion(): string {
  return process.env.npm_package_version || "1.0.0";
}

/**
 * Calculate uptime in seconds
 */
function getUptime(): number {
  return Math.floor((Date.now() - startTime) / 1000);
}

/**
 * Check Supabase database health
 */
async function checkSupabaseHealth(config?: NetworkingEventConfig): Promise<HealthCheckResult> {
  const name = "supabase";
  const startMs = Date.now();

  try {
    const url = config?.supabase?.url || process.env.SUPABASE_URL;
    const key = config?.supabase?.serviceRoleKey || process.env.SUPABASE_KEY;

    if (!url || !key) {
      return {
        name,
        status: "degraded",
        message: "Supabase not configured",
        lastChecked: new Date(),
      };
    }

    // Simple health check - just verify we can construct a URL
    const healthUrl = new URL("/rest/v1/", url);
    const response = await fetch(healthUrl.toString(), {
      method: "HEAD",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    });

    const latencyMs = Date.now() - startMs;

    if (response.ok || response.status === 400) {
      // 400 is expected for HEAD without table name
      return {
        name,
        status: "healthy",
        latencyMs,
        lastChecked: new Date(),
      };
    }

    return {
      name,
      status: "unhealthy",
      latencyMs,
      message: `HTTP ${response.status}`,
      lastChecked: new Date(),
    };
  } catch (error) {
    return {
      name,
      status: "unhealthy",
      latencyMs: Date.now() - startMs,
      message: error instanceof Error ? error.message : "Unknown error",
      lastChecked: new Date(),
    };
  }
}

/**
 * Check Redis health
 */
async function checkRedis(): Promise<HealthCheckResult> {
  const name = "redis";
  const result = await checkRedisHealth();

  return {
    name,
    status: result.connected ? "healthy" : "unhealthy",
    latencyMs: result.latencyMs,
    message: result.error,
    lastChecked: new Date(),
  };
}

/**
 * Check Claude API health
 */
async function checkClaudeHealth(): Promise<HealthCheckResult> {
  const name = "claude";
  const startMs = Date.now();

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return {
        name,
        status: "degraded",
        message: "API key not configured",
        lastChecked: new Date(),
      };
    }

    // Check by hitting the messages endpoint with minimal request
    // Note: We don't actually send a message, just verify the endpoint is reachable
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 1,
        messages: [{ role: "user", content: "health" }],
      }),
    });

    const latencyMs = Date.now() - startMs;

    // 200 = success (but we'll get charged for a token)
    // 401 = bad key
    // 429 = rate limited (but API is healthy)
    // 500+ = API issues
    if (response.ok || response.status === 429) {
      return {
        name,
        status: "healthy",
        latencyMs,
        lastChecked: new Date(),
      };
    }

    if (response.status === 401) {
      return {
        name,
        status: "unhealthy",
        latencyMs,
        message: "Invalid API key",
        lastChecked: new Date(),
      };
    }

    return {
      name,
      status: "unhealthy",
      latencyMs,
      message: `HTTP ${response.status}`,
      lastChecked: new Date(),
    };
  } catch (error) {
    return {
      name,
      status: "unhealthy",
      latencyMs: Date.now() - startMs,
      message: error instanceof Error ? error.message : "Unknown error",
      lastChecked: new Date(),
    };
  }
}

/**
 * Check HeyGen API health
 */
async function checkHeyGenHealth(config?: NetworkingEventConfig): Promise<HealthCheckResult> {
  const name = "heygen";
  const startMs = Date.now();

  try {
    const apiKey = config?.heygen?.apiKey || process.env.HEYGEN_API_KEY;

    if (!apiKey) {
      return {
        name,
        status: "degraded",
        message: "API key not configured",
        lastChecked: new Date(),
      };
    }

    const response = await fetch("https://api.heygen.com/v1/video_status.list", {
      headers: {
        "X-Api-Key": apiKey,
      },
    });

    const latencyMs = Date.now() - startMs;

    if (response.ok) {
      return {
        name,
        status: "healthy",
        latencyMs,
        lastChecked: new Date(),
      };
    }

    return {
      name,
      status: "unhealthy",
      latencyMs,
      message: `HTTP ${response.status}`,
      lastChecked: new Date(),
    };
  } catch (error) {
    return {
      name,
      status: "unhealthy",
      latencyMs: Date.now() - startMs,
      message: error instanceof Error ? error.message : "Unknown error",
      lastChecked: new Date(),
    };
  }
}

/**
 * Check HubSpot API health
 */
async function checkHubSpotHealth(config?: NetworkingEventConfig): Promise<HealthCheckResult> {
  const name = "hubspot";
  const startMs = Date.now();

  try {
    const apiKey = config?.crm?.apiKey || process.env.HUBSPOT_API_KEY;

    if (!apiKey) {
      return {
        name,
        status: "degraded",
        message: "API key not configured",
        lastChecked: new Date(),
      };
    }

    const response = await fetch("https://api.hubapi.com/crm/v3/objects/contacts?limit=1", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const latencyMs = Date.now() - startMs;

    if (response.ok) {
      return {
        name,
        status: "healthy",
        latencyMs,
        lastChecked: new Date(),
      };
    }

    return {
      name,
      status: "unhealthy",
      latencyMs,
      message: `HTTP ${response.status}`,
      lastChecked: new Date(),
    };
  } catch (error) {
    return {
      name,
      status: "unhealthy",
      latencyMs: Date.now() - startMs,
      message: error instanceof Error ? error.message : "Unknown error",
      lastChecked: new Date(),
    };
  }
}

/**
 * Check circuit breakers health
 */
function checkCircuitBreakers(): HealthCheckResult {
  const name = "circuit_breakers";
  const states = getAllCircuitBreakerStates();

  const openBreakers = states.filter((s) => s.state === "open");
  const halfOpenBreakers = states.filter((s) => s.state === "half-open");

  if (openBreakers.length > 0) {
    return {
      name,
      status: "degraded",
      message: `Open: ${openBreakers.map((b) => b.name).join(", ")}`,
      lastChecked: new Date(),
    };
  }

  if (halfOpenBreakers.length > 0) {
    return {
      name,
      status: "healthy",
      message: `Half-open: ${halfOpenBreakers.map((b) => b.name).join(", ")}`,
      lastChecked: new Date(),
    };
  }

  return {
    name,
    status: "healthy",
    message: `All ${states.length} breakers closed`,
    lastChecked: new Date(),
  };
}

/**
 * Run all health checks
 */
export async function runHealthChecks(config?: NetworkingEventConfig): Promise<HealthStatus> {
  const checkPromises: Promise<HealthCheckResult>[] = [
    checkRedis(),
    checkSupabaseHealth(config),
    checkCircuitBreakers() as unknown as Promise<HealthCheckResult>,
  ];

  // Add optional checks if configured
  if (process.env.ANTHROPIC_API_KEY) {
    checkPromises.push(checkClaudeHealth());
  }

  if (config?.heygen?.apiKey || process.env.HEYGEN_API_KEY) {
    checkPromises.push(checkHeyGenHealth(config));
  }

  if (config?.crm?.apiKey || process.env.HUBSPOT_API_KEY) {
    checkPromises.push(checkHubSpotHealth(config));
  }

  const checks = await Promise.all(checkPromises);

  // Determine overall status
  const hasUnhealthy = checks.some((c) => c.status === "unhealthy");
  const hasDegraded = checks.some((c) => c.status === "degraded");

  let overallStatus: "healthy" | "unhealthy" | "degraded";
  if (hasUnhealthy) {
    overallStatus = "unhealthy";
  } else if (hasDegraded) {
    overallStatus = "degraded";
  } else {
    overallStatus = "healthy";
  }

  const status: HealthStatus = {
    status: overallStatus,
    version: getVersion(),
    uptime: getUptime(),
    checks,
  };

  logEvent(logger, "health_check_complete", {
    status: overallStatus,
    checkCount: checks.length,
    unhealthy: checks.filter((c) => c.status === "unhealthy").map((c) => c.name),
    degraded: checks.filter((c) => c.status === "degraded").map((c) => c.name),
  });

  return status;
}

/**
 * Simple liveness check (is the process running)
 */
export function livenessCheck(): { alive: boolean } {
  return { alive: true };
}

/**
 * Simple readiness check (is the service ready to accept traffic)
 */
export async function readinessCheck(config?: NetworkingEventConfig): Promise<{
  ready: boolean;
  reason?: string;
}> {
  try {
    // Check critical dependencies
    const redisHealth = await checkRedis();
    const supabaseHealth = await checkSupabaseHealth(config);

    const criticalHealthy =
      redisHealth.status !== "unhealthy" && supabaseHealth.status !== "unhealthy";

    if (!criticalHealthy) {
      const unhealthy: string[] = [];
      if (redisHealth.status === "unhealthy") unhealthy.push("redis");
      if (supabaseHealth.status === "unhealthy") unhealthy.push("supabase");

      return {
        ready: false,
        reason: `Critical dependencies unhealthy: ${unhealthy.join(", ")}`,
      };
    }

    return { ready: true };
  } catch (error) {
    return {
      ready: false,
      reason: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
