import type {
  HeyGenConfig,
  NetworkingEventConfig,
  SupabaseConfig,
} from "../config/types.js";
import {
  createContact,
  findContactByPhone,
  markMessageSent,
  updateContactByPhone,
} from "../contacts/supabase-repo.js";
import { generatePersonalizedVideo } from "../integrations/heygen/client.js";
import { getSchedulingLink } from "../integrations/calendly/client.js";
import { enrichContactWithLinkedIn } from "../integrations/linkedin/client.js";

export interface FirstContactParams {
  phoneNumber: string;
  pushName?: string;
  channel: string;
  config: NetworkingEventConfig;
  sendMessage: (text: string) => Promise<void>;
}

export interface FirstContactResult {
  handled: boolean;
  reason: string;
  contactId?: string;
}

function log(message: string): void {
  console.log(`[first-contact] ${message}`);
}

/**
 * Build welcome message for first contact
 */
function buildWelcomeMessage(params: {
  firstName?: string;
  eventName?: string;
  ownerName?: string;
  calendlyLink?: string;
  videoUrl?: string;
}): string {
  const name = params.firstName ?? "there";
  const event = params.eventName ?? "the event";
  const owner = params.ownerName ?? "our team";

  const lines = [
    `Hey ${name}! Great to connect after ${event}. I'm ${owner}'s AI assistant, helping coordinate follow-ups.`,
    "",
  ];

  if (params.videoUrl) {
    lines.push(`I made a quick personalized video for you: ${params.videoUrl}`);
    lines.push("");
  }

  if (params.calendlyLink) {
    lines.push(
      `If you'd like to chat more, feel free to book some time: ${params.calendlyLink}`,
    );
    lines.push("");
  }

  lines.push(
    "Looking forward to staying connected! What would be the best email to reach you?",
  );

  return lines.join("\n");
}

/**
 * Handle first contact from a new number
 *
 * Workflow:
 * 1. Save to Supabase (phone, name from pushName)
 * 2. Generate HeyGen video (async if webhook configured)
 * 3. Send welcome message + Calendly link
 * 4. Trigger LinkedIn research (background)
 * 5. Mark status: "welcomed"
 */
export async function handleFirstContact(
  params: FirstContactParams,
): Promise<FirstContactResult> {
  const { phoneNumber, pushName, channel, config, sendMessage } = params;
  const supabaseConfig: SupabaseConfig = config.supabase ?? {};

  log(`New contact from ${phoneNumber} (${pushName ?? "unknown"}) via ${channel}`);

  try {
    // Check if contact already exists
    const existing = await findContactByPhone(phoneNumber, supabaseConfig);

    if (existing) {
      log(`Contact ${phoneNumber} already exists`);

      // If they've already been welcomed, this isn't first contact
      if (existing.sent_personalized_message) {
        return {
          handled: false,
          reason: "already_welcomed",
        };
      }

      // Continue with welcome flow for existing but not welcomed
    }

    // Parse name from pushName
    const firstName = pushName?.split(" ")[0] ?? undefined;
    const lastName = pushName?.split(" ").slice(1).join(" ") ?? undefined;

    // Create or get contact
    let contact = existing;
    if (!contact) {
      contact = await createContact(
        {
          phone_number: phoneNumber,
          first_name: firstName,
          last_name: lastName,
          event_met_at: config.eventName,
          date_met: new Date().toISOString().split("T")[0], // YYYY-MM-DD
          status: "active",
        },
        supabaseConfig,
      );
      log(`Created contact: ${contact.id}`);
    }

    // Generate HeyGen video (async - sends video when ready)
    if (config.heygen?.avatarId && config.heygen?.voiceId) {
      generateAndSendHeyGenVideo(
        phoneNumber,
        firstName ?? "friend",
        config.heygen,
        supabaseConfig,
        sendMessage,
      ).catch((err) => log(`HeyGen error: ${err}`));
    }

    // Get Calendly link
    const calendlyLink = config.calendly
      ? getSchedulingLink(config.calendly) ?? undefined
      : undefined;

    // Build and send welcome message
    const message = buildWelcomeMessage({
      firstName,
      eventName: config.eventName,
      ownerName: config.ownerName,
      calendlyLink,
    });

    await sendMessage(message);
    log(`Sent welcome message to ${phoneNumber}`);

    // Update contact - mark message as sent
    await markMessageSent(phoneNumber, supabaseConfig);

    // Trigger LinkedIn research in background
    if (config.linkedin) {
      triggerLinkedInResearch(phoneNumber, { firstName, lastName }, config.linkedin, supabaseConfig)
        .catch((err) => log(`LinkedIn research error: ${err}`));
    }

    return {
      handled: true,
      reason: "first_contact_welcomed",
      contactId: contact.id,
    };
  } catch (error) {
    log(`Error handling first contact: ${error}`);
    return {
      handled: false,
      reason: `error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Generate HeyGen video and send it when ready
 */
async function generateAndSendHeyGenVideo(
  phoneNumber: string,
  recipientName: string,
  heygenConfig: HeyGenConfig,
  supabaseConfig: SupabaseConfig,
  sendMessage: (text: string) => Promise<void>,
): Promise<void> {
  try {
    log(`Generating HeyGen video for ${recipientName}...`);
    const result = await generatePersonalizedVideo(
      heygenConfig,
      recipientName,
    );

    if (result.videoId) {
      await updateContactByPhone(
        phoneNumber,
        {
          heygen_video_id: result.videoId,
          heygen_video_url: result.videoUrl,
        },
        supabaseConfig,
      );
      log(`Saved HeyGen video for ${phoneNumber}: ${result.videoId}`);

      // Send video to user if URL is available
      if (result.videoUrl) {
        const videoMessage = `Here's a quick personalized video I made for you: ${result.videoUrl}`;
        await sendMessage(videoMessage);
        log(`Sent HeyGen video to ${phoneNumber}`);
      } else if (result.status === "pending" || result.status === "processing") {
        log(`HeyGen video ${result.videoId} still processing, will need webhook to send`);
      }
    }
  } catch (error) {
    log(`Failed to generate HeyGen video: ${error}`);
  }
}

/**
 * Trigger LinkedIn research in background
 */
async function triggerLinkedInResearch(
  phoneNumber: string,
  params: { firstName?: string; lastName?: string },
  linkedinConfig: { provider?: string; apiKey?: string },
  supabaseConfig: SupabaseConfig,
): Promise<void> {
  try {
    // This would need email to effectively research
    // For now just log that we'd do it
    log(`LinkedIn research triggered for ${phoneNumber} (needs email)`);

    // Once we have email, we can call enrichContactWithLinkedIn
    // The follow-up handler will trigger this after email is collected
  } catch (error) {
    log(`LinkedIn research failed: ${error}`);
  }
}

/**
 * Check if a message should trigger first contact handler
 */
export function isFirstContact(params: {
  phoneNumber: string;
  isGroup: boolean;
  isFromMe: boolean;
  config: NetworkingEventConfig;
}): boolean {
  // Only handle DMs
  if (params.isGroup) {
    return false;
  }

  // Don't handle our own messages
  if (params.isFromMe) {
    return false;
  }

  // Must be enabled
  if (!params.config.enabled) {
    return false;
  }

  return true;
}
