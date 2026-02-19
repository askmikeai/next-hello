import type { EmailConfig, NetworkingContact } from "../../config/types.js";
import { recordIntegrationCall, startTimer } from "../../observability/metrics.js";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { google } from "googleapis";

const SENDGRID_API_BASE = "https://api.sendgrid.com/v3";
const RESEND_API_BASE = "https://api.resend.com";

// Gmail OAuth2 cached transporter
let gmailTransporter: Transporter | null = null;

export interface SendEmailParams {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

function getSendGridApiKey(config?: EmailConfig): string | null {
  return config?.apiKey ?? process.env.SENDGRID_API_KEY ?? null;
}

function getResendApiKey(config?: EmailConfig): string | null {
  return config?.apiKey ?? process.env.RESEND_API_KEY ?? null;
}

function log(message: string): void {
  console.log(`[email] ${message}`);
}

/**
 * Send email via SendGrid
 */
async function sendViaSendGrid(
  config: EmailConfig,
  params: SendEmailParams,
): Promise<SendEmailResult> {
  const apiKey = getSendGridApiKey(config);
  if (!apiKey) {
    return { success: false, error: "SendGrid API key not configured" };
  }

  if (!config.fromEmail) {
    return { success: false, error: "From email not configured" };
  }

  const endTimer = startTimer();
  try {
    const response = await fetch(`${SENDGRID_API_BASE}/mail/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: params.to }],
          },
        ],
        from: {
          email: config.fromEmail,
          name: config.fromName,
        },
        reply_to: params.replyTo
          ? { email: params.replyTo }
          : undefined,
        subject: params.subject,
        content: [
          params.text ? { type: "text/plain", value: params.text } : null,
          params.html ? { type: "text/html", value: params.html } : null,
        ].filter(Boolean),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      log(`SendGrid error: ${response.status} - ${error}`);
      recordIntegrationCall("sendgrid", "send_email", "failure", endTimer());
      return { success: false, error };
    }

    const messageId = response.headers.get("x-message-id") ?? undefined;
    recordIntegrationCall("sendgrid", "send_email", "success", endTimer());
    return { success: true, messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`SendGrid error: ${message}`);
    recordIntegrationCall("sendgrid", "send_email", "failure", endTimer());
    return { success: false, error: message };
  }
}

/**
 * Send email via Resend
 */
async function sendViaResend(
  config: EmailConfig,
  params: SendEmailParams,
): Promise<SendEmailResult> {
  const apiKey = getResendApiKey(config);
  if (!apiKey) {
    return { success: false, error: "Resend API key not configured" };
  }

  if (!config.fromEmail) {
    return { success: false, error: "From email not configured" };
  }

  const endTimer = startTimer();
  try {
    const from = config.fromName
      ? `${config.fromName} <${config.fromEmail}>`
      : config.fromEmail;

    const response = await fetch(`${RESEND_API_BASE}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: params.subject,
        text: params.text,
        html: params.html,
        reply_to: params.replyTo,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      log(`Resend error: ${response.status} - ${error}`);
      recordIntegrationCall("resend", "send_email", "failure", endTimer());
      return { success: false, error };
    }

    const data = (await response.json()) as { id?: string };
    recordIntegrationCall("resend", "send_email", "success", endTimer());
    return { success: true, messageId: data.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Resend error: ${message}`);
    recordIntegrationCall("resend", "send_email", "failure", endTimer());
    return { success: false, error: message };
  }
}

/**
 * Get Gmail OAuth2 credentials from environment
 */
function getGmailOAuth2Config(): {
  user: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
} | null {
  const user = process.env.GMAIL_USER;
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (user && clientId && clientSecret && refreshToken) {
    return { user, clientId, clientSecret, refreshToken };
  }
  return null;
}

/**
 * Create Gmail OAuth2 transporter
 */
async function getGmailTransporter(): Promise<Transporter | null> {
  if (gmailTransporter) return gmailTransporter;

  const gmailConfig = getGmailOAuth2Config();
  if (!gmailConfig) return null;

  const oauth2Client = new google.auth.OAuth2(
    gmailConfig.clientId,
    gmailConfig.clientSecret,
    "https://developers.google.com/oauthplayground"
  );

  oauth2Client.setCredentials({
    refresh_token: gmailConfig.refreshToken,
  });

  try {
    const { token } = await oauth2Client.getAccessToken();
    if (!token) {
      log("Failed to get Gmail access token");
      return null;
    }

    gmailTransporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        type: "OAuth2",
        user: gmailConfig.user,
        clientId: gmailConfig.clientId,
        clientSecret: gmailConfig.clientSecret,
        refreshToken: gmailConfig.refreshToken,
        accessToken: token,
      },
    });

    return gmailTransporter;
  } catch (error) {
    log(`Gmail OAuth2 error: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Send email via Gmail OAuth2
 */
async function sendViaGmail(params: SendEmailParams): Promise<SendEmailResult> {
  const gmailConfig = getGmailOAuth2Config();
  if (!gmailConfig) {
    return { success: false, error: "Gmail OAuth2 not configured. Set GMAIL_USER, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN." };
  }

  const endTimer = startTimer();
  try {
    const transporter = await getGmailTransporter();
    if (!transporter) {
      return { success: false, error: "Failed to create Gmail transporter" };
    }

    const mailOptions = {
      from: gmailConfig.user,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
      replyTo: params.replyTo,
    };

    const result = await transporter.sendMail(mailOptions);

    recordIntegrationCall("gmail", "send_email", "success", endTimer());
    log(`Email sent via Gmail to ${params.to}, messageId: ${result.messageId}`);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Gmail error: ${message}`);
    recordIntegrationCall("gmail", "send_email", "failure", endTimer());
    // Reset transporter on error to force re-auth
    gmailTransporter = null;
    return { success: false, error: message };
  }
}

/**
 * Send email using configured provider
 */
export async function sendEmail(
  config: EmailConfig,
  params: SendEmailParams,
): Promise<SendEmailResult> {
  const provider = config.provider ?? "gmail";

  if (provider === "gmail" || getGmailOAuth2Config()) {
    // Prefer Gmail if configured
    const gmailResult = await sendViaGmail(params);
    if (gmailResult.success || !config.provider) {
      return gmailResult;
    }
    // Fall through to other providers if Gmail fails and another is specified
  }

  if (provider === "resend") {
    return sendViaResend(config, params);
  }

  return sendViaSendGrid(config, params);
}

/**
 * Send welcome email to new contact
 */
export async function sendWelcomeEmail(
  config: EmailConfig,
  contact: NetworkingContact,
  params: {
    eventName?: string;
    ownerName?: string;
    calendlyLink?: string;
    videoUrl?: string;
  },
): Promise<SendEmailResult> {
  if (!contact.email) {
    return { success: false, error: "Contact has no email" };
  }

  const firstName = contact.first_name ?? "there";
  const eventName = params.eventName ?? "the event";
  const ownerName = params.ownerName ?? "the team";

  const subject = `Great connecting at ${eventName}!`;

  const textParts = [
    `Hey ${firstName},`,
    "",
    `It was great meeting you at ${eventName}! I'm ${ownerName}, and I wanted to follow up on our conversation.`,
    "",
  ];

  if (params.videoUrl) {
    textParts.push(
      `I recorded a personalized video message for you: ${params.videoUrl}`,
      "",
    );
  }

  if (params.calendlyLink) {
    textParts.push(
      `If you'd like to chat more, feel free to book some time on my calendar: ${params.calendlyLink}`,
      "",
    );
  }

  textParts.push(
    "Looking forward to connecting!",
    "",
    `Best,`,
    ownerName,
  );

  const text = textParts.join("\n");

  // Simple HTML version
  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333;">
  <p>Hey ${firstName},</p>

  <p>It was great meeting you at ${eventName}! I'm ${ownerName}, and I wanted to follow up on our conversation.</p>

  ${params.videoUrl ? `<p>I recorded a personalized video message for you:<br><a href="${params.videoUrl}" style="color: #0066cc;">${params.videoUrl}</a></p>` : ""}

  ${params.calendlyLink ? `<p>If you'd like to chat more, feel free to book some time on my calendar:<br><a href="${params.calendlyLink}" style="color: #0066cc;">Schedule a Meeting</a></p>` : ""}

  <p>Looking forward to connecting!</p>

  <p>Best,<br>${ownerName}</p>
</body>
</html>
  `.trim();

  return sendEmail(config, {
    to: contact.email,
    subject,
    text,
    html,
  });
}

/**
 * Send meeting confirmation email
 */
export async function sendMeetingConfirmationEmail(
  config: EmailConfig,
  contact: NetworkingContact,
  params: {
    meetingName: string;
    meetingTime: string;
    meetingLink?: string;
    ownerName?: string;
  },
): Promise<SendEmailResult> {
  if (!contact.email) {
    return { success: false, error: "Contact has no email" };
  }

  const firstName = contact.first_name ?? "there";
  const ownerName = params.ownerName ?? "the team";

  const subject = `Confirmed: ${params.meetingName}`;

  const text = [
    `Hey ${firstName},`,
    "",
    `Great news! Our meeting "${params.meetingName}" is confirmed for ${params.meetingTime}.`,
    "",
    params.meetingLink ? `Join here: ${params.meetingLink}` : "",
    "",
    "Looking forward to speaking with you!",
    "",
    `Best,`,
    ownerName,
  ]
    .filter(Boolean)
    .join("\n");

  return sendEmail(config, {
    to: contact.email,
    subject,
    text,
  });
}

/**
 * Send CRM sync confirmation (internal notification)
 */
export async function sendCrmSyncNotification(
  config: EmailConfig,
  contact: NetworkingContact,
  crmContactId: string,
): Promise<SendEmailResult> {
  const notifyEmail = config.fromEmail;
  if (!notifyEmail) {
    return { success: false, error: "No notification email configured" };
  }

  const subject = `New contact synced to CRM: ${contact.first_name} ${contact.last_name}`;

  const text = [
    `A new contact has been synced to your CRM:`,
    "",
    `Name: ${contact.first_name} ${contact.last_name}`,
    `Email: ${contact.email ?? "N/A"}`,
    `Company: ${contact.company_name ?? "N/A"}`,
    `Job Title: ${contact.job_title ?? "N/A"}`,
    `Phone: ${contact.phone_number}`,
    `CRM Contact ID: ${crmContactId}`,
    "",
    `Event: ${contact.event_name ?? "N/A"}`,
  ].join("\n");

  return sendEmail(config, {
    to: notifyEmail,
    subject,
    text,
  });
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}
