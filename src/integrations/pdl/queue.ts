/**
 * Queued PDL Enrichment
 *
 * Provides rate-limited access to PDL API via BullMQ queue.
 * Use these functions instead of direct API calls to respect rate limits.
 */

import { v4 as uuidv4 } from "uuid";
import { getQueue, getQueueEvents, isRedisAvailable } from "../../queue/client.js";
import { createLogger } from "../../observability/logger.js";
import type {
  PDLPersonEnrichmentParams,
  PDLCompanyEnrichmentParams,
  PDLEnrichmentResult,
  PDLCompanyResult,
} from "./client.js";
import type { PDLEnrichmentJob, PDLEnrichmentJobResult } from "../../queue/workers/pdl.worker.js";

// Re-export direct functions for cases where queue is unavailable
export {
  enrichPerson as enrichPersonDirect,
  enrichCompany as enrichCompanyDirect,
  enrichContact as enrichContactDirect,
} from "./client.js";

const logger = createLogger({ component: "pdl-queue" });

/**
 * Default timeout for waiting on PDL enrichment results (2 minutes)
 */
const DEFAULT_TIMEOUT_MS = 120000;

/**
 * Enqueue a person enrichment job and wait for the result
 *
 * @param params - PDL person enrichment parameters
 * @param options - Optional timeout and correlation ID
 * @returns Enrichment result
 */
export async function enrichPersonQueued(
  params: PDLPersonEnrichmentParams,
  options?: {
    timeoutMs?: number;
    correlationId?: string;
  }
): Promise<PDLEnrichmentResult> {
  const correlationId = options?.correlationId ?? uuidv4();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Fall back to direct call if Redis unavailable
  if (!isRedisAvailable()) {
    logger.warn({ correlationId }, "Redis unavailable, falling back to direct PDL call");
    const { enrichPerson } = await import("./client.js");
    return enrichPerson(params);
  }

  const queue = getQueue<PDLEnrichmentJob>("pdl-enrichment");
  const queueEvents = getQueueEvents("pdl-enrichment");

  if (!queue || !queueEvents) {
    logger.warn({ correlationId }, "PDL queue unavailable, falling back to direct call");
    const { enrichPerson } = await import("./client.js");
    return enrichPerson(params);
  }

  const jobData: PDLEnrichmentJob = {
    type: "person",
    correlationId,
    personParams: params,
  };

  const job = await queue.add("pdl-enrichment", jobData, {
    jobId: `pdl-person-${correlationId}`,
  });

  logger.info({ correlationId, jobId: job.id }, "PDL person enrichment job enqueued");

  try {
    // Wait for job completion
    const result = await job.waitUntilFinished(queueEvents, timeoutMs) as PDLEnrichmentJobResult;

    if (result.personResult) {
      return result.personResult;
    }

    return {
      success: false,
      status: 500,
      error: result.error ?? "Unknown error from PDL worker",
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ correlationId, error: errorMsg }, "PDL enrichment job failed or timed out");

    return {
      success: false,
      status: 500,
      error: `Job failed: ${errorMsg}`,
    };
  }
}

/**
 * Enqueue a company enrichment job and wait for the result
 *
 * @param params - PDL company enrichment parameters
 * @param options - Optional timeout and correlation ID
 * @returns Company enrichment result
 */
export async function enrichCompanyQueued(
  params: PDLCompanyEnrichmentParams,
  options?: {
    timeoutMs?: number;
    correlationId?: string;
  }
): Promise<PDLCompanyResult> {
  const correlationId = options?.correlationId ?? uuidv4();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Fall back to direct call if Redis unavailable
  if (!isRedisAvailable()) {
    logger.warn({ correlationId }, "Redis unavailable, falling back to direct PDL call");
    const { enrichCompany } = await import("./client.js");
    return enrichCompany(params);
  }

  const queue = getQueue<PDLEnrichmentJob>("pdl-enrichment");
  const queueEvents = getQueueEvents("pdl-enrichment");

  if (!queue || !queueEvents) {
    logger.warn({ correlationId }, "PDL queue unavailable, falling back to direct call");
    const { enrichCompany } = await import("./client.js");
    return enrichCompany(params);
  }

  const jobData: PDLEnrichmentJob = {
    type: "company",
    correlationId,
    companyParams: params,
  };

  const job = await queue.add("pdl-enrichment", jobData, {
    jobId: `pdl-company-${correlationId}`,
  });

  logger.info({ correlationId, jobId: job.id }, "PDL company enrichment job enqueued");

  try {
    const result = await job.waitUntilFinished(queueEvents, timeoutMs) as PDLEnrichmentJobResult;

    if (result.companyResult) {
      return result.companyResult;
    }

    return {
      success: false,
      status: 500,
      error: result.error ?? "Unknown error from PDL worker",
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ correlationId, error: errorMsg }, "PDL company enrichment job failed or timed out");

    return {
      success: false,
      status: 500,
      error: `Job failed: ${errorMsg}`,
    };
  }
}

/**
 * Queued version of enrichContact - tries multiple lookup methods via queue
 *
 * @param params - Contact lookup parameters
 * @param options - Optional timeout and correlation ID
 * @returns Enrichment result
 */
export async function enrichContactQueued(params: {
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
}, options?: {
  timeoutMs?: number;
  correlationId?: string;
}): Promise<PDLEnrichmentResult> {
  const { email, phone, linkedinUrl, firstName, lastName, company } = params;
  const correlationId = options?.correlationId ?? uuidv4();

  // Try in order of specificity
  // 1. LinkedIn URL (most specific)
  if (linkedinUrl) {
    const result = await enrichPersonQueued({ profile: linkedinUrl }, { ...options, correlationId });
    if (result.success) return result;
  }

  // 2. Email
  if (email) {
    const result = await enrichPersonQueued({ email }, { ...options, correlationId });
    if (result.success) return result;
  }

  // 3. Phone
  if (phone) {
    const normalizedPhone = phone.startsWith("+") ? phone : `+${phone}`;
    const result = await enrichPersonQueued({ phone: normalizedPhone }, { ...options, correlationId });
    if (result.success) return result;
  }

  // 4. Name + Company
  if (firstName && lastName && company) {
    const result = await enrichPersonQueued({
      first_name: firstName,
      last_name: lastName,
      company,
    }, { ...options, correlationId });
    if (result.success) return result;
  }

  // No match found with any method
  return {
    success: false,
    status: 404,
    error: "No match found with available information",
  };
}

/**
 * Fire-and-forget enrichment - adds to queue without waiting
 *
 * Useful for background enrichment where you don't need immediate results
 */
export async function enqueuePersonEnrichment(
  params: PDLPersonEnrichmentParams,
  correlationId?: string
): Promise<{ enqueued: boolean; jobId?: string; error?: string }> {
  const corrId = correlationId ?? uuidv4();

  if (!isRedisAvailable()) {
    return { enqueued: false, error: "Redis unavailable" };
  }

  const queue = getQueue<PDLEnrichmentJob>("pdl-enrichment");
  if (!queue) {
    return { enqueued: false, error: "Queue unavailable" };
  }

  try {
    const jobData: PDLEnrichmentJob = {
      type: "person",
      correlationId: corrId,
      personParams: params,
    };

    const job = await queue.add("pdl-enrichment", jobData, {
      jobId: `pdl-person-${corrId}`,
    });

    logger.info({ correlationId: corrId, jobId: job.id }, "PDL enrichment enqueued (fire-and-forget)");

    return { enqueued: true, jobId: job.id };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { enqueued: false, error: errorMsg };
  }
}
