#!/usr/bin/env node
/**
 * CLI script to trigger Luma sync jobs
 *
 * Usage:
 *   node scripts/luma-sync.mjs                     # Full sync (requires session)
 *   node scripts/luma-sync.mjs --event ddfjmykw    # Scrape specific event
 *   node scripts/luma-sync.mjs --match             # Just run contact matching
 *   node scripts/luma-sync.mjs --direct            # Run directly without queue
 */

import { config } from "dotenv";
config();

const args = process.argv.slice(2);
const eventSlug = args.find((a, i) => args[i - 1] === "--event");
const matchOnly = args.includes("--match");
const direct = args.includes("--direct");

async function runDirect() {
  console.log("Running Luma sync directly (without queue)...\n");

  const {
    hasValidSession,
    getUserEvents,
    scrapeEventGuests,
    closeBrowser,
  } = await import("../dist/src/integrations/luma/scraper.js");

  const {
    saveScrapedEvent,
    autoMatchContacts,
  } = await import("../dist/src/integrations/luma/repo.js");

  try {
    // Check session
    const hasSession = await hasValidSession();
    if (!hasSession) {
      console.error("No valid Luma session. Please run the login flow first.");
      console.error("Use: node scripts/test-luma-scraper.mjs --login");
      process.exit(1);
    }

    console.log("✓ Valid Luma session found\n");

    if (matchOnly) {
      console.log("Running contact matching...");
      const matched = await autoMatchContacts();
      console.log(`✓ Matched ${matched} contacts\n`);
      return;
    }

    if (eventSlug) {
      console.log(`Scraping event: ${eventSlug}`);
      const event = await scrapeEventGuests(eventSlug);

      if (event) {
        console.log(`\nEvent: ${event.name}`);
        console.log(`Date: ${event.date || "TBD"}`);
        console.log(`Location: ${event.location || "N/A"}`);
        console.log(`Hosts: ${event.hosts?.map(h => h.name).join(", ") || "N/A"}`);
        console.log(`Guests: ${event.guestCount}`);

        if (event.description) {
          console.log(`Description: ${event.description.substring(0, 200)}...`);
        }

        console.log("\nSaving to database...");
        const { hostCount, guestCount } = await saveScrapedEvent(event);
        console.log(`✓ Saved event with ${hostCount} hosts and ${guestCount} guests\n`);
      } else {
        console.error("Failed to scrape event");
      }
    } else {
      // Full sync
      console.log("Getting user events...");
      const events = await getUserEvents();
      console.log(`Found ${events.length} events\n`);

      let totalGuests = 0;
      for (const event of events) {
        console.log(`Scraping: ${event.name} (${event.slug})`);
        const scraped = await scrapeEventGuests(event.slug);

        if (scraped) {
          totalGuests += scraped.guestCount;
          const { hostCount, guestCount } = await saveScrapedEvent(scraped);
          console.log(`  ✓ ${hostCount} hosts, ${guestCount} guests saved`);
        } else {
          console.log(`  ✗ Failed to scrape`);
        }
      }

      console.log(`\nTotal: ${events.length} events, ${totalGuests} guests`);

      console.log("\nRunning contact matching...");
      const matched = await autoMatchContacts();
      console.log(`✓ Matched ${matched} contacts`);
    }

    await closeBrowser();
    console.log("\n✓ Sync complete");
  } catch (error) {
    console.error("Error:", error.message);
    await closeBrowser().catch(() => {});
    process.exit(1);
  }
}

async function runViaQueue() {
  console.log("Queueing Luma sync job...\n");

  const { addJob, isRedisConfigured } = await import("../dist/src/queue/client.js");
  const crypto = await import("crypto");

  if (!isRedisConfigured()) {
    console.error("Redis is not configured. Use --direct to run without queue.");
    process.exit(1);
  }

  let jobType = "full-sync";
  if (matchOnly) jobType = "match-contacts";
  else if (eventSlug) jobType = "scrape-event";

  const jobData = {
    type: jobType,
    correlationId: crypto.randomUUID(),
    eventSlug,
  };

  const job = await addJob("luma-sync", jobData);

  if (job) {
    console.log(`Job queued: ${job.id}`);
    console.log(`Type: ${jobType}`);
    if (eventSlug) console.log(`Event: ${eventSlug}`);
    console.log("\nJob will be processed by the Luma worker.");
  } else {
    console.error("Failed to queue job (Redis may be unavailable)");
    process.exit(1);
  }
}

// Main
(async () => {
  try {
    if (direct) {
      await runDirect();
    } else {
      await runViaQueue();
    }
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
})();
