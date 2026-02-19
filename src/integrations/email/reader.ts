/**
 * Email Reader (IMAP)
 *
 * Reads emails via IMAP for use by agents.
 * Supports Gmail (with app password) and other IMAP providers.
 */

import Imap from "imap-simple";
import { simpleParser, type ParsedMail } from "mailparser";
import { recordIntegrationCall, startTimer } from "../../observability/metrics.js";

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
}

export interface EmailMessage {
  id: string;
  from: string;
  fromName?: string;
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  date: Date;
  isRead: boolean;
  attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
  }>;
}

export interface SearchCriteria {
  from?: string;
  to?: string;
  subject?: string;
  since?: Date;
  before?: Date;
  unseen?: boolean;
  body?: string;
  limit?: number;
}

function log(message: string): void {
  console.log(`[email-reader] ${message}`);
}

/**
 * Get IMAP config from environment
 */
export function getImapConfig(): ImapConfig | null {
  // Try Gmail first
  const gmailUser = process.env.GMAIL_USER;
  const gmailPassword = process.env.GMAIL_APP_PASSWORD;

  if (gmailUser && gmailPassword) {
    return {
      host: "imap.gmail.com",
      port: 993,
      user: gmailUser,
      password: gmailPassword,
      tls: true,
    };
  }

  // Try generic IMAP config
  const host = process.env.IMAP_HOST;
  const user = process.env.IMAP_USER;
  const password = process.env.IMAP_PASSWORD;

  if (host && user && password) {
    return {
      host,
      port: parseInt(process.env.IMAP_PORT || "993", 10),
      user,
      password,
      tls: process.env.IMAP_TLS !== "false",
    };
  }

  return null;
}

/**
 * Build IMAP search criteria from our SearchCriteria
 */
function buildSearchCriteria(criteria: SearchCriteria): unknown[][] {
  const imapCriteria: unknown[][] = [];

  if (criteria.from) {
    imapCriteria.push(["FROM", criteria.from]);
  }

  if (criteria.to) {
    imapCriteria.push(["TO", criteria.to]);
  }

  if (criteria.subject) {
    imapCriteria.push(["SUBJECT", criteria.subject]);
  }

  if (criteria.since) {
    imapCriteria.push(["SINCE", criteria.since]);
  }

  if (criteria.before) {
    imapCriteria.push(["BEFORE", criteria.before]);
  }

  if (criteria.unseen) {
    imapCriteria.push(["UNSEEN"]);
  }

  if (criteria.body) {
    imapCriteria.push(["BODY", criteria.body]);
  }

  // Default: get all if no criteria
  if (imapCriteria.length === 0) {
    imapCriteria.push(["ALL"]);
  }

  return imapCriteria;
}

/**
 * Read emails matching search criteria
 */
export async function readEmails(
  config: ImapConfig,
  criteria: SearchCriteria = {},
  folder: string = "INBOX"
): Promise<EmailMessage[]> {
  const endTimer = startTimer();
  const messages: EmailMessage[] = [];

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
    log(`Connecting to ${config.host}...`);
    connection = await Imap.connect(imapConfig);
    await connection.openBox(folder);

    const searchCriteria = buildSearchCriteria(criteria);
    const fetchOptions = {
      bodies: ["HEADER", "TEXT", ""],
      markSeen: false,
    };

    log(`Searching emails with criteria: ${JSON.stringify(criteria)}`);
    const results = await connection.search(searchCriteria, fetchOptions);

    // Sort by date descending (newest first)
    results.sort((a, b) => {
      const dateA = a.attributes?.date || new Date(0);
      const dateB = b.attributes?.date || new Date(0);
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });

    // Apply limit
    const limited = criteria.limit ? results.slice(0, criteria.limit) : results;

    for (const message of limited) {
      const all = message.parts.find((p) => p.which === "");
      if (!all?.body) continue;

      try {
        const parsed: ParsedMail = await simpleParser(all.body);

        // Extract from address
        let fromAddress = "";
        let fromName: string | undefined;
        const fromValue = parsed.from?.value;
        if (fromValue && Array.isArray(fromValue) && fromValue.length > 0) {
          fromAddress = (fromValue[0] as { address?: string }).address || "";
          fromName = (fromValue[0] as { name?: string }).name;
        }

        // Extract to addresses
        const toAddresses: string[] = [];
        const toField = parsed.to;
        if (toField) {
          // Handle both AddressObject and AddressObject[] cases
          const toObjects = Array.isArray(toField) ? toField : [toField];
          for (const obj of toObjects) {
            if (obj.value && Array.isArray(obj.value)) {
              for (const addr of obj.value) {
                const address = (addr as { address?: string }).address;
                if (address) toAddresses.push(address);
              }
            }
          }
        }

        messages.push({
          id: String(message.attributes?.uid || ""),
          from: fromAddress,
          fromName,
          to: toAddresses,
          subject: parsed.subject || "",
          text: parsed.text,
          html: typeof parsed.html === "string" ? parsed.html : undefined,
          date: parsed.date || new Date(),
          isRead: message.attributes?.flags?.includes("\\Seen") || false,
          attachments:
            parsed.attachments?.map((a) => ({
              filename: a.filename || "unnamed",
              contentType: a.contentType,
              size: a.size,
            })) || [],
        });
      } catch (parseError) {
        log(`Failed to parse message: ${parseError}`);
      }
    }

    recordIntegrationCall("imap", "read_emails", "success", endTimer());
    log(`Found ${messages.length} emails`);
    return messages;
  } catch (error) {
    log(`IMAP error: ${error instanceof Error ? error.message : String(error)}`);
    recordIntegrationCall("imap", "read_emails", "failure", endTimer());
    return messages;
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
 * Read a single email by ID
 */
export async function readEmailById(
  config: ImapConfig,
  messageId: string,
  folder: string = "INBOX"
): Promise<EmailMessage | null> {
  const endTimer = startTimer();

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
    await connection.openBox(folder);

    const fetchOptions = {
      bodies: ["HEADER", "TEXT", ""],
      markSeen: false,
    };

    const results = await connection.search([["UID", messageId]], fetchOptions);

    if (results.length === 0) {
      return null;
    }

    const message = results[0];
    const all = message.parts.find((p) => p.which === "");
    if (!all?.body) return null;

    const parsed: ParsedMail = await simpleParser(all.body);

    // Extract from address
    let fromAddress = "";
    let fromName: string | undefined;
    const fromValue = parsed.from?.value;
    if (fromValue && Array.isArray(fromValue) && fromValue.length > 0) {
      fromAddress = (fromValue[0] as { address?: string }).address || "";
      fromName = (fromValue[0] as { name?: string }).name;
    }

    // Extract to addresses
    const toAddresses: string[] = [];
    const toField = parsed.to;
    if (toField) {
      // Handle both AddressObject and AddressObject[] cases
      const toObjects = Array.isArray(toField) ? toField : [toField];
      for (const obj of toObjects) {
        if (obj.value && Array.isArray(obj.value)) {
          for (const addr of obj.value) {
            const address = (addr as { address?: string }).address;
            if (address) toAddresses.push(address);
          }
        }
      }
    }

    recordIntegrationCall("imap", "read_email_by_id", "success", endTimer());

    return {
      id: messageId,
      from: fromAddress,
      fromName,
      to: toAddresses,
      subject: parsed.subject || "",
      text: parsed.text,
      html: typeof parsed.html === "string" ? parsed.html : undefined,
      date: parsed.date || new Date(),
      isRead: message.attributes?.flags?.includes("\\Seen") || false,
      attachments:
        parsed.attachments?.map((a) => ({
          filename: a.filename || "unnamed",
          contentType: a.contentType,
          size: a.size,
        })) || [],
    };
  } catch (error) {
    log(`IMAP error: ${error instanceof Error ? error.message : String(error)}`);
    recordIntegrationCall("imap", "read_email_by_id", "failure", endTimer());
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
 * Get count of unread emails
 */
export async function getUnreadCount(config: ImapConfig, folder: string = "INBOX"): Promise<number> {
  const emails = await readEmails(config, { unseen: true, limit: 1000 }, folder);
  return emails.length;
}

/**
 * List available folders
 */
export async function listFolders(config: ImapConfig): Promise<string[]> {
  const endTimer = startTimer();
  const folders: string[] = [];

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
    const boxes = await connection.getBoxes();

    function extractFolders(boxObj: Record<string, unknown>, prefix: string = ""): void {
      for (const [name, box] of Object.entries(boxObj)) {
        const fullName = prefix ? `${prefix}/${name}` : name;
        folders.push(fullName);
        if (box && typeof box === "object" && "children" in box && box.children) {
          extractFolders(box.children as Record<string, unknown>, fullName);
        }
      }
    }

    extractFolders(boxes);

    recordIntegrationCall("imap", "list_folders", "success", endTimer());
    return folders;
  } catch (error) {
    log(`IMAP error: ${error instanceof Error ? error.message : String(error)}`);
    recordIntegrationCall("imap", "list_folders", "failure", endTimer());
    return folders;
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
 * Wait for an email matching criteria (polling)
 */
export async function waitForEmail(
  config: ImapConfig,
  criteria: SearchCriteria,
  timeoutMs: number = 120000,
  pollIntervalMs: number = 5000
): Promise<EmailMessage | null> {
  const startTime = Date.now();

  // Set since to now if not specified
  if (!criteria.since) {
    criteria.since = new Date(startTime - 60000); // Look 1 minute back
  }

  log(`Waiting for email matching: ${JSON.stringify(criteria)}`);

  while (Date.now() - startTime < timeoutMs) {
    const emails = await readEmails(config, { ...criteria, limit: 1 });

    if (emails.length > 0) {
      log(`Found matching email: "${emails[0].subject}"`);
      return emails[0];
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  log("Timeout waiting for email");
  return null;
}

/**
 * Extract verification code from email
 */
export function extractVerificationCode(email: EmailMessage): string | null {
  const text = email.text || "";
  const html = email.html || "";
  const searchText = text || html.replace(/<[^>]+>/g, " ");

  // Common patterns for verification codes
  const patterns = [
    /(?:code|pin|otp|verification)[:\s]*(\d{4,8})/i,
    /(\d{6})(?:\s*is your|verification|code)/i,
    /enter[:\s]*(\d{4,8})/i,
    /\b(\d{6})\b/, // Generic 6-digit
  ];

  for (const pattern of patterns) {
    const match = searchText.match(pattern);
    if (match) {
      const code = match[1] || match[0];
      if (/^\d{4,8}$/.test(code)) {
        return code;
      }
    }
  }

  return null;
}

/**
 * Extract magic link from email
 */
export function extractMagicLink(email: EmailMessage, domain?: string): string | null {
  const html = email.html || "";
  const text = email.text || "";
  const content = html || text;

  // Look for links
  const linkPattern = /https?:\/\/[^\s"'<>]+/gi;
  const links = content.match(linkPattern) || [];

  // Filter by domain if specified
  const filtered = domain ? links.filter((l) => l.includes(domain)) : links;

  // Look for auth/login/verify links
  const authKeywords = ["auth", "login", "signin", "verify", "confirm", "magic", "token"];

  for (const link of filtered) {
    if (authKeywords.some((kw) => link.toLowerCase().includes(kw))) {
      return link;
    }
  }

  // Return first link if no auth link found
  return filtered[0] || null;
}
