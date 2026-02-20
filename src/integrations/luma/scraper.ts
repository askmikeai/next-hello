/**
 * Luma Browser Scraper
 *
 * Uses Playwright to scrape event attendees from Luma with authenticated session.
 * Validated against live events on 2026-02-19.
 *
 * Key findings:
 * - __NEXT_DATA__ does NOT contain guest list (loaded client-side)
 * - Must click "X others" to open guest modal
 * - Social handles are inline in list rows
 * - Login is email OTP only (no password/OAuth)
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { recordIntegrationCall, startTimer } from "../../observability/metrics.js";

const LUMA_BASE_URL = "https://lu.ma";
const SESSION_FILE = path.join(process.cwd(), "data", "luma-session.json");

export interface LumaScrapedGuest {
  name: string;
  lumaProfile: string;
  instagram?: string;
  twitter?: string;
  eventSlug?: string;
  eventName?: string;
}

export interface LumaEventHost {
  name: string;
  lumaProfile?: string;
  avatarUrl?: string;
}

export interface LumaScrapedEvent {
  slug: string;
  name: string;
  url: string;
  date?: string;
  endDate?: string;
  timezone?: string;
  location?: string;
  locationAddress?: string;
  isOnline?: boolean;
  description?: string;
  coverImageUrl?: string;
  hosts: LumaEventHost[];
  guestCount: number;
  guests: LumaScrapedGuest[];
  scrapedAt: string;
}

export interface LumaUserEvent {
  slug: string;
  name: string;
  url: string;
  date?: string;
  guestCount?: number;
  tab: "upcoming" | "past";
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
 * Check if currently logged in by visiting home page
 */
async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    await page.goto(`${LUMA_BASE_URL}/home`, { waitUntil: "networkidle" });
    // If we're redirected to signin, we're not logged in
    const url = page.url();
    if (url.includes("signin")) {
      return false;
    }
    // Check for user-specific content on home page
    const hasEvents = await page.locator('text="Upcoming"').count() > 0;
    return hasEvents;
  } catch {
    return false;
  }
}

/**
 * Login to Luma via email OTP
 * Opens visible browser for user to enter email and OTP code
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

    log("Please enter your email in the browser window...");
    log("Luma will send a 6-digit OTP to your email.");
    log("Enter the OTP code to complete login.");
    log("Waiting for login to complete (redirect to /home)...");

    // Wait for successful login (redirect to home page)
    await page.waitForURL((url) => url.pathname === "/home" || url.pathname.startsWith("/home"), {
      timeout: 300000, // 5 minute timeout for manual login + OTP
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
 * Login with OTP code (for automated flow with email agent)
 */
export async function loginWithOtp(email: string, otpCode: string): Promise<boolean> {
  const endTimer = startTimer();

  const ctx = await initBrowser();
  const page = await ctx.newPage();

  try {
    log(`Logging in with email: ${email}`);
    await page.goto(`${LUMA_BASE_URL}/signin`, { waitUntil: "networkidle" });

    // Enter email
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]');
    await emailInput.fill(email);

    // Submit email
    const submitButton = page.locator('button[type="submit"], button:has-text("Continue"), button:has-text("Sign in")');
    await submitButton.click();

    // Wait for OTP input to appear
    await page.waitForSelector('input[inputmode="numeric"], input[autocomplete="one-time-code"]', { timeout: 10000 });

    // Enter OTP code
    log(`Entering OTP code: ${otpCode}`);
    const otpInputs = page.locator('input[inputmode="numeric"], input[autocomplete="one-time-code"]');
    const inputCount = await otpInputs.count();

    if (inputCount === 1) {
      // Single input field
      await otpInputs.fill(otpCode);
    } else if (inputCount === 6) {
      // Six separate digit inputs
      for (let i = 0; i < 6; i++) {
        await otpInputs.nth(i).fill(otpCode[i]);
      }
    }

    // Wait for redirect to home
    await page.waitForURL((url) => url.pathname === "/home" || url.pathname.startsWith("/home"), {
      timeout: 30000,
    });

    await saveSession();
    await page.close();

    recordIntegrationCall("luma", "login_otp", "success", endTimer());
    log("Login with OTP successful");
    return true;
  } catch (error) {
    log(`Login with OTP failed: ${error instanceof Error ? error.message : String(error)}`);
    recordIntegrationCall("luma", "login_otp", "failure", endTimer());
    await page.close();
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
    const loggedIn = await isLoggedIn(page);
    await page.close();
    return loggedIn;
  } catch {
    return false;
  }
}

/**
 * Get user's events from /home page
 */
export async function getUserEvents(): Promise<LumaUserEvent[]> {
  const endTimer = startTimer();
  const events: LumaUserEvent[] = [];

  try {
    const ctx = await initBrowser();
    const page = await ctx.newPage();

    // Extract events from Upcoming tab
    log("Getting upcoming events from /home...");
    await page.goto(`${LUMA_BASE_URL}/home`, { waitUntil: "networkidle" });

    // Check if logged in
    if (page.url().includes("signin")) {
      log("Not logged in - cannot get events");
      await page.close();
      return events;
    }

    await page.waitForTimeout(1000); // Let JS render cards
    const upcomingEvents = await extractEventsFromTab(page, "upcoming");
    events.push(...upcomingEvents);

    // Navigate to Past tab via URL (more reliable than clicking)
    log("Getting past events...");
    await page.goto(`${LUMA_BASE_URL}/home?period=past`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const pastEvents = await extractEventsFromTab(page, "past");
    events.push(...pastEvents);

    await page.close();
    await saveSession();

    // Deduplicate by slug
    const seen = new Set<string>();
    const unique = events.filter(e => {
      if (seen.has(e.slug)) return false;
      seen.add(e.slug);
      return true;
    });

    recordIntegrationCall("luma", "get_user_events", "success", endTimer());
    log(`Found ${unique.length} events`);
    return unique;
  } catch (error) {
    log(`Failed to get user events: ${error instanceof Error ? error.message : String(error)}`);
    recordIntegrationCall("luma", "get_user_events", "failure", endTimer());
    return events;
  }
}

/**
 * Extract events from current tab on /home page
 *
 * Event cards contain <a href="/{slug}"> links. We find all links
 * and filter to only include valid event slugs (single path segment,
 * not a navigation path).
 */
async function extractEventsFromTab(page: Page, tab: "upcoming" | "past"): Promise<LumaUserEvent[]> {
  const events: LumaUserEvent[] = [];

  // Navigation paths that are NOT event slugs
  const NAV_PATHS = new Set([
    "/home", "/discover", "/create", "/pricing",
    "/home/calendars", "/ios", "/android", "/", ""
  ]);
  const NAV_PREFIXES = ["/user/", "/ai", "/claw", "/maps", "/settings", "/help"];

  // Find all links that might be event cards
  const allLinks = page.locator('a[href^="/"]');
  const count = await allLinks.count();

  for (let i = 0; i < count; i++) {
    try {
      const link = allLinks.nth(i);
      const href = await link.getAttribute("href");
      if (!href) continue;

      // Strip query params
      const cleanHref = href.split("?")[0];

      // Skip navigation links
      if (NAV_PATHS.has(cleanHref)) continue;
      if (NAV_PREFIXES.some(prefix => cleanHref.startsWith(prefix))) continue;

      // Event slugs are a single path segment: /slug (no sub-paths)
      // Count slashes - should be exactly 1 (the leading slash)
      if ((cleanHref.match(/\//g) || []).length !== 1) continue;

      const slug = cleanHref.replace("/", "");

      // Event slugs are typically 8 alphanumeric characters
      if (!slug || slug.length < 6 || slug.length > 20) continue;
      // Skip if it doesn't look like an event slug (alphanumeric only)
      if (!/^[a-z0-9]+$/i.test(slug)) continue;

      // Check if we already have this event
      if (events.some(e => e.slug === slug)) continue;

      // Get event name - look for heading or text content
      let name = "";
      const heading = link.locator("h1, h2, h3, h4").first();
      if (await heading.count() > 0) {
        name = (await heading.textContent() || "").trim();
      }
      if (!name) {
        const text = await link.textContent() || "";
        // First meaningful line (skip empty lines)
        const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 3);
        name = lines[0] || slug;
      }

      // Try to extract guest count
      let guestCount: number | undefined;
      try {
        const parent = link.locator("xpath=..");
        const fullText = await parent.textContent() || "";
        // Look for patterns like "42 Going" or "Going" followed by count
        const countMatch = fullText.match(/(\d+)\s*(?:Going|going|guests?)/i);
        if (countMatch) {
          guestCount = parseInt(countMatch[1], 10);
        }
      } catch {
        // Guest count extraction is optional
      }

      events.push({
        slug,
        name,
        url: `${LUMA_BASE_URL}/${slug}`,
        guestCount,
        tab,
      });

      log(`Found event: ${name} (${slug})`);
    } catch {
      // Skip this link
    }
  }

  return events;
}

/**
 * Extract plain text from ProseMirror document structure
 */
function extractTextFromProseMirror(doc: unknown): string {
  if (!doc || typeof doc !== "object") return "";

  const docObj = doc as { type?: string; content?: unknown[]; text?: string };
  const parts: string[] = [];

  function extractText(node: unknown): void {
    if (!node || typeof node !== "object") return;

    const n = node as { type?: string; content?: unknown[]; text?: string };
    if (n.type === "text" && n.text) {
      parts.push(n.text);
    }
    if (Array.isArray(n.content)) {
      for (const child of n.content) {
        extractText(child);
      }
      // Add paragraph breaks
      if (n.type === "paragraph" || n.type === "heading") {
        parts.push("\n\n");
      }
    }
  }

  extractText(docObj);
  return parts.join("").trim();
}

/**
 * Extract event details from __NEXT_DATA__ (available without modal)
 */
async function extractEventDetails(page: Page): Promise<{
  date?: string;
  endDate?: string;
  timezone?: string;
  location?: string;
  locationAddress?: string;
  isOnline?: boolean;
  description?: string;
  coverImageUrl?: string;
  hosts: LumaEventHost[];
}> {
  const details: {
    date?: string;
    endDate?: string;
    timezone?: string;
    location?: string;
    locationAddress?: string;
    isOnline?: boolean;
    description?: string;
    coverImageUrl?: string;
    hosts: LumaEventHost[];
  } = { hosts: [] };

  try {
    // Try to extract from __NEXT_DATA__ script
    const nextDataScript = await page.locator('script#__NEXT_DATA__').textContent();
    if (nextDataScript) {
      const nextData = JSON.parse(nextDataScript);
      // Luma structure: props.pageProps.initialData.data contains the event info
      const pageData = nextData?.props?.pageProps?.initialData?.data;
      const event = pageData?.event;

      if (event) {
        // Date/time info
        details.date = event.start_at;
        details.endDate = event.end_at;
        details.timezone = event.timezone;

        // Cover image
        details.coverImageUrl = event.cover_url;

        // Location
        if (event.geo_address_info) {
          const loc = event.geo_address_info;
          details.location = loc.address || loc.city;
          details.locationAddress = loc.full_address;
        }
        details.isOnline = event.location_type === "online" || event.event_type === "online";
      }

      // Description is in description_mirror at pageData level (ProseMirror format)
      if (pageData?.description_mirror) {
        details.description = extractTextFromProseMirror(pageData.description_mirror);
      }

      // Hosts are at pageData level
      const hosts = pageData?.hosts || [];
      for (const host of hosts) {
        const username = host.username || host.api_id;
        details.hosts.push({
          name: host.name,
          lumaProfile: username ? `${LUMA_BASE_URL}/user/${username}` : undefined,
          avatarUrl: host.avatar_url,
        });
      }
    }
  } catch (e) {
    log(`Could not extract from __NEXT_DATA__: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Fallback: scrape from visible page elements if __NEXT_DATA__ didn't have it
  if (!details.description) {
    try {
      // Description is usually in a specific container
      const descEl = page.locator('[class*="description"], [class*="about"], .event-description, p.text-gray-600').first();
      if (await descEl.count() > 0) {
        details.description = (await descEl.textContent())?.trim();
      }
    } catch { /* ignore */ }
  }

  if (details.hosts.length === 0) {
    try {
      // Try to extract hosts from the page
      const hostLinks = page.locator('a[href^="/user/"]').filter({
        has: page.locator('[class*="host"], [class*="organizer"]'),
      });
      const hostCount = await hostLinks.count();
      for (let i = 0; i < Math.min(hostCount, 5); i++) {
        const link = hostLinks.nth(i);
        const href = await link.getAttribute("href");
        const img = link.locator("img").first();
        let name = "";
        let avatarUrl: string | undefined;

        if (await img.count() > 0) {
          const alt = await img.getAttribute("alt");
          avatarUrl = (await img.getAttribute("src")) || undefined;
          if (alt) name = alt.replace(/^Profile picture for /i, "").trim();
        }
        if (!name) name = (await link.textContent() || "").trim();

        if (name) {
          details.hosts.push({
            name,
            lumaProfile: href ? `${LUMA_BASE_URL}${href}` : undefined,
            avatarUrl,
          });
        }
      }
    } catch { /* ignore */ }
  }

  if (!details.date) {
    try {
      // Try to find date from page elements
      const dateEl = page.locator('[class*="date"], time, [datetime]').first();
      if (await dateEl.count() > 0) {
        details.date = (await dateEl.getAttribute("datetime")) || (await dateEl.textContent())?.trim();
      }
    } catch { /* ignore */ }
  }

  if (!details.location) {
    try {
      const locEl = page.locator('[class*="location"], [class*="venue"], [class*="address"]').first();
      if (await locEl.count() > 0) {
        details.location = (await locEl.textContent())?.trim();
      }
    } catch { /* ignore */ }
  }

  if (!details.coverImageUrl) {
    try {
      const coverImg = page.locator('img[class*="cover"], img[class*="banner"], img[class*="hero"]').first();
      if (await coverImg.count() > 0) {
        details.coverImageUrl = (await coverImg.getAttribute("src")) || undefined;
      }
    } catch { /* ignore */ }
  }

  return details;
}

/**
 * Extract a person's info from a user profile link element
 */
async function extractPersonFromLink(
  link: ReturnType<Page["locator"]>,
  page: Page,
  eventSlug: string,
  eventName: string
): Promise<LumaScrapedGuest | null> {
  try {
    const href = await link.getAttribute("href");
    if (!href || !href.startsWith("/user/")) return null;

    // Get name from img alt or aria-label or text content
    let name = "";
    const ariaLabel = await link.getAttribute("aria-label");
    if (ariaLabel) {
      name = ariaLabel.replace(/^Profile picture for /i, "").trim();
    }

    if (!name) {
      const img = link.locator("img").first();
      if (await img.count() > 0) {
        const alt = await img.getAttribute("alt");
        if (alt) {
          name = alt.replace(/^Profile picture for /i, "").trim();
        }
      }
    }

    if (!name) {
      // Try span or div text
      const textEl = link.locator("span, div").first();
      if (await textEl.count() > 0) {
        name = (await textEl.textContent() || "").trim();
      }
    }

    if (!name) {
      name = (await link.textContent() || "").trim();
    }

    if (!name) return null;

    // Look for social links in the parent row
    const parent = link.locator("..").first();
    let instagram: string | undefined;
    let twitter: string | undefined;

    const instaLink = parent.locator('a[href*="instagram.com"]');
    if (await instaLink.count() > 0) {
      instagram = await instaLink.getAttribute("href") || undefined;
    }

    const twitterLink = parent.locator('a[href*="x.com"], a[href*="twitter.com"]');
    if (await twitterLink.count() > 0) {
      twitter = await twitterLink.getAttribute("href") || undefined;
    }

    return {
      name,
      lumaProfile: `${LUMA_BASE_URL}${href}`,
      instagram,
      twitter,
      eventSlug,
      eventName,
    };
  } catch {
    return null;
  }
}

/**
 * Scrape all guests from an event page
 * Separates hosts (from sidebar) from guests (from modal)
 */
export async function scrapeEventGuests(eventUrlOrSlug: string): Promise<LumaScrapedEvent | null> {
  const endTimer = startTimer();

  // Handle both full URL and slug
  const eventUrl = eventUrlOrSlug.startsWith("http")
    ? eventUrlOrSlug
    : `${LUMA_BASE_URL}/${eventUrlOrSlug}`;
  const slug = eventUrl.replace(LUMA_BASE_URL + "/", "").split("/")[0].split("?")[0];

  try {
    const ctx = await initBrowser();
    const page = await ctx.newPage();

    log(`Scraping event: ${eventUrl}`);
    await page.goto(eventUrl, { waitUntil: "networkidle" });

    // Get event name from page title or h1
    const eventName = await page.locator("h1").first().textContent() || slug;

    // Extract event details from __NEXT_DATA__ (description, date, location, etc.)
    const eventDetails = await extractEventDetails(page);

    // =========================================================================
    // STEP 1: Scrape hosts from "Hosted By" sidebar BEFORE opening modal
    // =========================================================================
    log("Scraping hosts from sidebar...");
    const hostProfiles = new Set<string>();

    // Hosts come from eventDetails (extracted from __NEXT_DATA__)
    // Mark their profiles so we can deduplicate later
    for (const host of eventDetails.hosts) {
      if (host.lumaProfile) {
        hostProfiles.add(host.lumaProfile);
      }
    }
    log(`Found ${eventDetails.hosts.length} hosts`);

    // =========================================================================
    // STEP 2: Click attendee button to open guest modal
    // =========================================================================
    log("Looking for guest list trigger...");

    // Try different selectors for the attendee button
    // The clickable element is usually the row of avatar circles or "See all guests" link
    // First, let's find the "Going" section and look for clickable elements within it

    // Look for avatar stack/row - this is often what you click to see all guests
    const avatarStack = page.locator('[class*="avatar-stack"], [class*="AvatarStack"], [class*="avatars"]').first();
    const avatarStackExists = await avatarStack.count() > 0;

    // Also look for "See all" or similar links
    const seeAllLink = page.getByText(/see all|view all|show all/i).first();
    const seeAllExists = await seeAllLink.count() > 0;

    // Try various selectors for the clickable guest list opener
    const othersButton = page.getByText(/and \d+ others/i).or(
      page.getByText(/\+\d+/i) // "+297" style
    ).or(
      page.locator('[class*="guest-count"], [class*="attendee-count"]')
    );

    let buttonCount = await othersButton.count();

    // If no "and X others" style button, try avatar stack
    let clickTarget = othersButton.first();
    if (buttonCount === 0 && avatarStackExists) {
      log("Trying avatar stack as click target");
      clickTarget = avatarStack;
      buttonCount = 1;
    }
    if (buttonCount === 0 && seeAllExists) {
      log("Trying 'See all' link as click target");
      clickTarget = seeAllLink;
      buttonCount = 1;
    }

    // Log what button we're clicking
    if (buttonCount > 0) {
      const buttonText = await clickTarget.textContent();
      log(`Clicking guest button: "${buttonText?.substring(0, 50)}"`);
    }

    if (buttonCount === 0) {
      log("No guest list button found - event may be private or have no visible guests");
      await page.close();
      return {
        slug,
        name: eventName.trim(),
        url: eventUrl,
        date: eventDetails.date,
        endDate: eventDetails.endDate,
        timezone: eventDetails.timezone,
        location: eventDetails.location,
        locationAddress: eventDetails.locationAddress,
        isOnline: eventDetails.isOnline,
        description: eventDetails.description,
        coverImageUrl: eventDetails.coverImageUrl,
        hosts: eventDetails.hosts,
        guestCount: 0,
        guests: [],
        scrapedAt: new Date().toISOString(),
      };
    }

    // Click to open guest modal - use dispatchEvent for more reliable click
    const urlBefore = page.url();

    // Try to click using JavaScript for more reliable results
    await clickTarget.evaluate((el) => {
      // Scroll element into view first
      el.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(500);

    // Click using Playwright
    await clickTarget.click({ force: true });
    log("Waiting for guest modal...");

    // Wait for modal to appear
    await page.waitForTimeout(3000);

    // Check how many user links are now visible (modal should have loaded)
    const initialUserLinks = await page.$$eval('a[href^="/user/"]', links => links.length);
    log(`Modal opened with ${initialUserLinks} user links visible`);

    // Wait for guest list to load - try to find them within a dialog or overlay
    await page.waitForSelector('[role="dialog"] a[href^="/user/"], [class*="drawer"] a[href^="/user/"], [class*="overlay"] a[href^="/user/"]', { timeout: 10000 }).catch(() => {
      log("No guest links found in modal/drawer/overlay");
    });

    // =========================================================================
    // STEP 3: Scroll modal to load ALL virtualized guests
    // =========================================================================
    const guests: LumaScrapedGuest[] = [];
    const seenProfiles = new Set<string>();

    // Wait for modal content to fully load
    await page.waitForTimeout(1000);

    // Find and scroll the modal container using JavaScript
    // Luma uses a virtualized list - find the scrollable container
    const scrolled = await page.evaluate(() => {
      // Find ANY scrollable element with reasonable height
      const allElements = Array.from(document.querySelectorAll('*'));
      for (const el of allElements) {
        const style = window.getComputedStyle(el);
        const htmlEl = el as HTMLElement;
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
            htmlEl.scrollHeight > htmlEl.clientHeight + 100) {
          // Found scrollable element - reset scroll
          htmlEl.scrollTop = 0;
          return { found: true, height: el.scrollHeight, className: (el as HTMLElement).className };
        }
      }
      return { found: false };
    });

    if (scrolled.found) {
      log(`Found scrollable container: height=${scrolled.height}`);
    } else {
      log("No scrollable container found, trying page scroll");
    }

    log("Scrolling to load all guests...");

    // Scroll to the bottom to load all virtualized content
    // Keep scrolling until we reach the bottom, regardless of link count
    let scrollAttempts = 0;
    const maxScrollAttempts = 50;

    while (scrollAttempts < maxScrollAttempts) {
      scrollAttempts++;

      // Scroll
      const scrollResult = await page.evaluate(() => {
        const allElements = Array.from(document.querySelectorAll('*'));
        let bestCandidate: HTMLElement | null = null;
        let bestDiff = 0;

        for (const el of allElements) {
          const htmlEl = el as HTMLElement;
          const style = window.getComputedStyle(el);
          const diff = htmlEl.scrollHeight - htmlEl.clientHeight;
          const classNameStr = typeof htmlEl.className === 'string' ? htmlEl.className : '';

          if ((style.overflowY === 'auto' || style.overflowY === 'scroll' ||
               classNameStr.includes('overflow-auto')) &&
              diff > 100 && diff > bestDiff) {
            bestCandidate = htmlEl;
            bestDiff = diff;
          }
        }

        if (bestCandidate) {
          const prevTop = bestCandidate.scrollTop;
          const maxScroll = bestCandidate.scrollHeight - bestCandidate.clientHeight;
          bestCandidate.scrollTop += 500; // Smaller increments for better virtualization
          return {
            scrolled: bestCandidate.scrollTop !== prevTop,
            scrollTop: bestCandidate.scrollTop,
            scrollHeight: bestCandidate.scrollHeight,
            maxScroll,
            atBottom: bestCandidate.scrollTop >= maxScroll - 10
          };
        }
        return { scrolled: false, atBottom: true };
      });

      // Log progress every 10 scrolls
      if (scrollAttempts % 10 === 0) {
        log(`Scrolling... (attempt ${scrollAttempts})`);
      }

      // Stop if we've reached the bottom
      if (scrollResult.atBottom) {
        log(`Reached bottom after ${scrollAttempts} scrolls (scrollTop: ${scrollResult.scrollTop})`);
        break;
      }

      // Wait for virtualized list to render
      await page.waitForTimeout(600);
    }

    // Final count after all scrolling
    const finalLinkCount = await page.$$eval('a[href^="/user/"]', links => links.length);
    log(`Scroll complete. Final link count: ${finalLinkCount}`);

    // Scroll back to top and extract while scrolling through
    // This ensures we catch all elements in the virtualized list
    await page.evaluate(() => {
      const allElements = Array.from(document.querySelectorAll('*'));
      for (const el of allElements) {
        const htmlEl = el as HTMLElement;
        const style = window.getComputedStyle(el);
        const classNameStr = typeof htmlEl.className === 'string' ? htmlEl.className : '';
        if ((style.overflowY === 'auto' || classNameStr.includes('overflow-auto')) &&
            htmlEl.scrollHeight > htmlEl.clientHeight + 100) {
          htmlEl.scrollTop = 0;
          break;
        }
      }
    });
    await page.waitForTimeout(500);

    // Extract profiles while scrolling through
    let extractionScrolls = 0;
    const maxExtractionScrolls = 50;

    while (extractionScrolls < maxExtractionScrolls) {
      extractionScrolls++;

      // Extract current visible links
      const guestLinks = await page.$$('a[href^="/user/"]');

      for (const link of guestLinks) {
      try {
        const href = await link.getAttribute("href");
        if (!href || seenProfiles.has(href)) continue;

        seenProfiles.add(href);

        // Get name from aria-label, img alt, or text content
        let name = "";
        const ariaLabel = await link.getAttribute("aria-label");
        if (ariaLabel) {
          name = ariaLabel.replace(/^Profile picture for /i, "").trim();
        }

        if (!name) {
          const img = await link.$("img");
          if (img) {
            const alt = await img.getAttribute("alt");
            if (alt) {
              name = alt.replace(/^Profile picture for /i, "").trim();
            }
          }
        }

        if (!name) {
          name = (await link.textContent() || "").trim();
        }

        if (!name) continue;

        // Look for social links in parent row
        const parent = await link.$("xpath=..");
        let instagram: string | undefined;
        let twitter: string | undefined;

        if (parent) {
          const instaLink = await parent.$('a[href*="instagram.com"]');
          if (instaLink) {
            instagram = await instaLink.getAttribute("href") || undefined;
          }

          const twitterLink = await parent.$('a[href*="x.com"], a[href*="twitter.com"]');
          if (twitterLink) {
            twitter = await twitterLink.getAttribute("href") || undefined;
          }
        }

        guests.push({
          name,
          lumaProfile: `${LUMA_BASE_URL}${href}`,
          instagram,
          twitter,
          eventSlug: slug,
          eventName: eventName.trim(),
        });
      } catch {
        // Skip this link
      }
      }

      // Log extraction progress every 10 scrolls
      if (extractionScrolls % 10 === 0 && extractionScrolls > 0) {
        log(`Extracting... ${seenProfiles.size} profiles found`);
      }

      // Scroll down for next batch
      const scrollResult = await page.evaluate(() => {
        const allElements = Array.from(document.querySelectorAll('*'));
        for (const el of allElements) {
          const htmlEl = el as HTMLElement;
          const style = window.getComputedStyle(el);
          const classNameStr = typeof htmlEl.className === 'string' ? htmlEl.className : '';
          if ((style.overflowY === 'auto' || classNameStr.includes('overflow-auto')) &&
              htmlEl.scrollHeight > htmlEl.clientHeight + 100) {
            const maxScroll = htmlEl.scrollHeight - htmlEl.clientHeight;
            htmlEl.scrollTop += 400;
            return { atBottom: htmlEl.scrollTop >= maxScroll - 10 };
          }
        }
        return { atBottom: true };
      });

      if (scrollResult.atBottom) {
        log(`Extraction complete - reached bottom after ${extractionScrolls} scrolls`);
        break;
      }

      await page.waitForTimeout(400);
    }

    log(`Extracted ${guests.length} profiles, ${seenProfiles.size} unique`);

    // =========================================================================
    // STEP 4: Deduplicate - remove hosts from guest list
    // =========================================================================
    const guestsOnly = guests.filter(g => !hostProfiles.has(g.lumaProfile));
    log(`Total profiles: ${guests.length}, After removing hosts: ${guestsOnly.length}`);

    await page.close();
    await saveSession();

    const result: LumaScrapedEvent = {
      slug,
      name: eventName.trim(),
      url: eventUrl,
      date: eventDetails.date,
      endDate: eventDetails.endDate,
      timezone: eventDetails.timezone,
      location: eventDetails.location,
      locationAddress: eventDetails.locationAddress,
      isOnline: eventDetails.isOnline,
      description: eventDetails.description,
      coverImageUrl: eventDetails.coverImageUrl,
      hosts: eventDetails.hosts,
      guestCount: guestsOnly.length,
      guests: guestsOnly,
      scrapedAt: new Date().toISOString(),
    };

    recordIntegrationCall("luma", "scrape_event_guests", "success", endTimer());
    log(`Scraped ${eventDetails.hosts.length} hosts and ${guestsOnly.length} guests from "${result.name}"`);
    return result;
  } catch (error) {
    log(`Failed to scrape event: ${error instanceof Error ? error.message : String(error)}`);
    recordIntegrationCall("luma", "scrape_event_guests", "failure", endTimer());
    return null;
  }
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
 * Returns best match above threshold
 */
export function matchContactToGuests(
  contactName: string,
  guests: LumaScrapedGuest[],
  threshold: number = 0.7
): { guest: LumaScrapedGuest; score: number } | null {
  const normalize = (s: string) => s.toLowerCase().trim();
  const contactNorm = normalize(contactName);
  const contactFirst = contactNorm.split(" ")[0];

  let bestMatch: { guest: LumaScrapedGuest; score: number } | null = null;

  for (const guest of guests) {
    const guestNorm = normalize(guest.name);
    const guestWords = guestNorm.split(" ");

    let score = 0;

    // Exact match (either direction contains the other)
    if (contactNorm === guestNorm) {
      score = 1.0;
    } else if (contactNorm.includes(guestNorm) || guestNorm.includes(contactNorm)) {
      score = 0.9;
    }
    // First name matches any word in guest name
    else if (guestWords.includes(contactFirst) || guestWords[0] === contactFirst) {
      score = 0.8;
    }
    // Partial first name match (for nicknames)
    else if (contactFirst.length >= 3 && guestWords.some((w) => w.startsWith(contactFirst) || contactFirst.startsWith(w))) {
      score = 0.7;
    }

    if (score >= threshold && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { guest, score };
    }
  }

  return bestMatch;
}

/**
 * Match a contact against events and return the event where they were found
 */
export async function findContactInEvents(
  contactName: string,
  events: LumaScrapedEvent[],
  threshold: number = 0.7
): Promise<{ event: LumaScrapedEvent; guest: LumaScrapedGuest; score: number } | null> {
  for (const event of events) {
    const match = matchContactToGuests(contactName, event.guests, threshold);
    if (match) {
      return { event, ...match };
    }
  }
  return null;
}
