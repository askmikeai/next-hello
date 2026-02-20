import { Queue, Worker, Job, QueueEvents, type ConnectionOptions } from "bullmq";
import { Redis, type Redis as RedisType } from "ioredis";
import { createLogger, logQueueJob, logEvent } from "../observability/logger.js";
import type { QueueName } from "../swarm/types.js";
import { recordRedisOp, startTimer, redisConnectionState } from "../observability/metrics.js";

const logger = createLogger({ component: "queue-client" });

// Track if Redis is available
let redisAvailable: boolean | null = null;

/**
 * Check if Redis is configured via environment variables
 */
export function isRedisConfigured(): boolean {
  return !!(process.env.REDIS_HOST || process.env.REDIS_URL);
}

/**
 * Redis connection configuration
 */
export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  tls?: boolean;
  maxRetriesPerRequest?: number | null;
}

/**
 * Default Redis configuration
 */
function getDefaultRedisConfig(): RedisConfig {
  return {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379", 10),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || "0", 10),
    tls: process.env.REDIS_TLS === "true",
    maxRetriesPerRequest: null, // Required for BullMQ
  };
}

/**
 * Convert RedisConfig to BullMQ ConnectionOptions
 */
function toConnectionOptions(config: RedisConfig): ConnectionOptions {
  return {
    host: config.host,
    port: config.port,
    password: config.password,
    db: config.db,
    maxRetriesPerRequest: config.maxRetriesPerRequest,
    enableReadyCheck: false,
  };
}

// Singleton Redis connection
let redisConnection: RedisType | null = null;

/**
 * Get or create the Redis connection
 * Returns null if Redis is explicitly disabled or known to be unavailable
 */
export function getRedisConnection(config?: RedisConfig): RedisType | null {
  // If we already know Redis is unavailable, return null quickly
  if (redisAvailable === false) {
    return null;
  }

  if (!redisConnection) {
    const redisConfig = config || getDefaultRedisConfig();
    const connection = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password,
      db: redisConfig.db,
      tls: redisConfig.tls ? {} : undefined,
      lazyConnect: true,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy: (times: number) => {
        if (times > 3) {
          redisAvailable = false;
          logger.warn("Redis unavailable after 3 retries, running without queues");
          return null; // Stop retrying
        }
        return Math.min(times * 200, 2000);
      },
    });

    connection.on("connect", () => {
      redisAvailable = true;
      redisConnectionState.set(1);
      logEvent(logger, "redis_connected", { host: redisConfig.host, port: redisConfig.port });
    });

    connection.on("error", (error: Error) => {
      redisConnectionState.set(0);
      logger.error({ error: error.message }, "Redis connection error");
    });

    connection.on("close", () => {
      redisConnectionState.set(0);
      logEvent(logger, "redis_disconnected");
    });

    redisConnection = connection;
  }

  return redisConnection;
}

/**
 * Queue configuration options
 */
export interface QueueOptions {
  defaultJobOptions?: {
    attempts?: number;
    backoff?: {
      type: "exponential" | "fixed";
      delay: number;
    };
    removeOnComplete?: boolean | number;
    removeOnFail?: boolean | number;
  };
}

/**
 * Default queue options for each queue type
 */
const queueDefaults: Record<QueueName, QueueOptions> = {
  "incoming-messages": {
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  },
  "outbound-messages": {
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 500,
      removeOnFail: 2000,
    },
  },
  "agent-tasks": {
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 500,
      removeOnFail: 2000,
    },
  },
  "research-jobs": {
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  },
  "video-generation": {
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "fixed", delay: 10000 },
      removeOnComplete: 50,
      removeOnFail: 200,
    },
  },
  "voice-generation": {
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "fixed", delay: 5000 },
      removeOnComplete: 50,
      removeOnFail: 200,
    },
  },
  "crm-sync": {
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 3000 },
      removeOnComplete: 200,
      removeOnFail: 1000,
    },
  },
  "lead-qualification": {
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  },
  "pdl-enrichment": {
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 6000 }, // 6s base delay for rate limit recovery
      removeOnComplete: 200,
      removeOnFail: 500,
    },
  },
  "luma-sync": {
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 10000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  },
};

// Queue instances cache
const queues: Map<QueueName, Queue> = new Map();
const queueEvents: Map<QueueName, QueueEvents> = new Map();

/**
 * Get or create a queue
 * Returns null if Redis is unavailable
 */
export function getQueue<T = unknown>(
  name: QueueName,
  options?: QueueOptions
): Queue<T> | null {
  // Don't create queues if Redis is known to be unavailable
  if (redisAvailable === false) {
    return null;
  }

  if (!queues.has(name)) {
    const connection = toConnectionOptions(getDefaultRedisConfig());
    const queueOptions = { ...queueDefaults[name], ...options };

    const queue = new Queue<T>(name, {
      connection,
      defaultJobOptions: queueOptions.defaultJobOptions,
    });

    queues.set(name, queue as Queue);
    logEvent(logger, "queue_created", { queueName: name });
  }

  return queues.get(name) as Queue<T>;
}

/**
 * Get queue events for monitoring
 * Returns null if Redis is unavailable
 */
export function getQueueEvents(name: QueueName): QueueEvents | null {
  if (redisAvailable === false) {
    return null;
  }

  if (!queueEvents.has(name)) {
    const connection = toConnectionOptions(getDefaultRedisConfig());
    const events = new QueueEvents(name, { connection });
    queueEvents.set(name, events);
  }

  return queueEvents.get(name)!;
}

/**
 * Worker processor function type
 */
export type JobProcessor<T, R = void> = (job: Job<T>) => Promise<R>;

/**
 * Worker configuration
 */
export interface WorkerOptions {
  concurrency?: number;
  limiter?: {
    max: number;
    duration: number;
  };
  lockDuration?: number;
}

/**
 * Create a worker for a queue
 * Returns null if Redis is unavailable
 */
export function createWorker<T, R = void>(
  queueName: QueueName,
  processor: JobProcessor<T, R>,
  options: WorkerOptions = {}
): Worker<T, R> | null {
  if (redisAvailable === false) {
    logger.warn({ queue: queueName }, "Cannot create worker - Redis unavailable");
    return null;
  }

  const connection = toConnectionOptions(getDefaultRedisConfig());
  const workerLogger = createLogger({ component: "worker", queue: queueName });

  const worker = new Worker<T, R>(
    queueName,
    async (job: Job<T>) => {
      const startTime = Date.now();

      logQueueJob(workerLogger, {
        queue: queueName,
        jobId: job.id || "unknown",
        status: "started",
        attempt: job.attemptsMade + 1,
      });

      try {
        const result = await processor(job);
        const durationMs = Date.now() - startTime;

        logQueueJob(workerLogger, {
          queue: queueName,
          jobId: job.id || "unknown",
          status: "completed",
          attempt: job.attemptsMade + 1,
          durationMs,
        });

        return result;
      } catch (error) {
        const durationMs = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : "Unknown error";

        logQueueJob(workerLogger, {
          queue: queueName,
          jobId: job.id || "unknown",
          status: job.attemptsMade + 1 < (job.opts.attempts || 1) ? "retrying" : "failed",
          attempt: job.attemptsMade + 1,
          durationMs,
          error: errorMessage,
        });

        throw error;
      }
    },
    {
      connection,
      concurrency: options.concurrency || 5,
      limiter: options.limiter,
      lockDuration: options.lockDuration || 30000,
    }
  );

  worker.on("error", (error) => {
    workerLogger.error({ error: error.message }, "Worker error");
  });

  logEvent(workerLogger, "worker_created", {
    queue: queueName,
    concurrency: options.concurrency || 5,
  });

  return worker;
}

/**
 * Add a job to a queue
 * Returns null if Redis/queues are unavailable
 */
export async function addJob<T>(
  queueName: QueueName,
  data: T,
  options?: {
    jobId?: string;
    priority?: number;
    delay?: number;
    attempts?: number;
  }
): Promise<Job<T> | null> {
  const queue = getQueue<T>(queueName);
  if (!queue) {
    logger.warn({ queue: queueName }, "Cannot add job - Redis unavailable");
    return null;
  }

  const jobOptions = {
    jobId: options?.jobId,
    priority: options?.priority,
    delay: options?.delay,
    attempts: options?.attempts,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const job = await queue.add(queueName as any, data as any, jobOptions) as Job<T>;

  logEvent(logger, "job_added", {
    queue: queueName,
    jobId: job.id,
    priority: options?.priority,
  });

  return job;
}

/**
 * Add multiple jobs to a queue in bulk
 * Returns empty array if Redis/queues are unavailable
 */
export async function addBulkJobs<T>(
  queueName: QueueName,
  jobs: Array<{ data: T; opts?: { jobId?: string; priority?: number; delay?: number } }>
): Promise<Job<T>[]> {
  const queue = getQueue<T>(queueName);
  if (!queue) {
    logger.warn({ queue: queueName, count: jobs.length }, "Cannot add bulk jobs - Redis unavailable");
    return [];
  }

  const bulkJobs = jobs.map((job) => ({
    name: queueName as string,
    data: job.data,
    opts: job.opts,
  }));

  const addedJobs = await queue.addBulk(bulkJobs as Parameters<typeof queue.addBulk>[0]) as Job<T>[];

  logEvent(logger, "jobs_added_bulk", {
    queue: queueName,
    count: addedJobs.length,
  });

  return addedJobs;
}

/**
 * Get queue statistics
 * Returns zeros if Redis/queues are unavailable
 */
export async function getQueueStats(queueName: QueueName): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}> {
  const queue = getQueue(queueName);
  if (!queue) {
    return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
  }

  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);

  return { waiting, active, completed, failed, delayed };
}

/**
 * Pause a queue
 */
export async function pauseQueue(queueName: QueueName): Promise<void> {
  const queue = getQueue(queueName);
  if (!queue) return;
  await queue.pause();
  logEvent(logger, "queue_paused", { queue: queueName });
}

/**
 * Resume a queue
 */
export async function resumeQueue(queueName: QueueName): Promise<void> {
  const queue = getQueue(queueName);
  if (!queue) return;
  await queue.resume();
  logEvent(logger, "queue_resumed", { queue: queueName });
}

/**
 * Close all queue connections
 */
export async function closeAllQueues(): Promise<void> {
  const closePromises: Promise<void>[] = [];

  for (const [name, queue] of queues) {
    closePromises.push(queue.close());
    logEvent(logger, "queue_closing", { queue: name });
  }

  for (const events of queueEvents.values()) {
    closePromises.push(events.close());
  }

  await Promise.all(closePromises);

  queues.clear();
  queueEvents.clear();

  if (redisConnection) {
    await redisConnection.quit();
    redisConnection = null;
  }

  logEvent(logger, "all_queues_closed");
}

/**
 * Check Redis connection health
 */
export async function checkRedisHealth(): Promise<{
  connected: boolean;
  latencyMs: number;
  error?: string;
}> {
  const endTimer = startTimer();
  try {
    const redis = getRedisConnection();
    if (!redis) {
      return {
        connected: false,
        latencyMs: -1,
        error: "Redis not configured",
      };
    }
    await redis.ping();
    const latencyMs = endTimer();
    redisAvailable = true;
    redisConnectionState.set(1);
    recordRedisOp("ping", "success", latencyMs);

    return { connected: true, latencyMs };
  } catch (error) {
    const latencyMs = endTimer();
    redisAvailable = false;
    redisConnectionState.set(0);
    recordRedisOp("ping", "failure", latencyMs);
    return {
      connected: false,
      latencyMs: -1,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Execute a timed Redis operation with metrics
 */
export async function timedRedisOp<T>(
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const endTimer = startTimer();
  try {
    const result = await fn();
    recordRedisOp(operation, "success", endTimer());
    return result;
  } catch (error) {
    recordRedisOp(operation, "failure", endTimer());
    throw error;
  }
}

/**
 * Check if Redis is available (cached result)
 */
export function isRedisAvailable(): boolean {
  return redisAvailable === true;
}

/**
 * Reset Redis availability state (for testing)
 */
export function resetRedisState(): void {
  redisAvailable = null;
  if (redisConnection) {
    redisConnection.disconnect();
    redisConnection = null;
  }
}

// ============================================================================
// Redis Pub/Sub for Real-Time Events
// ============================================================================

const SWARM_EVENTS_CHANNEL = "swarm:events";

// Separate connection for pub/sub (Redis requires separate connections for pub/sub)
let pubSubConnection: RedisType | null = null;
const eventSubscribers: Set<(event: SwarmEvent) => void> = new Set();

/**
 * Swarm event types for real-time updates
 */
export type SwarmEventType = "activity:started" | "activity:completed" | "state:updated";

export interface SwarmEvent {
  type: SwarmEventType;
  timestamp: string;
  data: {
    agentType?: string;
    action?: string;
    status?: string;
    correlationId?: string;
    contactId?: string;
    durationMs?: number;
    phoneNumber?: string;
  };
}

/**
 * Get or create the pub/sub Redis connection
 */
function getPubSubConnection(): RedisType | null {
  if (redisAvailable === false) {
    return null;
  }

  if (!pubSubConnection) {
    const config = getDefaultRedisConfig();
    pubSubConnection = new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      db: config.db,
      lazyConnect: true,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    pubSubConnection.on("error", (error: Error) => {
      logger.error({ error: error.message }, "Pub/sub Redis connection error");
    });
  }

  return pubSubConnection;
}

/**
 * Publish a swarm event to Redis pub/sub
 */
export async function publishSwarmEvent(event: SwarmEvent): Promise<boolean> {
  const redis = getRedisConnection();
  if (!redis) {
    return false;
  }

  try {
    await redis.publish(SWARM_EVENTS_CHANNEL, JSON.stringify(event));
    return true;
  } catch (error) {
    logger.error({ error }, "Failed to publish swarm event");
    return false;
  }
}

/**
 * Subscribe to swarm events
 * Returns an unsubscribe function
 */
export async function subscribeToSwarmEvents(
  callback: (event: SwarmEvent) => void
): Promise<() => void> {
  const pubsub = getPubSubConnection();
  if (!pubsub) {
    logger.warn("Cannot subscribe to swarm events - Redis unavailable");
    return () => {};
  }

  // Add callback to subscribers
  eventSubscribers.add(callback);

  // Only subscribe to channel once (first subscriber)
  if (eventSubscribers.size === 1) {
    try {
      await pubsub.subscribe(SWARM_EVENTS_CHANNEL);

      pubsub.on("message", (channel: string, message: string) => {
        if (channel === SWARM_EVENTS_CHANNEL) {
          try {
            const event = JSON.parse(message) as SwarmEvent;
            // Notify all subscribers
            for (const subscriber of eventSubscribers) {
              subscriber(event);
            }
          } catch (error) {
            logger.error({ error }, "Failed to parse swarm event");
          }
        }
      });

      logEvent(logger, "swarm_events_subscribed");
    } catch (error) {
      logger.error({ error }, "Failed to subscribe to swarm events");
    }
  }

  // Return unsubscribe function
  return () => {
    eventSubscribers.delete(callback);

    // Unsubscribe from channel when no more subscribers
    if (eventSubscribers.size === 0 && pubsub) {
      pubsub.unsubscribe(SWARM_EVENTS_CHANNEL).catch(() => {});
    }
  };
}
