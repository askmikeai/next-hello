import postgres, { Sql } from "postgres";
import { recordDbQuery, startTimer, dbConnectionPool } from "../observability/metrics.js";

/**
 * Database configuration
 */
export interface DatabaseConfig {
  /** Connection URL (takes precedence over individual options) */
  url?: string;
  /** PostgreSQL host */
  host?: string;
  /** PostgreSQL port */
  port?: number;
  /** Database name */
  database?: string;
  /** Username */
  username?: string;
  /** Password */
  password?: string;
  /** Maximum connections in pool */
  maxConnections?: number;
  /** Idle timeout in seconds */
  idleTimeout?: number;
  /** Enable SSL */
  ssl?: boolean | "require" | "prefer";
}

let sqlInstance: Sql | null = null;
let isConfigured = false;

/**
 * Parse DATABASE_URL or construct from individual env vars
 */
function getConnectionConfig(): DatabaseConfig | null {
  const url = process.env.DATABASE_URL;
  if (url) {
    return { url };
  }

  const host = process.env.POSTGRES_HOST;
  const port = process.env.POSTGRES_PORT ? parseInt(process.env.POSTGRES_PORT, 10) : undefined;
  const database = process.env.POSTGRES_DB;
  const username = process.env.POSTGRES_USER;
  const password = process.env.POSTGRES_PASSWORD;

  if (host && database && username) {
    return { host, port, database, username, password };
  }

  return null;
}

/**
 * Get or create PostgreSQL client singleton
 * Returns null if database is not configured (demo mode)
 */
export function getDatabase(config?: DatabaseConfig): Sql | null {
  if (sqlInstance) {
    return sqlInstance;
  }

  const effectiveConfig = config || getConnectionConfig();

  if (!effectiveConfig) {
    console.log("[database] PostgreSQL not configured, running in demo mode");
    return null;
  }

  try {
    if (effectiveConfig.url) {
      sqlInstance = postgres(effectiveConfig.url, {
        max: effectiveConfig.maxConnections || 10,
        idle_timeout: effectiveConfig.idleTimeout || 20,
        connect_timeout: 10,
      });
    } else {
      sqlInstance = postgres({
        host: effectiveConfig.host || "localhost",
        port: effectiveConfig.port || 5432,
        database: effectiveConfig.database || "nexthello",
        username: effectiveConfig.username || "nexthello",
        password: effectiveConfig.password,
        max: effectiveConfig.maxConnections || 10,
        idle_timeout: effectiveConfig.idleTimeout || 20,
        connect_timeout: 10,
        ssl: effectiveConfig.ssl,
      });
    }

    isConfigured = true;
    console.log("[database] PostgreSQL connection pool initialized");
    return sqlInstance;
  } catch (error) {
    console.error("[database] Failed to initialize PostgreSQL connection:", error);
    return null;
  }
}

/**
 * Check if database is configured and connected
 */
export function isDatabaseConfigured(): boolean {
  return isConfigured && sqlInstance !== null;
}

/**
 * Health check - verify database connectivity
 */
export async function checkDatabaseHealth(): Promise<{
  healthy: boolean;
  latencyMs?: number;
  error?: string;
}> {
  const sql = getDatabase();
  if (!sql) {
    return { healthy: false, error: "Database not configured" };
  }

  const start = Date.now();
  try {
    await sql`SELECT 1`;
    return { healthy: true, latencyMs: Date.now() - start };
  } catch (error) {
    return {
      healthy: false,
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Gracefully close the database connection
 */
export async function closeDatabase(): Promise<void> {
  if (sqlInstance) {
    await sqlInstance.end();
    sqlInstance = null;
    isConfigured = false;
    console.log("[database] PostgreSQL connection closed");
  }
}

/**
 * Reset database connection (for testing)
 */
export function resetDatabase(): void {
  if (sqlInstance) {
    sqlInstance.end({ timeout: 0 }).catch(() => {});
  }
  sqlInstance = null;
  isConfigured = false;
}

/**
 * Execute within a transaction
 * Use this for operations that need atomicity
 *
 * @example
 * await withTransaction(async (txSql) => {
 *   await txSql`INSERT INTO ...`;
 *   await txSql`UPDATE ...`;
 * });
 */
export async function withTransaction(
  fn: (sql: Sql) => Promise<void>
): Promise<void> {
  const sql = getDatabase();
  if (!sql) {
    throw new Error("Database not configured");
  }
  const endTimer = startTimer();
  try {
    await sql.begin(async (txSql) => {
      await fn(txSql as unknown as Sql);
    });
    recordDbQuery("transaction", "multi", "success", endTimer());
  } catch (error) {
    recordDbQuery("transaction", "multi", "failure", endTimer());
    throw error;
  }
}

/**
 * Execute a timed database query with metrics
 * @param operation - The type of operation (select, insert, update, delete)
 * @param table - The table being queried
 * @param queryFn - Function that executes the query
 * @returns Query result
 */
export async function timedQuery<T>(
  operation: string,
  table: string,
  queryFn: () => Promise<T>
): Promise<T> {
  const endTimer = startTimer();
  try {
    const result = await queryFn();
    recordDbQuery(operation, table, "success", endTimer());
    return result;
  } catch (error) {
    recordDbQuery(operation, table, "failure", endTimer());
    throw error;
  }
}

/**
 * Update connection pool metrics
 */
export function updatePoolMetrics(): void {
  // postgres.js doesn't expose pool stats directly,
  // but we can track configured max connections
  if (sqlInstance) {
    dbConnectionPool.set({ state: "max" }, 10); // Default max connections
  }
}
