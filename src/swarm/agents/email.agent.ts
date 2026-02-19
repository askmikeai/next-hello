import { BaseAgent, type AgentConfig, registerAgentFactory } from "../base-agent.js";
import { defineTool } from "../llm/tool-executor.js";
import type { AgentContext, ToolDefinition, AgentType } from "../types.js";
import { sendEmail, type SendEmailParams } from "../../integrations/email/client.js";
import {
  readEmails,
  readEmailById,
  waitForEmail,
  getUnreadCount,
  listFolders,
  extractVerificationCode,
  extractMagicLink,
  getImapConfig,
  type SearchCriteria,
  type EmailMessage,
} from "../../integrations/email/reader.js";

/**
 * Email Agent Configuration
 */
const AGENT_CONFIG: AgentConfig = {
  type: "email",
  name: "Email Agent",
  description: "Reads and sends emails. Can monitor inbox, extract verification codes, and send follow-up emails.",
  temperature: 0.3,
};

/**
 * EmailAgent - Handles email read/write operations
 *
 * Responsibilities:
 * - Read emails from inbox (IMAP)
 * - Search for specific emails
 * - Extract verification codes and magic links
 * - Send emails via SendGrid/Resend
 * - Wait for expected emails (e.g., MFA codes)
 *
 * Tools:
 * - read_emails: Search and read emails from inbox
 * - read_email: Get a specific email by ID
 * - send_email: Send an email
 * - wait_for_email: Wait for an email matching criteria
 * - extract_code: Extract verification code from email
 * - get_unread_count: Get count of unread emails
 */
export class EmailAgent extends BaseAgent {
  constructor() {
    super(AGENT_CONFIG);
  }

  /**
   * Get the system prompt for email operations
   */
  protected getSystemPrompt(context: AgentContext): string {
    const ownerName = context.config.ownerName ?? "the user";

    return `You are an email agent for ${ownerName}'s networking system.

## Your Role
You manage email operations including reading inbox, searching for specific emails, and sending messages.

## Available Tools

### Reading Emails
- \`read_emails\`: Search emails with filters (from, subject, date range, unread only)
- \`read_email\`: Get a specific email by its ID
- \`wait_for_email\`: Wait for an expected email (useful for verification codes)
- \`get_unread_count\`: Check how many unread emails exist

### Sending Emails
- \`send_email\`: Send an email with subject, body (text/html), and recipients

### Extracting Data
- \`extract_code\`: Extract verification/MFA code from an email
- \`extract_link\`: Extract magic link or verification link from an email

## Guidelines
- When searching for emails, use specific criteria to narrow results
- For MFA/verification, use wait_for_email with a short timeout
- Extract codes automatically when asked to handle verification
- Always confirm successful sends

## Current Task
${context.additionalContext || "Awaiting email operation request"}`;
  }

  /**
   * Define tools available to this agent
   */
  protected getTools(): ToolDefinition[] {
    return [
      defineTool(
        "read_emails",
        "Search and read emails from inbox. Returns matching emails with subject, from, date, and body preview.",
        {
          from: {
            type: "string",
            description: "Filter by sender email/name",
          },
          subject: {
            type: "string",
            description: "Filter by subject contains",
          },
          since: {
            type: "string",
            description: "Only emails after this date (ISO format)",
          },
          unreadOnly: {
            type: "boolean",
            description: "Only return unread emails",
          },
          limit: {
            type: "number",
            description: "Maximum number of emails to return (default: 10)",
          },
          folder: {
            type: "string",
            description: "Email folder to search (default: INBOX)",
          },
        }
      ),
      defineTool(
        "read_email",
        "Read a specific email by its ID. Returns full email content.",
        {
          emailId: {
            type: "string",
            description: "The email ID to read",
          },
          folder: {
            type: "string",
            description: "Email folder (default: INBOX)",
          },
        },
        ["emailId"]
      ),
      defineTool(
        "send_email",
        "Send an email to a recipient.",
        {
          to: {
            type: "string",
            description: "Recipient email address",
          },
          subject: {
            type: "string",
            description: "Email subject",
          },
          body: {
            type: "string",
            description: "Email body (plain text)",
          },
          html: {
            type: "string",
            description: "Email body (HTML format, optional)",
          },
          replyTo: {
            type: "string",
            description: "Reply-to address (optional)",
          },
        },
        ["to", "subject", "body"]
      ),
      defineTool(
        "wait_for_email",
        "Wait for an email matching criteria. Useful for verification codes or expected messages.",
        {
          from: {
            type: "string",
            description: "Expected sender",
          },
          subject: {
            type: "string",
            description: "Expected subject contains",
          },
          timeoutSeconds: {
            type: "number",
            description: "How long to wait (default: 120)",
          },
        }
      ),
      defineTool(
        "extract_code",
        "Extract verification/MFA code from an email.",
        {
          emailId: {
            type: "string",
            description: "Email ID to extract code from",
          },
        },
        ["emailId"]
      ),
      defineTool(
        "extract_link",
        "Extract magic link or verification link from an email.",
        {
          emailId: {
            type: "string",
            description: "Email ID to extract link from",
          },
          domain: {
            type: "string",
            description: "Filter links by domain (optional)",
          },
        },
        ["emailId"]
      ),
      defineTool(
        "get_unread_count",
        "Get the count of unread emails in inbox.",
        {
          folder: {
            type: "string",
            description: "Folder to check (default: INBOX)",
          },
        }
      ),
      defineTool(
        "list_folders",
        "List available email folders.",
        {}
      ),
    ];
  }

  /**
   * Register tool handlers
   */
  protected registerTools(): void {
    // Read emails
    this.toolExecutor.registerTool(
      defineTool("read_emails", "Search emails", {
        from: { type: "string" },
        subject: { type: "string" },
        since: { type: "string" },
        unreadOnly: { type: "boolean" },
        limit: { type: "number" },
        folder: { type: "string" },
      }),
      async (input, context) => {
        const config = getImapConfig();
        if (!config) {
          return { error: "Email (IMAP) not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD." };
        }

        const criteria: SearchCriteria = {
          from: input.from as string | undefined,
          subject: input.subject as string | undefined,
          since: input.since ? new Date(input.since as string) : undefined,
          unseen: input.unreadOnly as boolean | undefined,
          limit: (input.limit as number) || 10,
        };

        const emails = await readEmails(config, criteria, (input.folder as string) || "INBOX");

        return {
          count: emails.length,
          emails: emails.map((e) => ({
            id: e.id,
            from: e.from,
            fromName: e.fromName,
            subject: e.subject,
            date: e.date.toISOString(),
            isRead: e.isRead,
            preview: e.text?.substring(0, 200) || "",
            hasAttachments: e.attachments.length > 0,
          })),
        };
      }
    );

    // Read single email
    this.toolExecutor.registerTool(
      defineTool("read_email", "Read email by ID", {
        emailId: { type: "string" },
        folder: { type: "string" },
      }, ["emailId"]),
      async (input) => {
        const config = getImapConfig();
        if (!config) {
          return { error: "Email (IMAP) not configured" };
        }

        const email = await readEmailById(config, input.emailId as string, (input.folder as string) || "INBOX");

        if (!email) {
          return { error: "Email not found" };
        }

        return {
          id: email.id,
          from: email.from,
          fromName: email.fromName,
          to: email.to,
          subject: email.subject,
          date: email.date.toISOString(),
          isRead: email.isRead,
          text: email.text,
          html: email.html,
          attachments: email.attachments,
        };
      }
    );

    // Send email
    this.toolExecutor.registerTool(
      defineTool("send_email", "Send email", {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        html: { type: "string" },
        replyTo: { type: "string" },
      }, ["to", "subject", "body"]),
      async (input, context) => {
        if (!context.config.email) {
          return { error: "Email sending not configured" };
        }

        const params: SendEmailParams = {
          to: input.to as string,
          subject: input.subject as string,
          text: input.body as string,
          html: input.html as string | undefined,
          replyTo: input.replyTo as string | undefined,
        };

        const result = await sendEmail(context.config.email, params);

        return {
          success: result.success,
          messageId: result.messageId,
          error: result.error,
        };
      }
    );

    // Wait for email
    this.toolExecutor.registerTool(
      defineTool("wait_for_email", "Wait for expected email", {
        from: { type: "string" },
        subject: { type: "string" },
        timeoutSeconds: { type: "number" },
      }),
      async (input) => {
        const config = getImapConfig();
        if (!config) {
          return { error: "Email (IMAP) not configured" };
        }

        const criteria: SearchCriteria = {
          from: input.from as string | undefined,
          subject: input.subject as string | undefined,
        };

        const timeoutMs = ((input.timeoutSeconds as number) || 120) * 1000;

        const email = await waitForEmail(config, criteria, timeoutMs);

        if (!email) {
          return { found: false, error: "Timeout waiting for email" };
        }

        return {
          found: true,
          email: {
            id: email.id,
            from: email.from,
            subject: email.subject,
            date: email.date.toISOString(),
            preview: email.text?.substring(0, 500) || "",
          },
        };
      }
    );

    // Extract verification code
    this.toolExecutor.registerTool(
      defineTool("extract_code", "Extract verification code", {
        emailId: { type: "string" },
      }, ["emailId"]),
      async (input) => {
        const config = getImapConfig();
        if (!config) {
          return { error: "Email (IMAP) not configured" };
        }

        const email = await readEmailById(config, input.emailId as string);
        if (!email) {
          return { error: "Email not found" };
        }

        const code = extractVerificationCode(email);
        return {
          found: !!code,
          code,
          subject: email.subject,
        };
      }
    );

    // Extract magic link
    this.toolExecutor.registerTool(
      defineTool("extract_link", "Extract magic link", {
        emailId: { type: "string" },
        domain: { type: "string" },
      }, ["emailId"]),
      async (input) => {
        const config = getImapConfig();
        if (!config) {
          return { error: "Email (IMAP) not configured" };
        }

        const email = await readEmailById(config, input.emailId as string);
        if (!email) {
          return { error: "Email not found" };
        }

        const link = extractMagicLink(email, input.domain as string | undefined);
        return {
          found: !!link,
          link,
          subject: email.subject,
        };
      }
    );

    // Get unread count
    this.toolExecutor.registerTool(
      defineTool("get_unread_count", "Get unread count", {
        folder: { type: "string" },
      }),
      async (input) => {
        const config = getImapConfig();
        if (!config) {
          return { error: "Email (IMAP) not configured" };
        }

        const count = await getUnreadCount(config, (input.folder as string) || "INBOX");
        return { unreadCount: count };
      }
    );

    // List folders
    this.toolExecutor.registerTool(
      defineTool("list_folders", "List email folders", {}),
      async () => {
        const config = getImapConfig();
        if (!config) {
          return { error: "Email (IMAP) not configured" };
        }

        const folders = await listFolders(config);
        return { folders };
      }
    );
  }

  /**
   * Determine if handoff to another agent is needed
   */
  protected determineNextAgent(): AgentType | undefined {
    return undefined; // Email agent typically completes its task
  }

  /**
   * Check if this agent can handle a given action
   */
  canHandle(action: string): boolean {
    const supportedActions = [
      "read_emails",
      "read_email",
      "send_email",
      "check_inbox",
      "wait_for_email",
      "extract_code",
      "get_verification_code",
      "get_mfa_code",
    ];
    return supportedActions.includes(action);
  }
}

// Register the factory for this agent
registerAgentFactory("email", () => new EmailAgent());

export default EmailAgent;
