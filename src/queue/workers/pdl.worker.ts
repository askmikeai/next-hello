import type { Job, Worker } from "bullmq";
import { createWorker, type JobProcessor } from "../client.js";
import { createWorkerLogger } from "../../observability/logger.js";
import { recordJobProcessed, startTimer } from "../../observability/metrics.js";
import {
  enrichPerson,
  enrichCompany,
  type PDLPersonEnrichmentParams,
  type PDLCompanyEnrichmentParams,
  type PDLEnrichmentResult,
  type PDLCompanyResult,
} from "../../integrations/pdl/client.js";

const logger = createWorkerLogger("pdl-worker");

/**
 * PDL enrichment job types
 */
export type PDLJobType = "person" | "company";

/**
 * PDL enrichment job data
 */
export interface PDLEnrichmentJob {
  type: PDLJobType;
  correlationId: string;
  personParams?: PDLPersonEnrichmentParams;
  companyParams?: PDLCompanyEnrichmentParams;
}

/**
 * PDL enrichment job result
 */
export interface PDLEnrichmentJobResult {
  success: boolean;
  correlationId: string;
  type: PDLJobType;
  personResult?: PDLEnrichmentResult;
  companyResult?: PDLCompanyResult;
  error?: string;
}

/**
 * Process a PDL enrichment job
 */
async function processPDLJob(job: Job<PDLEnrichmentJob>): Promise<PDLEnrichmentJobResult> {
  const { type, correlationId, personParams, companyParams } = job.data;
  const jobLogger = logger.child({ correlationId, jobId: job.id, type });
  const endTimer = startTimer();

  try {
    if (type === "person" && personParams) {
      jobLogger.info({ hasEmail: !!personParams.email, hasPhone: !!personParams.phone }, "Processing PDL person enrichment");

      const result = await enrichPerson(personParams);

      recordJobProcessed("pdl-enrichment", result.success ? "success" : "failure", endTimer());

      return {
        success: result.success,
        correlationId,
        type: "person",
        personResult: result,
      };
    }

    if (type === "company" && companyParams) {
      jobLogger.info({ hasName: !!companyParams.name, hasWebsite: !!companyParams.website }, "Processing PDL company enrichment");

      const result = await enrichCompany(companyParams);

      recordJobProcessed("pdl-enrichment", result.success ? "success" : "failure", endTimer());

      return {
        success: result.success,
        correlationId,
        type: "company",
        companyResult: result,
      };
    }

    // Invalid job data
    recordJobProcessed("pdl-enrichment", "failure", endTimer());
    return {
      success: false,
      correlationId,
      type,
      error: "Invalid job data: missing params for type",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    jobLogger.error({ error: errorMessage }, "PDL enrichment job failed");

    recordJobProcessed("pdl-enrichment", "failure", endTimer());

    return {
      success: false,
      correlationId,
      type,
      error: errorMessage,
    };
  }
}

/**
 * PDL rate limit configuration
 * Can be overridden via environment variables
 */
function getPDLRateLimit(): { max: number; duration: number } {
  const maxPerMinute = parseInt(process.env.PDL_RATE_LIMIT_PER_MINUTE || "10", 10);
  return {
    max: maxPerMinute,
    duration: 60000, // 1 minute
  };
}

/**
 * Create the PDL enrichment worker
 *
 * Rate limited to respect PDL API limits (default: 10/min for free tier)
 * Set PDL_RATE_LIMIT_PER_MINUTE env var to adjust for paid plans
 */
export function createPDLWorker(): Worker<PDLEnrichmentJob, PDLEnrichmentJobResult> | null {
  const processor: JobProcessor<PDLEnrichmentJob, PDLEnrichmentJobResult> = async (job) => {
    return processPDLJob(job);
  };

  const rateLimit = getPDLRateLimit();

  logger.info({ rateLimit }, "Creating PDL worker with rate limit");

  return createWorker<PDLEnrichmentJob, PDLEnrichmentJobResult>(
    "pdl-enrichment",
    processor,
    {
      concurrency: 1, // Process one at a time to ensure rate limit accuracy
      limiter: rateLimit,
    }
  );
}
