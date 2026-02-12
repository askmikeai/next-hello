import type { Job, Worker } from "bullmq";
import { createWorker, type JobProcessor } from "../client.js";
import { createWorkerLogger, logError } from "../../observability/logger.js";
import { crmSync } from "../../agent/tools/crm-sync.js";
import { findContactByPhone } from "../../contacts/supabase-repo.js";
import type { CrmSyncJob } from "../../swarm/types.js";
import type { NetworkingEventConfig } from "../../config/types.js";

const logger = createWorkerLogger("crm-worker");

/**
 * CRM worker result
 */
export interface CrmWorkerResult {
  success: boolean;
  correlationId: string;
  contactId: string;
  crmContactId?: string;
  dealId?: string;
  operation: string;
  error?: string;
}

/**
 * Process a CRM sync job
 */
async function processCrmSyncJob(
  job: Job<CrmSyncJob>,
  config: NetworkingEventConfig
): Promise<CrmWorkerResult> {
  const { correlationId, contactId, phoneNumber, operation } = job.data;
  const jobLogger = logger.child({ correlationId, contactId, jobId: job.id });

  try {
    // Check if CRM is configured
    if (!config.crm?.apiKey) {
      jobLogger.warn("CRM not configured, skipping sync");
      return {
        success: false,
        correlationId,
        contactId,
        operation,
        error: "CRM not configured",
      };
    }

    // Get the contact
    const contact = await findContactByPhone(phoneNumber, config.supabase);
    if (!contact) {
      return {
        success: false,
        correlationId,
        contactId,
        operation,
        error: "Contact not found",
      };
    }

    // Check if already synced for create operation
    if (operation === "create" && contact.crm_contact_id) {
      jobLogger.info("Contact already synced to CRM");
      return {
        success: true,
        correlationId,
        contactId,
        crmContactId: contact.crm_contact_id,
        operation,
      };
    }

    // Determine if we should create a deal
    const shouldCreateDeal =
      contact.qualification_tier === "hot" || contact.qualification_tier === "warm";

    // Build deal name if creating
    const dealName = shouldCreateDeal
      ? `${contact.first_name || "New"} ${contact.last_name || "Contact"} - ${contact.event_name || "Networking"}`
      : undefined;

    // Perform the sync
    const result = await crmSync(
      {
        phoneNumber,
        createDeal: shouldCreateDeal,
        dealName,
        addNote: buildContactNote(contact),
      },
      config.crm,
      config.supabase
    );

    jobLogger.info(
      {
        success: result.success,
        crmContactId: result.crmContactId,
        dealCreated: !!result.dealId,
      },
      "CRM sync completed"
    );

    return {
      success: result.success,
      correlationId,
      contactId,
      crmContactId: result.crmContactId,
      dealId: result.dealId,
      operation,
      error: result.error,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logError(jobLogger, error as Error, "CRM sync job failed");

    return {
      success: false,
      correlationId,
      contactId,
      operation,
      error: errorMessage,
    };
  }
}

/**
 * Build a note to add to the CRM contact
 */
function buildContactNote(contact: {
  event_name?: string | null;
  qualification_tier?: string | null;
  qualification_score?: number | null;
  total_turns?: number | null;
  calendly_scheduled_at?: string | null;
}): string {
  const lines: string[] = ["Contact synced from NextHello"];

  if (contact.event_name) {
    lines.push(`Met at: ${contact.event_name}`);
  }

  if (contact.qualification_tier) {
    lines.push(
      `Lead Qualification: ${contact.qualification_tier.toUpperCase()} (score: ${contact.qualification_score || "N/A"})`
    );
  }

  if (contact.total_turns) {
    lines.push(`Conversation turns: ${contact.total_turns}`);
  }

  if (contact.calendly_scheduled_at) {
    lines.push(
      `Meeting scheduled: ${new Date(contact.calendly_scheduled_at).toLocaleString()}`
    );
  }

  lines.push(`Synced: ${new Date().toISOString()}`);

  return lines.join("\n");
}

/**
 * Create the CRM worker
 */
export function createCrmWorker(
  config: NetworkingEventConfig,
  options?: {
    concurrency?: number;
  }
): Worker<CrmSyncJob, CrmWorkerResult> {
  const processor: JobProcessor<CrmSyncJob, CrmWorkerResult> = async (job) => {
    return processCrmSyncJob(job, config);
  };

  return createWorker<CrmSyncJob, CrmWorkerResult>(
    "crm-sync",
    processor,
    {
      concurrency: options?.concurrency ?? 5,
      limiter: {
        max: 30,
        duration: 60000, // 30 syncs per minute (HubSpot rate limit friendly)
      },
    }
  );
}
