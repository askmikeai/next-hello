/**
 * Luma Browser Scraper
 *
 * Uses Playwright to scrape event attendees from Luma with authenticated session.
 * Persists session to avoid repeated logins.
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { recordIntegrationCall, startTimer } from "../../observability/metrics.js";

const LUMA_BASE_URL = "https://lu.ma";
const SESSION_FILE = path.join(process.cwd(), "data", "luma-session.json");

export interface LumaScrapedGuest {
  name: string;
  avatarUrl?: string;
  bio?: string;
  linkedin?: string;
  twitter?: string;
  instagram?: string;
  website?: string;
  isFeatured: boolean;
}

export interface LumaScrapedEvent {
  apiId: string;
  name: string;
  url: string;
  date: string;
  location?: string;
  guestCount: number;
  guests: LumaScrapedGuest[];
  scrapedAt: string;
}

export interface LumaUserEvent {
  apiId: string;
  name: string;
  url: string;
  date: string;
  role: "attending" | "hosting";
}

let browser: Browser | null = null;
let context: BrowserContext | null = null;

function log(message: string): void {
  console.log(`[luma-scraper] ${message}`);
}

/**
 * Ensure data directory exists
 */
function ensureDataDir(): void {
  const dataDir = path.dirname(SESSION_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

/**
 * Initialize browser with persistent session
 */
async function initBrowser(): Promise<BrowserContext> {
  if (context) return context;

  ensureDataDir();

  browser = await chromium.launch({
    headless: true,
  });

  // Try to load existing session
  if (fs.existsSync(SESSION_FILE)) {
    try {
      const sessionData = JSON.parse(fs.readFileSync(SESSION_FILE, "utf-8"));
      context = await browser.newContext({
        storageState: sessionData,
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      });
      log("Loaded existing session");
    } catch {
      log("Failed to load session, starting fresh");
      context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      });
    }
  } else {
    context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
  }

  return context;
}

/**
 * Save current session state
 */
async function saveSession(): Promise<void> {
  if (!context) return;
  ensureDataDir();
  const state = await context.storageState();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(state, null, 2));
  log("Session saved");
}

/**
 * Check if currently logged in
 */
async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    // Check for user menu or profile indicator
    const userMenu = await page.$('[data-testid="user-menu"], [class*="avatar"], [class*="profile"]');
    if (userMenu) return true;

    // Check cookies for auth token
    const cookies = await context?.cookies();
    const hasAuthCookie = cookies?.some(
      (c) => c.name.includes("session") || c.name.includes("token") || c.name.includes("auth")
    );
    return !!hasAuthCookie;
  } catch {
    return false;
  }
}

/**
 * Login to Luma - opens browser for manual login
 * Returns true when login is complete
 */
export async function login(): Promise<boolean> {
  const endTimer = startTimer();

  // Launch visible browser for login
  const loginBrowser = await chromium.launch({
    headless: false, // Show browser for manual login
  });

  const loginContext = await loginBrowser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await loginContext.newPage();

  try {
    log("Opening Luma login page...");
    await page.goto(`${LUMA_BASE_URL}/signin`, { waitUntil: "networkidle" });

    log("Please login in the browser window...");
    log("Waiting for login to complete (checking for redirect to home/dashboard)...");

    // Wait for successful login (redirect away from signin page)
    await page.waitForURL((url) => !url.pathname.includes("signin"), {
      timeout: 300000, // 5 minute timeout for manual login
    });

    log("Login detected! Saving session...");

    // Save the session
    ensureDataDir();
    const state = await loginContext.storageState();
    fs.writeFileSync(SESSION_FILE, JSON.stringify(state, null, 2));

    recordIntegrationCall("luma", "login", "success", endTimer());
    log("Session saved successfully");

    await loginBrowser.close();
    return true;
  } catch (error) {
    log(`Login failed: ${error instanceof Error ? error.message : String(error)}`);
    recordIntegrationCall("luma", "login", "failure", endTimer());
    await loginBrowser.close();
    return false;
  }
}

/**
 * Check if we have a valid session
 */
export async function hasValidSession(): Promise<boolean> {
  if (!fs.existsSync(SESSION_FILE)) return false;

  try {
    const ctx = await initBrowser();
    const page = await ctx.newPage();
    await page.goto(`${LUMA_BASE_URL}/discover`, { waitUntil: "networkidle" });
    const loggedIn = await isLoggedIn(page);
    await page.close();
    return loggedIn;
  } catch {
    return false;
  }
}

/**
 * Get events the user is attending or hosting
 */
export async function getUserEvents(): Promise<LumaUserEvent[]> {
  const endTimer = startTimer();
  const events: LumaUserEvent[] = [];

  try {
    const ctx = await initBrowser();
    const page = await ctx.newPage();

    // Go to user's event page
    await page.goto(`${LUMA_BASE_URL}/home`, { waitUntil: "networkidle" });

    // Wait for events to load
    await page.waitForSelector('[class*="event"]', { timeout: 10000 }).catch(() => {});

    // Extract events from __NEXT_DATA__
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nextData = await page.evaluate(() => {
      // Access document through globalThis for browser context
      const doc = (globalThis as { document?: { querySelector: (s: string) => { textContent?: string } | null } }).document;
      const script = doc?.querySelector("#__NEXT_DATA__");
      if (script) {
        return JSON.parse(script.textContent || "{}");
      }
      return null;
    });

    if (nextData?.props?.pageProps?.initialData?.data) {
      const data = nextData.props.pageProps.initialData.data;

      // Look for upcoming/past events
      const eventLists = [
        ...(data.upcoming_events || []).map((e: Record<string, unknown>) => ({ ...e, role: "attending" })),
        ...(data.hosted_events || []).map((e: Record<string, unknown>) => ({ ...e, role: "hosting" })),
        ...(data.events || []).map((e: Record<string, unknown>) => ({ ...e, role: "attending" })),
      ];

      for (const event of eventLists) {
        const eventData = event.event || event;
        if (eventData.api_id) {
          events.push({
            apiId: eventData.api_id,
            name: eventData.name || "Unknown Event",
            url: `${LUMA_BASE_URL}/${eventData.url || eventData.slug || eventData.api_id}`,
            date: eventData.start_at || "",
            role: event.role as "attending" | "hosting",
          });
        }
      }
    }

    await page.close();
    await saveSession();

    recordIntegrationCall("luma", "get_user_events", "success", endTimer());
    log(`Found ${events.length} events`);
    return events;
  } catch (error) {
    log(`Failed to get user events: ${error instanceof Error ? error.message : String(error)}`);
    recordIntegrationCall("luma", "get_user_events", "failure", endTimer());
    return events;
  }
}

/**
 * Scrape all guests from an event page
 */
export async function scrapeEventGuests(eventUrl: string): Promise<LumaScrapedEvent | null> {
  const endTimer = startTimer();

  try {
    const ctx = await initBrowser();
    const page = await ctx.newPage();

    log(`Scraping event: ${eventUrl}`);
    await page.goto(eventUrl, { waitUntil: "networkidle" });

    // Extract initial data from __NEXT_DATA__
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nextData = await page.evaluate(() => {
      // Access document through globalThis for browser context
      const doc = (globalThis as { document?: { querySelector: (s: string) => { textContent?: string } | null } }).document;
      const script = doc?.querySelector("#__NEXT_DATA__");
      if (script) {
        return JSON.parse(script.textContent || "{}");
      }
      return null;
    });

    const initialData = nextData?.props?.pageProps?.initialData?.data;
    if (!initialData) {
      log("No event data found");
      await page.close();
      return null;
    }

    const eventInfo = initialData.event || {};
    const guests: LumaScrapedGuest[] = [];

    // Get featured guests from initial data
    const featuredGuests = initialData.featured_guests || [];
    for (const guest of featuredGuests) {
      guests.push({
        name: guest.name || "Unknown",
        avatarUrl: guest.avatar_url,
        bio: guest.bio_short,
        linkedin: guest.linkedin_handle,
        twitter: guest.twitter_handle,
        instagram: guest.instagram_handle,
        website: guest.website,
        isFeatured: true,
      });
    }

    // Try to click "View all guests" or similar to load more
    const viewAllButton = await page.$('button:has-text("View all"), button:has-text("See all"), [class*="guest"] button');
    if (viewAllButton) {
      await viewAllButton.click();
      await page.waitForTimeout(2000); // Wait for modal/list to load

      // Scrape guests from the expanded list
      const guestElements = await page.$$('[class*="guest-item"], [class*="attendee"], [data-testid*="guest"]');
      for (const el of guestElements) {
        const name = await el.$eval('[class*="name"], h3, h4, span', (n) => n.textContent?.trim()).catch(() => null);
        if (name && !guests.some((g) => g.name === name)) {
          const avatarUrl = await el.$eval("img", (img) => img.src).catch(() => undefined);
          guests.push({
            name,
            avatarUrl,
            isFeatured: false,
          });
        }
      }

      // Scroll to load more if virtualized
      const guestList = await page.$('[class*="guest-list"], [class*="attendee-list"], [role="list"]');
      if (guestList) {
        let prevCount = 0;
        let attempts = 0;
        while (attempts < 10) {
          await guestList.evaluate((el) => (el.scrollTop = el.scrollHeight));
          await page.waitForTimeout(500);

          const currentGuests = await page.$$('[class*="guest-item"], [class*="attendee"]');
          if (currentGuests.length === prevCount) break;
          prevCount = currentGuests.length;
          attempts++;

          // Extract new guests
          for (const el of currentGuests.slice(guests.length)) {
            const name = await el.$eval('[class*="name"], h3, h4, span', (n) => n.textContent?.trim()).catch(() => null);
            if (name && !guests.some((g) => g.name === name)) {
              const avatarUrl = await el.$eval("img", (img) => img.src).catch(() => undefined);
              guests.push({
                name,
                avatarUrl,
                isFeatured: false,
              });
            }
          }
        }
      }
    }

    await page.close();
    await saveSession();

    const result: LumaScrapedEvent = {
      apiId: eventInfo.api_id || initialData.api_id || "",
      name: eventInfo.name || "Unknown Event",
      url: eventUrl,
      date: eventInfo.start_at || initialData.start_at || "",
      location: eventInfo.geo_address_json?.full_address,
      guestCount: initialData.guest_count || guests.length,
      guests,
      scrapedAt: new Date().toISOString(),
    };

    recordIntegrationCall("luma", "scrape_event_guests", "success", endTimer());
    log(`Scraped ${guests.length} guests from "${result.name}"`);
    return result;
  } catch (error) {
    log(`Failed to scrape event: ${error instanceof Error ? error.message : String(error)}`);
    recordIntegrationCall("luma", "scrape_event_guests", "failure", endTimer());
    return null;
  }
}

/**
 * Scrape all events the user is attending and their guests
 */
export async function scrapeAllUserEventGuests(): Promise<LumaScrapedEvent[]> {
  const events = await getUserEvents();
  const results: LumaScrapedEvent[] = [];

  for (const event of events) {
    const scraped = await scrapeEventGuests(event.url);
    if (scraped) {
      results.push(scraped);
    }
    // Rate limiting - wait between requests
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return results;
}

/**
 * Close browser and cleanup
 */
export async function closeBrowser(): Promise<void> {
  if (context) {
    await saveSession();
    await context.close();
    context = null;
  }
  if (browser) {
    await browser.close();
    browser = null;
  }
}

/**
 * Match a contact name against scraped event guests
 */
export function matchContactToEvent(
  contactName: string,
  scrapedEvents: LumaScrapedEvent[],
  threshold: number = 0.7
): { event: LumaScrapedEvent; guest: LumaScrapedGuest; similarity: number } | null {
  const normalize = (s: string) => s.toLowerCase().trim();
  const contactNorm = normalize(contactName);

  let bestMatch: { event: LumaScrapedEvent; guest: LumaScrapedGuest; similarity: number } | null = null;

  for (const event of scrapedEvents) {
    for (const guest of event.guests) {
      const guestNorm = normalize(guest.name);

      // Calculate similarity (simple approach - can use Jaro-Winkler from client.ts)
      let similarity = 0;

      // Exact match
      if (contactNorm === guestNorm) {
        similarity = 1;
      }
      // Contains match
      else if (contactNorm.includes(guestNorm) || guestNorm.includes(contactNorm)) {
        similarity = 0.85;
      }
      // First name match
      else {
        const contactFirst = contactNorm.split(" ")[0];
        const guestFirst = guestNorm.split(" ")[0];
        if (contactFirst === guestFirst && contactFirst.length > 2) {
          similarity = 0.7;
        }
      }

      if (similarity >= threshold && (!bestMatch || similarity > bestMatch.similarity)) {
        bestMatch = { event, guest, similarity };
      }
    }
  }

  return bestMatch;
}
