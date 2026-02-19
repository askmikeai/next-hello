/**
 * Email MFA Handler for Luma Login
 *
 * Connects to email via IMAP to automatically retrieve Luma login codes/magic links.
 * Supports Gmail (with app password) and other IMAP providers.
 */

import Imap from "imap-simple";
import { simpleParser, type ParsedMail } from "mailparser";

export interface EmailConfig {
  host: string;
  port: number;
  user: string;
  password: string; // App password for Gmail
  tls: boolean;
}

export interface MfaResult {
  type: "magic_link" | "code";
  value: string;
  subject: string;
  receivedAt: Date;
}

function log(message: string): void {
  console.log(`[luma-email-mfa] ${message}`);
}

/**
 * Get Gmail IMAP config from environment
 */
export function getGmailConfig(): EmailConfig | null {
  const user = process.env.GMAIL_USER || process.env.LUMA_EMAIL_USER;
  const password = process.env.GMAIL_APP_PASSWORD || process.env.LUMA_EMAIL_PASSWORD;

  if (!user || !password) {
    return null;
  }

  return {
    host: "imap.gmail.com",
    port: 993,
    user,
    password,
    tls: true,
  };
}

/**
 * Get IMAP config from environment
 */
export function getImapConfig(): EmailConfig | null {
  const host = process.env.IMAP_HOST;
  const port = parseInt(process.env.IMAP_PORT || "993", 10);
  const user = process.env.IMAP_USER || process.env.LUMA_EMAIL_USER;
  const password = process.env.IMAP_PASSWORD || process.env.LUMA_EMAIL_PASSWORD;

  if (!host || !user || !password) {
    return getGmailConfig(); // Fall back to Gmail
  }

  return {
    host,
    port,
    user,
    password,
    tls: process.env.IMAP_TLS !== "false",
  };
}

/**
 * Extract Luma magic link or code from email body
 */
function extractLumaAuth(html: string, text: string): MfaResult | null {
  // Look for magic link
  const linkPatterns = [
    /https:\/\/lu\.ma\/auth\/[^\s"'<>]+/gi,
    /https:\/\/lu\.ma\/signin\?[^\s"'<>]+/gi,
    /https:\/\/lu\.ma\/magic[^\s"'<>]+/gi,
  ];

  for (const pattern of linkPatterns) {
    const match = (html || text).match(pattern);
    if (match) {
      return {
        type: "magic_link",
        value: match[0],
        subject: "",
        receivedAt: new Date(),
      };
    }
  }

  // Look for OTP code (usually 6 digits)
  const codePatterns = [
    /(?:code|pin|otp)[:\s]*(\d{6})/i,
    /(\d{6})(?:\s*is your|verification)/i,
    /\b(\d{6})\b/g, // Generic 6-digit pattern
  ];

  const searchText = text || html.replace(/<[^>]+>/g, " ");
  for (const pattern of codePatterns) {
    const match = searchText.match(pattern);
    if (match) {
      const code = match[1] || match[0];
      if (/^\d{6}$/.test(code)) {
        return {
          type: "code",
          value: code,
          subject: "",
          receivedAt: new Date(),
        };
      }
    }
  }

  return null;
}

/**
 * Wait for Luma MFA email and extract auth info
 */
export async function waitForLumaMfaEmail(
  config: EmailConfig,
  timeoutMs: number = 120000, // 2 minutes
  pollIntervalMs: number = 3000
): Promise<MfaResult | null> {
  const startTime = Date.now();
  const searchSince = new Date(startTime - 60000); // Look at emails from last minute

  log(`Waiting for Luma MFA email (timeout: ${timeoutMs / 1000}s)...`);

  const imapConfig = {
    imap: {
      user: config.user,
      password: config.password,
      host: config.host,
      port: config.port,
      tls: config.tls,
      authTimeout: 10000,
      tlsOptions: { rejectUnauthorized: false },
    },
  };

  let connection: Awaited<ReturnType<typeof Imap.connect>> | null = null;

  try {
    connection = await Imap.connect(imapConfig);
    await connection.openBox("INBOX");

    while (Date.now() - startTime < timeoutMs) {
      // Search for recent Luma emails
      const searchCriteria = [
        ["SINCE", searchSince],
        ["OR", ["FROM", "luma"], ["FROM", "lu.ma"]],
      ];

      const fetchOptions = {
        bodies: ["HEADER", "TEXT", ""],
        markSeen: false,
      };

      const messages = await connection.search(searchCriteria, fetchOptions);

      for (const message of messages) {
        const all = message.parts.find((p) => p.which === "");
        if (!all?.body) continue;

        const parsed: ParsedMail = await simpleParser(all.body);

        // Check if this is a login/auth email
        const subject = parsed.subject?.toLowerCase() || "";
        const isAuthEmail =
          subject.includes("sign in") ||
          subject.includes("login") ||
          subject.includes("verify") ||
          subject.includes("magic link") ||
          subject.includes("confirmation");

        if (!isAuthEmail) continue;

        const html = parsed.html || "";
        const text = parsed.text || "";

        const result = extractLumaAuth(html, text);
        if (result) {
          result.subject = parsed.subject || "";
          result.receivedAt = parsed.date || new Date();
          log(`Found MFA ${result.type}: ${result.value.substring(0, 50)}...`);
          return result;
        }
      }

      // Wait before polling again
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    log("Timeout waiting for MFA email");
    return null;
  } catch (error) {
    log(`IMAP error: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  } finally {
    if (connection) {
      try {
        await connection.end();
      } catch {
        // Ignore close errors
      }
    }
  }
}

/**
 * One-shot check for recent Luma MFA email
 */
export async function checkForLumaMfaEmail(config: EmailConfig): Promise<MfaResult | null> {
  const searchSince = new Date(Date.now() - 300000); // Last 5 minutes

  log("Checking for recent Luma MFA email...");

  const imapConfig = {
    imap: {
      user: config.user,
      password: config.password,
      host: config.host,
      port: config.port,
      tls: config.tls,
      authTimeout: 10000,
      tlsOptions: { rejectUnauthorized: false },
    },
  };

  let connection: Awaited<ReturnType<typeof Imap.connect>> | null = null;

  try {
    connection = await Imap.connect(imapConfig);
    await connection.openBox("INBOX");

    const searchCriteria = [
      ["SINCE", searchSince],
      ["OR", ["FROM", "luma"], ["FROM", "lu.ma"]],
    ];

    const fetchOptions = {
      bodies: ["HEADER", "TEXT", ""],
      markSeen: false,
    };

    const messages = await connection.search(searchCriteria, fetchOptions);

    // Sort by date descending (newest first)
    messages.sort((a, b) => {
      const dateA = a.attributes?.date || new Date(0);
      const dateB = b.attributes?.date || new Date(0);
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });

    for (const message of messages) {
      const all = message.parts.find((p) => p.which === "");
      if (!all?.body) continue;

      const parsed: ParsedMail = await simpleParser(all.body);

      const html = parsed.html || "";
      const text = parsed.text || "";

      const result = extractLumaAuth(html, text);
      if (result) {
        result.subject = parsed.subject || "";
        result.receivedAt = parsed.date || new Date();
        return result;
      }
    }

    return null;
  } catch (error) {
    log(`IMAP error: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  } finally {
    if (connection) {
      try {
        await connection.end();
      } catch {
        // Ignore close errors
      }
    }
  }
}
