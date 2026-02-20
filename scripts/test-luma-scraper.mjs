#!/usr/bin/env node
/**
 * Integration Test: Luma Scraper
 *
 * Tests the Luma browser scraper against live events.
 * Requires a valid Luma session or will trigger login flow.
 *
 * Usage:
 *   node scripts/test-luma-scraper.mjs                    # Run all tests
 *   node scripts/test-luma-scraper.mjs --login            # Force new login
 *   node scripts/test-luma-scraper.mjs --event ddfjmykw   # Test specific event
 *   node scripts/test-luma-scraper.mjs --match "Alex"     # Test name matching
 */

import { config } from "dotenv";
config();

// Dynamic import for ES modules
const runTests = async () => {
  console.log("=".repeat(60));
  console.log("Luma Scraper Integration Test");
  console.log("=".repeat(60));
  console.log();

  // Parse args
  const args = process.argv.slice(2);
  const forceLogin = args.includes("--login");
  const eventArg = args.find((a, i) => args[i - 1] === "--event") || "ddfjmykw";
  const matchArg = args.find((a, i) => args[i - 1] === "--match");

  // Import scraper (compiled TypeScript)
  let scraper;
  try {
    // Try importing from dist (compiled)
    scraper = await import("../dist/src/integrations/luma/scraper.js");
  } catch (e) {
    console.error("Failed to import scraper. Make sure to run `npm run build` first.");
    console.error(e.message);
    process.exit(1);
  }

  const {
    login,
    hasValidSession,
    getUserEvents,
    scrapeEventGuests,
    matchContactToGuests,
    closeBrowser,
  } = scraper;

  const results = {
    passed: 0,
    failed: 0,
    skipped: 0,
  };

  const test = (name, fn) => async () => {
    process.stdout.write(`  ${name}... `);
    try {
      await fn();
      console.log("\x1b[32mPASSED\x1b[0m");
      results.passed++;
    } catch (error) {
      console.log("\x1b[31mFAILED\x1b[0m");
      console.log(`    Error: ${error.message}`);
      results.failed++;
    }
  };

  const skip = (name, reason) => {
    console.log(`  ${name}... \x1b[33mSKIPPED\x1b[0m (${reason})`);
    results.skipped++;
  };

  try {
    // ============================================
    // Test 1: Session Check
    // ============================================
    console.log("\n[1] Session Check");
    console.log("-".repeat(40));

    let hasSession = await hasValidSession();
    console.log(`  Current session valid: ${hasSession}`);

    if (forceLogin || !hasSession) {
      console.log("\n  Starting login flow...");
      console.log("  A browser window will open.");
      console.log("  1. Enter your email (askmikeai@gmail.com)");
      console.log("  2. Check email for 6-digit OTP code");
      console.log("  3. Enter OTP in browser");
      console.log("  4. Wait for redirect to /home\n");

      const loginSuccess = await login();
      if (!loginSuccess) {
        console.error("  Login failed or cancelled. Exiting.");
        await closeBrowser();
        process.exit(1);
      }
      console.log("  Login successful!");
      hasSession = true;
    }

    await test("Session is valid", async () => {
      const valid = await hasValidSession();
      if (!valid) throw new Error("Session not valid after login");
    })();

    // ============================================
    // Test 2: Get User Events
    // ============================================
    console.log("\n[2] Get User Events");
    console.log("-".repeat(40));

    let userEvents = [];
    await test("Fetch events from /home", async () => {
      userEvents = await getUserEvents();
      if (userEvents.length === 0) {
        throw new Error("No events found");
      }
      console.log(`\n    Found ${userEvents.length} events:`);
      userEvents.forEach((e, i) => {
        console.log(`    ${i + 1}. [${e.tab}] ${e.name}`);
        console.log(`       URL: ${e.url}`);
      });
    })();

    // ============================================
    // Test 3: Scrape Event Guests
    // ============================================
    console.log("\n[3] Scrape Event Guests");
    console.log("-".repeat(40));

    let scrapedEvent = null;
    const testEventSlug = eventArg;
    console.log(`  Testing event: ${testEventSlug}`);

    await test(`Scrape guests from ${testEventSlug}`, async () => {
      scrapedEvent = await scrapeEventGuests(testEventSlug);
      if (!scrapedEvent) {
        throw new Error("Failed to scrape event");
      }
      console.log(`\n    Event: ${scrapedEvent.name}`);
      console.log(`    URL: ${scrapedEvent.url}`);

      // Display event details
      if (scrapedEvent.date) console.log(`    Date: ${scrapedEvent.date}`);
      if (scrapedEvent.endDate) console.log(`    End: ${scrapedEvent.endDate}`);
      if (scrapedEvent.timezone) console.log(`    Timezone: ${scrapedEvent.timezone}`);
      if (scrapedEvent.location) console.log(`    Location: ${scrapedEvent.location}`);
      if (scrapedEvent.locationAddress) console.log(`    Address: ${scrapedEvent.locationAddress}`);
      if (scrapedEvent.isOnline) console.log(`    Online: true`);
      if (scrapedEvent.description && typeof scrapedEvent.description === 'string') {
        const desc = scrapedEvent.description.substring(0, 200);
        console.log(`    Description: ${desc}${scrapedEvent.description.length > 200 ? '...' : ''}`);
      } else if (scrapedEvent.description) {
        console.log(`    Description: [object - type: ${typeof scrapedEvent.description}]`);
      }
      if (scrapedEvent.coverImageUrl) console.log(`    Cover: ${scrapedEvent.coverImageUrl.substring(0, 80)}...`);
      if (scrapedEvent.hosts && scrapedEvent.hosts.length > 0) {
        console.log(`    Hosts (${scrapedEvent.hosts.length}):`);
        scrapedEvent.hosts.forEach((h, i) => {
          console.log(`      ${i + 1}. ${h.name}${h.lumaProfile ? ` (${h.lumaProfile})` : ''}`);
        });
      }

      console.log(`    Guests scraped: ${scrapedEvent.guestCount}`);

      if (scrapedEvent.guests.length > 0) {
        console.log(`\n    Sample guests (first 10):`);
        scrapedEvent.guests.slice(0, 10).forEach((g, i) => {
          const social = [g.instagram, g.twitter].filter(Boolean).join(", ") || "none";
          console.log(`    ${i + 1}. ${g.name}`);
          console.log(`       Luma: ${g.lumaProfile}`);
          console.log(`       Social: ${social}`);
        });
      }
    })();

    // ============================================
    // Test 4: Name Matching
    // ============================================
    console.log("\n[4] Name Matching");
    console.log("-".repeat(40));

    if (scrapedEvent && scrapedEvent.guests.length > 0) {
      const testNames = matchArg
        ? [matchArg]
        : ["Michael Friedberg", "Alex", "Alberto Sadde", "NonexistentPerson123"];

      for (const testName of testNames) {
        await test(`Match name: "${testName}"`, async () => {
          const match = matchContactToGuests(testName, scrapedEvent.guests, 0.7);
          if (match) {
            console.log(`\n    Match found!`);
            console.log(`    Guest: ${match.guest.name}`);
            console.log(`    Score: ${match.score}`);
            console.log(`    Profile: ${match.guest.lumaProfile}`);
          } else {
            console.log(`\n    No match found (this may be expected)`);
          }
        })();
      }
    } else {
      skip("Name matching tests", "No guests scraped");
    }

    // ============================================
    // Test 5: Social Links Extraction
    // ============================================
    console.log("\n[5] Social Links Extraction");
    console.log("-".repeat(40));

    if (scrapedEvent && scrapedEvent.guests.length > 0) {
      await test("Extract social links from guests", async () => {
        const withInstagram = scrapedEvent.guests.filter((g) => g.instagram);
        const withTwitter = scrapedEvent.guests.filter((g) => g.twitter);
        const withAny = scrapedEvent.guests.filter((g) => g.instagram || g.twitter);

        console.log(`\n    Total guests: ${scrapedEvent.guests.length}`);
        console.log(`    With Instagram: ${withInstagram.length}`);
        console.log(`    With Twitter/X: ${withTwitter.length}`);
        console.log(`    With any social: ${withAny.length} (${Math.round((withAny.length / scrapedEvent.guests.length) * 100)}%)`);

        if (withAny.length > 0) {
          console.log(`\n    Sample guests with social links:`);
          withAny.slice(0, 5).forEach((g) => {
            console.log(`    - ${g.name}`);
            if (g.instagram) console.log(`      IG: ${g.instagram}`);
            if (g.twitter) console.log(`      X: ${g.twitter}`);
          });
        }
      })();
    } else {
      skip("Social links extraction", "No guests scraped");
    }

    // ============================================
    // Cleanup
    // ============================================
    console.log("\n[Cleanup]");
    console.log("-".repeat(40));
    await closeBrowser();
    console.log("  Browser closed, session saved.");

    // ============================================
    // Summary
    // ============================================
    console.log("\n" + "=".repeat(60));
    console.log("Test Summary");
    console.log("=".repeat(60));
    console.log(`  \x1b[32mPassed: ${results.passed}\x1b[0m`);
    console.log(`  \x1b[31mFailed: ${results.failed}\x1b[0m`);
    console.log(`  \x1b[33mSkipped: ${results.skipped}\x1b[0m`);
    console.log();

    if (results.failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error("\nUnexpected error:", error);
    await closeBrowser().catch(() => {});
    process.exit(1);
  }
};

runTests();
