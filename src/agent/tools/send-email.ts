import type { EmailConfig, SupabaseConfig } from "../../config/types.js";
import {
  sendEmail,
  sendWelcomeEmail,
  isValidEmail,
} from "../../integrations/email/client.js";
import { findContactByPhone } from "../../contacts/index.js";

export interface SendEmailParams {
  phoneNumber?: string;
  toEmail?: string;
  type: "welcome" | "custom";
  subject?: string;
  body?: string;
  eventName?: string;
  ownerName?: string;
  calendlyLink?: string;
  videoUrl?: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send email tool for AI agent
 *
 * Can send welcome emails or custom emails to contacts.
 */
export async function sendEmailTool(
  params: SendEmailParams,
  emailConfig: EmailConfig,
  supabaseConfig?: SupabaseConfig,
): Promise<SendEmailResult> {
  try {
    // Get contact if phone number provided
    let contact = null;
    let targetEmail = params.toEmail;

    if (params.phoneNumber) {
      contact = await findContactByPhone(params.phoneNumber, supabaseConfig);

      if (contact?.email && !targetEmail) {
        targetEmail = contact.email;
      }
    }

    if (!targetEmail) {
      return {
        success: false,
        error: "No email address available",
      };
    }

    if (!isValidEmail(targetEmail)) {
      return {
        success: false,
        error: "Invalid email address format",
      };
    }

    // Send appropriate email type
    if (params.type === "welcome" && contact) {
      const result = await sendWelcomeEmail(emailConfig, contact, {
        eventName: params.eventName,
        ownerName: params.ownerName,
        calendlyLink: params.calendlyLink,
        videoUrl: params.videoUrl,
      });

      return {
        success: result.success,
        messageId: result.messageId,
        error: result.error,
      };
    }

    // Custom email
    if (!params.subject || !params.body) {
      return {
        success: false,
        error: "Subject and body are required for custom emails",
      };
    }

    const result = await sendEmail(emailConfig, {
      to: targetEmail,
      subject: params.subject,
      text: params.body,
    });

    return {
      success: result.success,
      messageId: result.messageId,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Tool definition for agent registration
 */
export const sendEmailToolDef = {
  name: "send_email",
  description:
    "Send an email to a contact. Can send pre-formatted welcome emails or custom messages. The contact must have an email address on file.",
  parameters: {
    type: "object",
    properties: {
      phoneNumber: {
        type: "string",
        description: "Phone number to look up contact email",
      },
      toEmail: {
        type: "string",
        description: "Direct email address (overrides contact lookup)",
      },
      type: {
        type: "string",
        enum: ["welcome", "custom"],
        description: "Type of email: 'welcome' for pre-formatted, 'custom' for freeform",
      },
      subject: {
        type: "string",
        description: "Email subject (required for custom type)",
      },
      body: {
        type: "string",
        description: "Email body text (required for custom type)",
      },
      eventName: {
        type: "string",
        description: "Event name for welcome email personalization",
      },
      ownerName: {
        type: "string",
        description: "Sender name for welcome email",
      },
      calendlyLink: {
        type: "string",
        description: "Calendly link to include in welcome email",
      },
      videoUrl: {
        type: "string",
        description: "HeyGen video URL to include in welcome email",
      },
    },
    required: ["type"],
  },
};
