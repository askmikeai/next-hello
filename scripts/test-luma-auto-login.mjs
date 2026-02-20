#!/usr/bin/env node
/**
 * Automated Luma Login Test
 *
 * Uses the email reader to automatically fetch OTP codes from Gmail.
 * This demonstrates the full automated flow:
 *   1. Trigger Luma login (sends OTP to email)
 *   2. Read OTP from Gmail inbox
 *   3. Submit OTP to complete login
 *
 * Usage:
 *   node scripts/test-luma-auto-login.mjs
 */

import { config } from "dotenv";
config();

import { chromium } from "playwright";
import Imap from "imap";
import { simpleParser } from "mailparser";
import { google } from "googleapis";
import * as fs from "fs";
import * as path from "path";

const LUMA_BASE_URL = "https://lu.ma";
const SESSION_FILE = path.join(process.cwd(), "data", "luma-session.json");
const GMAIL_USER = process.env.GMAIL_USER;

// Ensure data directory exists
function ensureDataDir() {
  const dataDir = path.dirname(SESSION_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

// Get Gmail access token
async function getGmailAccessToken() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    "https://developers.google.com/oauthplayground"
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.GMAIL_REFRESH_TOKEN,
  });

  const { token } = await oauth2Client.getAccessToken();
  return token;
}

// Read latest Luma OTP from Gmail (only emails after minDate)
async function getLatestLumaOtp(minDate) {
  console.log("  Connecting to Gmail IMAP...");
  const accessToken = await getGmailAccessToken();

  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: GMAIL_USER,
      xoauth2: Buffer.from(
        `user=${GMAIL_USER}\x01auth=Bearer ${accessToken}\x01\x01`
      ).toString("base64"),
      host: "imap.gmail.com",
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
    });

    imap.once("ready", () => {
      imap.openBox("INBOX", true, (err, box) => {
        if (err) {
          reject(err);
          return;
        }

        // Search for recent Luma emails
        const searchCriteria = [
          ["FROM", "support@luma.com"],
          ["SUBJECT", "sign-in code"],
        ];

        imap.search(searchCriteria, (err, results) => {
          if (err) {
            reject(err);
            return;
          }

          if (results.length === 0) {
            imap.end();
            resolve(null);
            return;
          }

          // Get the last few emails to find one after minDate
          const recentUids = results.slice(-5); // Check last 5
          const fetch = imap.fetch(recentUids, { bodies: "" });
          const emails = [];

          fetch.on("message", (msg) => {
            let buffer = "";
            msg.on("body", (stream) => {
              stream.on("data", (chunk) => {
                buffer += chunk.toString("utf8");
              });
            });

            msg.once("end", async () => {
              try {
                const parsed = await simpleParser(buffer);
                const subject = parsed.subject || "";
                const emailDate = parsed.date;

                // Extract 6-digit code from subject
                const match = subject.match(/^(\d{6})\s+is your Luma/);
                if (match && emailDate) {
                  emails.push({
                    code: match[1],
                    subject,
                    date: emailDate,
                  });
                }
              } catch (e) {
                // Skip this email
              }
            });
          });

          fetch.once("error", reject);
          fetch.once("end", () => {
            imap.end();

            // Sort by date descending
            emails.sort((a, b) => b.date.getTime() - a.date.getTime());

            // Find the most recent email that arrived AFTER minDate
            const minTime = minDate.getTime();
            const validEmails = emails.filter(e => e.date.getTime() > minTime);

            console.log(`  Total Luma OTP emails found: ${emails.length}`);
            if (emails.length > 0) {
              console.log(`  Latest email date: ${emails[0].date.toISOString()}`);
              console.log(`  Looking for emails after: ${minDate.toISOString()}`);
              console.log(`  Valid (after minDate): ${validEmails.length}`);
            }

            if (validEmails.length > 0) {
              const latest = validEmails[0];
              console.log(`  Found OTP email from ${latest.date.toISOString()}`);
              resolve(latest);
            } else {
              resolve(null);
            }
          });
        });
      });
    });

    imap.once("error", reject);
    imap.connect();
  });
}

// Wait for OTP with polling
async function waitForLumaOtp(sinceDate, timeoutMs = 120000, pollMs = 5000) {
  const startTime = Date.now();
  console.log("  Waiting for Luma OTP email...");

  while (Date.now() - startTime < timeoutMs) {
    const otp = await getLatestLumaOtp(sinceDate);
    if (otp) {
      return otp;
    }
    console.log(`  No OTP yet, checking again in ${pollMs / 1000}s...`);
    await new Promise((r) => setTimeout(r, pollMs));
  }

  return null;
}

// Main automated login flow
async function automatedLumaLogin() {
  console.log("=".repeat(60));
  console.log("Automated Luma Login");
  console.log("=".repeat(60));
  console.log();

  if (!GMAIL_USER) {
    console.error("GMAIL_USER not set in .env");
    process.exit(1);
  }

  ensureDataDir();

  // Record the time before triggering login (for email filtering)
  const beforeLoginTime = new Date();
  beforeLoginTime.setMinutes(beforeLoginTime.getMinutes() - 1); // 1 minute buffer

  console.log("[1] Starting Browser");
  console.log("-".repeat(40));

  const browser = await chromium.launch({
    headless: true, // Run headlessly for automation
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  try {
    console.log("  Navigating to Luma signin...");
    await page.goto(`${LUMA_BASE_URL}/signin`, { waitUntil: "networkidle" });

    console.log(`  Entering email: ${GMAIL_USER}`);
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]');
    await emailInput.fill(GMAIL_USER);

    console.log("  Submitting email to trigger OTP...");
    const submitButton = page.getByRole('button', { name: 'Continue with Email' });
    await submitButton.click();

    // Wait for OTP input to appear (confirms email was accepted)
    console.log("  Waiting for OTP input field...");
    await page.waitForSelector('input[inputmode="numeric"], input[autocomplete="one-time-code"]', {
      timeout: 30000,
    });
    console.log("  OTP input appeared - email sent!");

    console.log();
    console.log("[2] Fetching OTP from Gmail");
    console.log("-".repeat(40));

    // Wait for OTP email to arrive
    const otp = await waitForLumaOtp(beforeLoginTime);

    if (!otp) {
      console.error("  Failed to get OTP from email. Timeout.");
      await browser.close();
      process.exit(1);
    }

    console.log(`  Got OTP: ${otp.code}`);
    console.log(`  From email: "${otp.subject}"`);

    console.log();
    console.log("[3] Entering OTP");
    console.log("-".repeat(40));

    // Enter OTP code
    const otpInputs = page.locator('input[inputmode="numeric"], input[autocomplete="one-time-code"]');
    const inputCount = await otpInputs.count();
    console.log(`  Found ${inputCount} OTP input(s)`);

    if (inputCount === 1) {
      // Single input field
      await otpInputs.fill(otp.code);
    } else if (inputCount >= 6) {
      // Six separate digit inputs - type each digit with small delay
      for (let i = 0; i < 6; i++) {
        await otpInputs.nth(i).fill(otp.code[i]);
        await page.waitForTimeout(100);
      }
    }

    // Wait a moment for the form to auto-submit
    console.log("  OTP entered, waiting for auto-submit...");
    await page.waitForTimeout(2000);

    // Check current URL
    const currentUrl = page.url();
    console.log(`  Current URL: ${currentUrl}`);

    // If not already on home, wait for redirect
    if (!currentUrl.includes("/home")) {
      console.log("  Waiting for redirect to /home...");
      try {
        await page.waitForURL((url) => url.pathname === "/home" || url.pathname.startsWith("/home"), {
          timeout: 30000,
        });
      } catch (e) {
        // Check if we're on a different success page
        const finalUrl = page.url();
        console.log(`  Final URL: ${finalUrl}`);
        if (finalUrl.includes("signin")) {
          // Still on signin - something went wrong
          const pageContent = await page.textContent("body");
          if (pageContent.includes("expired") || pageContent.includes("invalid")) {
            throw new Error("OTP expired or invalid");
          }
          throw new Error("Still on signin page after OTP entry");
        }
      }
    }

    console.log("  Login successful!");

    // Save session
    console.log();
    console.log("[4] Saving Session");
    console.log("-".repeat(40));

    const state = await context.storageState();
    fs.writeFileSync(SESSION_FILE, JSON.stringify(state, null, 2));
    console.log(`  Session saved to: ${SESSION_FILE}`);

    // Verify by getting user events
    console.log();
    console.log("[5] Verification - Getting User Events");
    console.log("-".repeat(40));

    await page.goto(`${LUMA_BASE_URL}/home`, { waitUntil: "networkidle" });
    const pageContent = await page.textContent("body");

    if (pageContent.includes("Upcoming")) {
      console.log("  Verified: Can see Upcoming events tab");
    }

    // Count events
    const eventLinks = page.locator('a[href^="/"]');
    const linkCount = await eventLinks.count();
    console.log(`  Found ${linkCount} links on home page`);

    await browser.close();

    console.log();
    console.log("=".repeat(60));
    console.log("SUCCESS: Automated login complete!");
    console.log("=".repeat(60));
    console.log();
    console.log("You can now run the full test:");
    console.log("  node scripts/test-luma-scraper.mjs");
    console.log();
  } catch (error) {
    console.error();
    console.error("Error:", error.message);
    await browser.close();
    process.exit(1);
  }
}

automatedLumaLogin();
