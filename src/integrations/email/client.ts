import type { EmailConfig, NetworkingContact } from "../../config/types.js";
import { recordIntegrationCall, startTimer } from "../../observability/metrics.js";

const SENDGRID_API_BASE = "https://api.sendgrid.com/v3";
const RESEND_API_BASE = "https://api.resend.com";

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
 * Send email using configured provider
 */
export async function sendEmail(
  config: EmailConfig,
  params: SendEmailParams,
): Promise<SendEmailResult> {
  const provider = config.provider ?? "sendgrid";

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
