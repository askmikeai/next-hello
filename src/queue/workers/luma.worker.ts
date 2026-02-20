import type { Job, Worker } from "bullmq";
import { createWorker, type JobProcessor } from "../client.js";
import { createWorkerLogger } from "../../observability/logger.js";
import { recordJobProcessed, startTimer } from "../../observability/metrics.js";
import {
  hasValidSession,
  loginWithOtp,
  getUserEvents,
  scrapeEventGuests,
  closeBrowser,
  type LumaScrapedEvent,
} from "../../integrations/luma/scraper.js";
import {
  saveScrapedEvent,
  autoMatchContacts,
} from "../../integrations/luma/repo.js";

const logger = createWorkerLogger("luma-worker");

/**
 * Luma sync job types
 */
export type LumaSyncJobType = "full-sync" | "scrape-event" | "match-contacts";

/**
 * Luma sync job data
 */
export interface LumaSyncJob {
  type: LumaSyncJobType;
  correlationId: string;
  eventSlug?: string;  // For scrape-event type
  email?: string;      // For automated OTP login
  otpCode?: string;    // For automated OTP login
}

/**
 * Luma sync job result
 */
export interface LumaSyncJobResult {
  success: boolean;
  correlationId: string;
  type: LumaSyncJobType;
  eventsProcessed?: number;
  guestsFound?: number;
  contactsMatched?: number;
  events?: LumaScrapedEvent[];
  error?: string;
}

/**
 * Process a full Luma sync job
 */
async function processFullSync(
  job: Job<LumaSyncJob>
): Promise<LumaSyncJobResult> {
  const { correlationId, email, otpCode } = job.data;
  const jobLogger = logger.child({ correlationId, jobId: job.id, type: "full-sync" });

  try {
    // Check session
    let hasSession = await hasValidSession();

    // If no session and we have OTP credentials, try to login
    if (!hasSession && email && otpCode) {
      jobLogger.info({ email }, "No valid session, attempting OTP login");
      hasSession = await loginWithOtp(email, otpCode);
      if (!hasSession) {
        return {
          success: false,
          correlationId,
          type: "full-sync",
          error: "OTP login failed",
        };
      }
    }

    if (!hasSession) {
      return {
        success: false,
        correlationId,
        type: "full-sync",
        error: "No valid Luma session - login required",
      };
    }

    // Get user's events
    jobLogger.info("Fetching user events from Luma");
    const userEvents = await getUserEvents();
    jobLogger.info({ eventCount: userEvents.length }, "Found user events");

    // Scrape each event
    const scrapedEvents: LumaScrapedEvent[] = [];
    let totalGuests = 0;

    for (const event of userEvents) {
      try {
        jobLogger.info({ slug: event.slug, name: event.name }, "Scraping event");
        const scrapedEvent = await scrapeEventGuests(event.slug);

        if (scrapedEvent) {
          scrapedEvents.push(scrapedEvent);
          totalGuests += scrapedEvent.guestCount;

          // Save to database
          const { guestCount } = await saveScrapedEvent(scrapedEvent);
          jobLogger.info({
            slug: event.slug,
            guestsScraped: scrapedEvent.guestCount,
            guestsSaved: guestCount
          }, "Event scraped and saved");
        }
      } catch (error) {
        jobLogger.warn({
          slug: event.slug,
          error: error instanceof Error ? error.message : "Unknown error"
        }, "Failed to scrape event");
      }
    }

    // Run contact matching
    const matchedContacts = await autoMatchContacts();
    jobLogger.info({ matchedContacts }, "Contact matching complete");

    await closeBrowser();

    return {
      success: true,
      correlationId,
      type: "full-sync",
      eventsProcessed: scrapedEvents.length,
      guestsFound: totalGuests,
      contactsMatched: matchedContacts,
      events: scrapedEvents,
    };
  } catch (error) {
    jobLogger.error({ error: error instanceof Error ? error.message : "Unknown error" }, "Full sync failed");
    await closeBrowser().catch(() => {});
    throw error;
  }
}

/**
 * Scrape a single event
 */
async function processScrapeEvent(
  job: Job<LumaSyncJob>
): Promise<LumaSyncJobResult> {
  const { correlationId, eventSlug, email, otpCode } = job.data;
  const jobLogger = logger.child({ correlationId, jobId: job.id, type: "scrape-event", eventSlug });

  if (!eventSlug) {
    return {
      success: false,
      correlationId,
      type: "scrape-event",
      error: "Event slug is required",
    };
  }

  try {
    // Check session
    let hasSession = await hasValidSession();

    if (!hasSession && email && otpCode) {
      jobLogger.info({ email }, "No valid session, attempting OTP login");
      hasSession = await loginWithOtp(email, otpCode);
    }

    if (!hasSession) {
      return {
        success: false,
        correlationId,
        type: "scrape-event",
        error: "No valid Luma session - login required",
      };
    }

    jobLogger.info("Scraping event");
    const scrapedEvent = await scrapeEventGuests(eventSlug);

    if (!scrapedEvent) {
      return {
        success: false,
        correlationId,
        type: "scrape-event",
        error: "Failed to scrape event",
      };
    }

    // Save to database
    const { guestCount } = await saveScrapedEvent(scrapedEvent);
    jobLogger.info({ guestsScraped: scrapedEvent.guestCount, guestsSaved: guestCount }, "Event scraped and saved");

    await closeBrowser();

    return {
      success: true,
      correlationId,
      type: "scrape-event",
      eventsProcessed: 1,
      guestsFound: scrapedEvent.guestCount,
      events: [scrapedEvent],
    };
  } catch (error) {
    jobLogger.error({ error: error instanceof Error ? error.message : "Unknown error" }, "Event scrape failed");
    await closeBrowser().catch(() => {});
    throw error;
  }
}

/**
 * Match contacts to Luma guests
 */
async function processMatchContacts(
  job: Job<LumaSyncJob>
): Promise<LumaSyncJobResult> {
  const { correlationId } = job.data;
  const jobLogger = logger.child({ correlationId, jobId: job.id, type: "match-contacts" });

  try {
    const matchedContacts = await autoMatchContacts();
    jobLogger.info({ matchedContacts }, "Contact matching complete");

    return {
      success: true,
      correlationId,
      type: "match-contacts",
      contactsMatched: matchedContacts,
    };
  } catch (error) {
    jobLogger.error({ error: error instanceof Error ? error.message : "Unknown error" }, "Contact matching failed");
    throw error;
  }
}

/**
 * Process a Luma sync job
 */
async function processLumaJob(job: Job<LumaSyncJob>): Promise<LumaSyncJobResult> {
  const { type, correlationId } = job.data;
  const jobLogger = logger.child({ correlationId, jobId: job.id, type });
  const endTimer = startTimer();

  try {
    let result: LumaSyncJobResult;

    switch (type) {
      case "full-sync":
        result = await processFullSync(job);
        break;
      case "scrape-event":
        result = await processScrapeEvent(job);
        break;
      case "match-contacts":
        result = await processMatchContacts(job);
        break;
      default:
        result = {
          success: false,
          correlationId,
          type,
          error: `Unknown job type: ${type}`,
        };
    }

    recordJobProcessed("luma-sync", result.success ? "success" : "failure", endTimer());
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    jobLogger.error({ error: errorMessage }, "Luma sync job failed");

    recordJobProcessed("luma-sync", "failure", endTimer());

    return {
      success: false,
      correlationId,
      type,
      error: errorMessage,
    };
  }
}

/**
 * Create the Luma sync worker
 *
 * Handles:
 * - full-sync: Login, get events, scrape all, match contacts
 * - scrape-event: Scrape a specific event
 * - match-contacts: Run contact matching without scraping
 */
export function createLumaWorker(): Worker<LumaSyncJob, LumaSyncJobResult> | null {
  const processor: JobProcessor<LumaSyncJob, LumaSyncJobResult> = async (job) => {
    return processLumaJob(job);
  };

  logger.info("Creating Luma sync worker");

  return createWorker<LumaSyncJob, LumaSyncJobResult>(
    "luma-sync",
    processor,
    {
      concurrency: 1, // Only one browser at a time
    }
  );
}
