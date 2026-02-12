import { Queue, Worker, Job, QueueEvents, type ConnectionOptions } from "bullmq";
import Redis from "ioredis";
import { createLogger, logQueueJob, logEvent } from "../observability/logger.js";
import type { QueueName } from "../swarm/types.js";

const logger = createLogger({ component: "queue-client" });

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
let redisConnection: Redis | null = null;

/**
 * Get or create the Redis connection
 */
export function getRedisConnection(config?: RedisConfig): Redis {
  if (!redisConnection) {
    const redisConfig = config || getDefaultRedisConfig();
    redisConnection = new Redis({
      ...redisConfig,
      lazyConnect: true,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    redisConnection.on("connect", () => {
      logEvent(logger, "redis_connected", { host: redisConfig.host, port: redisConfig.port });
    });

    redisConnection.on("error", (error) => {
      logger.error({ error: error.message }, "Redis connection error");
    });

    redisConnection.on("close", () => {
      logEvent(logger, "redis_disconnected");
    });
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
};

// Queue instances cache
const queues: Map<QueueName, Queue> = new Map();
const queueEvents: Map<QueueName, QueueEvents> = new Map();

/**
 * Get or create a queue
 */
export function getQueue<T = unknown>(
  name: QueueName,
  options?: QueueOptions
): Queue<T> {
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
 */
export function getQueueEvents(name: QueueName): QueueEvents {
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
 */
export function createWorker<T, R = void>(
  queueName: QueueName,
  processor: JobProcessor<T, R>,
  options: WorkerOptions = {}
): Worker<T, R> {
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
): Promise<Job<T>> {
  const queue = getQueue<T>(queueName);
  const jobOptions = {
    jobId: options?.jobId,
    priority: options?.priority,
    delay: options?.delay,
    attempts: options?.attempts,
  };

  const job = await queue.add(queueName, data, jobOptions);

  logEvent(logger, "job_added", {
    queue: queueName,
    jobId: job.id,
    priority: options?.priority,
  });

  return job;
}

/**
 * Add multiple jobs to a queue in bulk
 */
export async function addBulkJobs<T>(
  queueName: QueueName,
  jobs: Array<{ data: T; opts?: { jobId?: string; priority?: number; delay?: number } }>
): Promise<Job<T>[]> {
  const queue = getQueue<T>(queueName);

  const bulkJobs = jobs.map((job) => ({
    name: queueName,
    data: job.data,
    opts: job.opts,
  }));

  const addedJobs = await queue.addBulk(bulkJobs);

  logEvent(logger, "jobs_added_bulk", {
    queue: queueName,
    count: addedJobs.length,
  });

  return addedJobs;
}

/**
 * Get queue statistics
 */
export async function getQueueStats(queueName: QueueName): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}> {
  const queue = getQueue(queueName);

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
  await queue.pause();
  logEvent(logger, "queue_paused", { queue: queueName });
}

/**
 * Resume a queue
 */
export async function resumeQueue(queueName: QueueName): Promise<void> {
  const queue = getQueue(queueName);
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
  try {
    const redis = getRedisConnection();
    const startTime = Date.now();
    await redis.ping();
    const latencyMs = Date.now() - startTime;

    return { connected: true, latencyMs };
  } catch (error) {
    return {
      connected: false,
      latencyMs: -1,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
