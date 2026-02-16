import type { Job, Worker } from "bullmq";
import { createWorker, type JobProcessor } from "../client.js";
import { createWorkerLogger, logError } from "../../observability/logger.js";
import { recordJobProcessed, startTimer } from "../../observability/metrics.js";
import { createAgent } from "../../swarm/base-agent.js";
import { createLogger } from "../../observability/logger.js";
import { findContactByPhone, updateContactByPhone } from "../../contacts/index.js";
import type { ResearchJob, AgentContext } from "../../swarm/types.js";
import type { NetworkingEventConfig } from "../../config/types.js";

// Import to register the agent factory
import "../../swarm/agents/research.agent.js";

const logger = createWorkerLogger("research-worker");

/**
 * Research worker result
 */
export interface ResearchWorkerResult {
  success: boolean;
  correlationId: string;
  contactId: string;
  enriched: boolean;
  profileFound: boolean;
  companyFound: boolean;
  error?: string;
}

/**
 * Process a research job
 */
async function processResearchJob(
  job: Job<ResearchJob>,
  config: NetworkingEventConfig
): Promise<ResearchWorkerResult> {
  const {
    correlationId,
    contactId,
    phoneNumber,
    linkedinUrl,
    companyName,
    firstName,
    lastName,
  } = job.data;

  const jobLogger = logger.child({ correlationId, contactId, jobId: job.id });
  const endTimer = startTimer();

  try {
    // Update research status to in_progress
    await updateContactByPhone(
      phoneNumber,
      { research_status: "in_progress" },
      config.supabase
    );

    // Get the contact
    const contact = await findContactByPhone(phoneNumber, config.supabase);

    // Create research agent
    const researchAgent = createAgent("research");

    // Build context
    const context: AgentContext = {
      correlationId,
      config,
      contact: contact ?? undefined,
      phoneNumber,
      logger: createLogger({ correlationId, component: "research-agent" }),
    };

    // Build research prompt
    const researchPrompt = buildResearchPrompt({
      linkedinUrl,
      companyName,
      firstName,
      lastName,
      email: contact?.email ?? undefined,
    });

    // Execute research
    const result = await researchAgent.process(context, researchPrompt);

    // Update status based on result
    const newStatus = result.success ? "complete" : "failed";
    await updateContactByPhone(
      phoneNumber,
      {
        research_status: newStatus as "pending" | "in_progress" | "complete" | "failed",
        research_data: result.data ? result.data : undefined,
      },
      config.supabase
    );

    jobLogger.info({ success: result.success, newStatus }, "Research completed");

    recordJobProcessed("research-jobs", result.success ? "success" : "failure", endTimer());

    return {
      success: result.success,
      correlationId,
      contactId,
      enriched: result.data?.enriched === true,
      profileFound: result.data?.profile !== undefined,
      companyFound: result.data?.company !== undefined,
      error: result.error,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logError(jobLogger, error as Error, "Research job failed");

    recordJobProcessed("research-jobs", "failure", endTimer());

    // Update status to failed
    try {
      await updateContactByPhone(
        phoneNumber,
        { research_status: "failed" },
        config.supabase
      );
    } catch {
      // Ignore update failures
    }

    return {
      success: false,
      correlationId,
      contactId,
      enriched: false,
      profileFound: false,
      companyFound: false,
      error: errorMessage,
    };
  }
}

/**
 * Build a research prompt from available data
 */
function buildResearchPrompt(data: {
  linkedinUrl?: string;
  companyName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}): string {
  const parts: string[] = ["Research this contact:"];

  if (data.linkedinUrl) {
    parts.push(`LinkedIn URL: ${data.linkedinUrl}`);
  }
  if (data.firstName || data.lastName) {
    parts.push(`Name: ${data.firstName || ""} ${data.lastName || ""}`.trim());
  }
  if (data.email) {
    parts.push(`Email: ${data.email}`);
  }
  if (data.companyName) {
    parts.push(`Company: ${data.companyName}`);
  }

  parts.push("");
  parts.push("Find their LinkedIn profile and gather professional information.");
  parts.push("Update their contact record with any new information found.");

  return parts.join("\n");
}

/**
 * Create the research worker
 */
export function createResearchWorker(
  config: NetworkingEventConfig,
  options?: {
    concurrency?: number;
  }
): Worker<ResearchJob, ResearchWorkerResult> | null {
  const processor: JobProcessor<ResearchJob, ResearchWorkerResult> = async (job) => {
    return processResearchJob(job, config);
  };

  return createWorker<ResearchJob, ResearchWorkerResult>(
    "research-jobs",
    processor,
    {
      concurrency: options?.concurrency ?? 3, // Lower concurrency for API rate limits
      limiter: {
        max: 10,
        duration: 60000, // 10 research jobs per minute
      },
    }
  );
}
