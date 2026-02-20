#!/usr/bin/env node
/**
 * Luma Login Test with Manual OTP
 *
 * Logs into Luma using a provided OTP code.
 * Use this when you already have the OTP from your email.
 *
 * Usage:
 *   node scripts/test-luma-with-otp.mjs 954424
 *   node scripts/test-luma-with-otp.mjs --latest  # Use latest OTP from Gmail
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

function ensureDataDir() {
  const dataDir = path.dirname(SESSION_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

async function getLatestLumaOtpFromGmail() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    "https://developers.google.com/oauthplayground"
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  const { token } = await oauth2Client.getAccessToken();

  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: GMAIL_USER,
      xoauth2: Buffer.from(`user=${GMAIL_USER}\x01auth=Bearer ${token}\x01\x01`).toString("base64"),
      host: "imap.gmail.com",
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
    });

    imap.once("ready", () => {
      imap.openBox("INBOX", true, (err, box) => {
        if (err) { reject(err); return; }

        imap.search([["FROM", "support@luma.com"], ["SUBJECT", "sign-in code"]], (err, results) => {
          if (err) { reject(err); return; }
          if (results.length === 0) { imap.end(); resolve(null); return; }

          const latestUid = results[results.length - 1];
          const fetch = imap.fetch([latestUid], { bodies: "" });

          fetch.on("message", (msg) => {
            let buffer = "";
            msg.on("body", (stream) => stream.on("data", (chunk) => buffer += chunk.toString("utf8")));
            msg.once("end", async () => {
              const parsed = await simpleParser(buffer);
              const match = (parsed.subject || "").match(/^(\d{6})\s+is your Luma/);
              imap.end();
              resolve(match ? { code: match[1], date: parsed.date } : null);
            });
          });
        });
      });
    });

    imap.once("error", reject);
    imap.connect();
  });
}

async function loginWithOtp(otpCode) {
  console.log("=".repeat(60));
  console.log(`Luma Login with OTP: ${otpCode}`);
  console.log("=".repeat(60));
  console.log();

  ensureDataDir();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  });
  const page = await context.newPage();

  try {
    console.log("[1] Navigate to signin");
    await page.goto(`${LUMA_BASE_URL}/signin`, { waitUntil: "networkidle" });

    console.log(`[2] Enter email: ${GMAIL_USER}`);
    await page.locator('input[type="email"]').fill(GMAIL_USER);

    console.log("[3] Click Continue");
    await page.getByRole("button", { name: "Continue with Email" }).click();

    console.log("[4] Wait for OTP input");
    await page.waitForSelector('input[inputmode="numeric"]', { timeout: 10000 });

    console.log(`[5] Enter OTP: ${otpCode}`);
    const otpInputs = page.locator('input[inputmode="numeric"]');
    const count = await otpInputs.count();

    if (count === 1) {
      await otpInputs.fill(otpCode);
    } else {
      for (let i = 0; i < Math.min(6, count); i++) {
        await otpInputs.nth(i).fill(otpCode[i]);
        await page.waitForTimeout(50);
      }
    }

    console.log("[6] Wait for redirect");
    await page.waitForTimeout(2000);

    const url = page.url();
    if (url.includes("/home")) {
      console.log("[7] Login successful! Saving session...");
      const state = await context.storageState();
      fs.writeFileSync(SESSION_FILE, JSON.stringify(state, null, 2));
      console.log(`    Session saved to: ${SESSION_FILE}`);

      // Quick verification
      console.log("\n[8] Verification");
      const content = await page.textContent("body");
      if (content.includes("Upcoming")) {
        console.log("    Can see 'Upcoming' tab");
      }

      await browser.close();
      console.log("\nSUCCESS! You can now run:");
      console.log("  node scripts/test-luma-scraper.mjs");
      return true;
    } else {
      const content = await page.textContent("body");
      if (content.includes("expired") || content.includes("invalid")) {
        console.log("\nFAILED: OTP expired or invalid");
      } else {
        console.log(`\nFAILED: Still on ${url}`);
      }
      await browser.close();
      return false;
    }
  } catch (error) {
    console.error("\nError:", error.message);
    await browser.close();
    return false;
  }
}

// Main
const args = process.argv.slice(2);

if (args.includes("--latest")) {
  console.log("Fetching latest OTP from Gmail...");
  const otp = await getLatestLumaOtpFromGmail();
  if (otp) {
    console.log(`Found OTP: ${otp.code} (from ${otp.date.toISOString()})`);
    await loginWithOtp(otp.code);
  } else {
    console.error("No Luma OTP found in Gmail");
    process.exit(1);
  }
} else if (args[0] && /^\d{6}$/.test(args[0])) {
  await loginWithOtp(args[0]);
} else {
  console.log("Usage:");
  console.log("  node scripts/test-luma-with-otp.mjs 123456   # Use specific OTP");
  console.log("  node scripts/test-luma-with-otp.mjs --latest # Use latest from Gmail");
  process.exit(1);
}
