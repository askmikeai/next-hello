import type {
  NetworkingContact,
  NetworkingEventConfig,
  SupabaseConfig,
} from "../config/types.js";
import {
  findContactByPhone,
  updateContactByPhone,
} from "../contacts/index.js";
import {
  getMissingRequiredFields,
  needsChatbotInteraction,
} from "../contacts/state-machine.js";
import {
  extractFieldsFromMessage,
  validateField,
  formatFieldList,
} from "../contacts/field-validator.js";
import { createHubSpotProvider } from "../integrations/crm/hubspot.js";
import { getSchedulingLink } from "../integrations/calendly/client.js";
import { enrichContactWithLinkedIn } from "../integrations/linkedin/client.js";
import { shouldUseSwarm, getOrchestrator } from "../swarm/index.js";

export interface FollowUpParams {
  phoneNumber: string;
  messageText: string;
  config: NetworkingEventConfig;
  sendMessage: (text: string) => Promise<void>;
  /** Send a voice message (TTS) instead of text */
  sendVoiceMessage?: (text: string) => Promise<void>;
  /** Whether the original message was a voice note */
  isVoiceMessage?: boolean;
}

export interface FollowUpResult {
  handled: boolean;
  reason: string;
  fieldsCollected?: string[];
  allFieldsComplete?: boolean;
}

function log(message: string): void {
  console.log(`[follow-up] ${message}`);
}

/**
 * Handle follow-up messages from known contacts
 *
 * Routes to AI swarm when enabled, otherwise uses rule-based handling.
 */
export async function handleFollowUp(
  params: FollowUpParams,
): Promise<FollowUpResult> {
  const { phoneNumber, messageText, config, sendMessage } = params;
  const supabaseConfig: SupabaseConfig = config.supabase ?? {};
  const requiredFields = config.requiredFields ?? ["email", "company_name", "job_title"];

  log(`Follow-up from ${phoneNumber}: "${messageText.substring(0, 50)}..."`);

  // Check if we should use AI swarm
  if (shouldUseSwarm(config, phoneNumber)) {
    return handleFollowUpWithSwarm(params);
  }

  // Otherwise use rule-based handling
  return handleFollowUpRuleBased(params);
}

/**
 * Handle follow-up using AI swarm orchestrator
 */
async function handleFollowUpWithSwarm(
  params: FollowUpParams,
): Promise<FollowUpResult> {
  const { phoneNumber, messageText, config, sendMessage, sendVoiceMessage, isVoiceMessage } = params;

  log(`Using AI swarm for ${phoneNumber}${isVoiceMessage ? ' (voice message)' : ''}`);

  try {
    const contact = await findContactByPhone(phoneNumber, config.supabase);
    const orchestrator = getOrchestrator(config);

    const result = await orchestrator.processMessage(
      phoneNumber,
      messageText,
      "whatsapp",
      contact ?? undefined,
      { isVoiceMessage }
    );

    if (result.success && result.response) {
      // Reply with voice if the user sent a voice message and we have voice capability
      if (isVoiceMessage && sendVoiceMessage) {
        log(`Sending voice response to ${phoneNumber}`);
        await sendVoiceMessage(result.response);
      } else {
        await sendMessage(result.response);
      }

      return {
        handled: true,
        reason: "swarm_handled",
        allFieldsComplete: result.data?.fieldsComplete === true,
      };
    }

    // Swarm failed, fall back to rules if configured
    if (config.swarm?.fallbackToRules !== false) {
      log(`Swarm failed, falling back to rules: ${result.error}`);
      return handleFollowUpRuleBased(params);
    }

    return {
      handled: false,
      reason: `swarm_error: ${result.error}`,
    };
  } catch (error) {
    log(`Swarm error: ${error}`);

    // Fall back to rules if configured
    if (config.swarm?.fallbackToRules !== false) {
      return handleFollowUpRuleBased(params);
    }

    return {
      handled: false,
      reason: `swarm_exception: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Handle follow-up using rule-based pattern matching (original implementation)
 */
async function handleFollowUpRuleBased(
  params: FollowUpParams,
): Promise<FollowUpResult> {
  const { phoneNumber, messageText, config, sendMessage } = params;
  const supabaseConfig: SupabaseConfig = config.supabase ?? {};
  const requiredFields = config.requiredFields ?? ["email", "company_name", "job_title"];

  try {
    // Get contact
    const contact = await findContactByPhone(phoneNumber, supabaseConfig);

    if (!contact) {
      log(`Contact ${phoneNumber} not found`);
      return { handled: false, reason: "contact_not_found" };
    }

    // Check if we need to collect fields
    if (!needsChatbotInteraction(contact, requiredFields)) {
      log(`Contact ${phoneNumber} doesn't need chatbot interaction`);
      return { handled: false, reason: "no_interaction_needed" };
    }

    // Extract any fields from the message
    const extracted = extractFieldsFromMessage(messageText);
    const fieldsCollected: string[] = [];

    // Also try to detect other fields from message content
    const updates: Partial<NetworkingContact> = {};

    // Check for email in extracted
    if (extracted.email) {
      const validation = validateField("email", extracted.email);
      if (validation.valid) {
        updates.email = validation.value;
        fieldsCollected.push("email");
      }
    }

    // Check for LinkedIn URL
    if (extracted.linkedin_url) {
      const validation = validateField("linkedin_url", extracted.linkedin_url);
      if (validation.valid) {
        updates.linkedin_url = validation.value;
        fieldsCollected.push("linkedin_url");
      }
    }

    // Try to detect company and job title from natural language
    const detectedFields = detectFieldsFromText(messageText, contact, requiredFields);
    for (const [field, value] of Object.entries(detectedFields)) {
      if (!updates[field as keyof NetworkingContact]) {
        updates[field as keyof NetworkingContact] = value as never;
        fieldsCollected.push(field);
      }
    }

    // Update contact if we found new info
    if (Object.keys(updates).length > 0) {
      await updateContactByPhone(phoneNumber, updates, supabaseConfig);
      log(`Updated ${phoneNumber} with: ${fieldsCollected.join(", ")}`);
    }

    // Refresh contact and check status
    const updatedContact = await findContactByPhone(phoneNumber, supabaseConfig);
    if (!updatedContact) {
      return { handled: false, reason: "refresh_failed" };
    }

    const missingFields = getMissingRequiredFields(updatedContact, requiredFields);
    const allFieldsComplete = missingFields.length === 0;

    // Note: Status updates skipped - database only supports active/inactive/archived

    // Build response
    const response = buildFollowUpResponse({
      contact: updatedContact,
      fieldsCollected,
      missingFields,
      allFieldsComplete,
      config,
    });

    await sendMessage(response);

    // If all fields complete, trigger background tasks
    if (allFieldsComplete) {
      triggerCompletionTasks(phoneNumber, updatedContact, config, supabaseConfig)
        .catch((err) => log(`Completion tasks error: ${err}`));
    }

    // If we just got email, trigger LinkedIn research
    if (fieldsCollected.includes("email") && updatedContact.email) {
      triggerLinkedInResearchWithEmail(phoneNumber, updatedContact, config, supabaseConfig)
        .catch((err) => log(`LinkedIn research error: ${err}`));
    }

    return {
      handled: true,
      reason: allFieldsComplete ? "fields_complete" : "fields_collected",
      fieldsCollected,
      allFieldsComplete,
    };
  } catch (error) {
    log(`Error handling follow-up: ${error}`);
    return {
      handled: false,
      reason: `error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Try to detect fields from natural text
 */
function detectFieldsFromText(
  text: string,
  contact: NetworkingContact,
  requiredFields: string[],
): Record<string, string> {
  const fields: Record<string, string> = {};
  const lowerText = text.toLowerCase();

  // Look for patterns like "I work at X" or "I'm at X"
  const companyPatterns = [
    /(?:i work at|i'm at|i am at|working at|work for)\s+([^.,!?\n]+)/i,
    /(?:company is|company's)\s+([^.,!?\n]+)/i,
    /^([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\s*$/m, // Capitalized words on own line might be company
  ];

  if (requiredFields.includes("company_name") && !contact.company_name) {
    for (const pattern of companyPatterns) {
      const match = text.match(pattern);
      if (match && match[1].trim().length > 1) {
        const company = match[1].trim();
        // Filter out common false positives
        if (!["I", "We", "My", "Our", "The", "Hi", "Hey", "Yes", "No"].includes(company)) {
          fields.company_name = company;
          break;
        }
      }
    }
  }

  // Look for job title patterns
  const titlePatterns = [
    /(?:i'm a|i am a|i'm the|i am the|my role is|my title is)\s+([^.,!?\n]+)/i,
    /(?:work as|working as)\s+([^.,!?\n]+)/i,
  ];

  if (requiredFields.includes("job_title") && !contact.job_title) {
    for (const pattern of titlePatterns) {
      const match = text.match(pattern);
      if (match && match[1].trim().length > 1) {
        fields.job_title = match[1].trim();
        break;
      }
    }
  }

  return fields;
}

/**
 * Build appropriate follow-up response
 */
function buildFollowUpResponse(params: {
  contact: NetworkingContact;
  fieldsCollected: string[];
  missingFields: string[];
  allFieldsComplete: boolean;
  config: NetworkingEventConfig;
}): string {
  const { contact, fieldsCollected, missingFields, allFieldsComplete, config } = params;
  const firstName = contact.first_name ?? "there";

  if (allFieldsComplete) {
    const calendlyLink = config.calendly
      ? getSchedulingLink(config.calendly)
      : null;

    const lines = [
      `Thanks ${firstName}! I've got everything I need.`,
      "",
    ];

    if (calendlyLink) {
      lines.push(
        `If you'd like to schedule a call with ${config.ownerName ?? "us"}, here's the link: ${calendlyLink}`,
      );
    } else {
      lines.push(
        `${config.ownerName ?? "We"}'ll be in touch soon to set up a time to connect!`,
      );
    }

    return lines.join("\n");
  }

  // Acknowledge what we captured
  const lines: string[] = [];

  if (fieldsCollected.length > 0) {
    lines.push(`Got it, thanks!`);
    lines.push("");
  }

  // Ask for remaining fields naturally
  if (missingFields.length === 1) {
    lines.push(`Just one more thing - what's your ${formatFieldList(missingFields)}?`);
  } else if (missingFields.length === 2) {
    lines.push(`Could you also share your ${formatFieldList(missingFields)}?`);
  } else {
    lines.push(
      `To help ${config.ownerName ?? "us"} prepare for your conversation, could you share your ${formatFieldList(missingFields.slice(0, 2))}?`,
    );
  }

  return lines.join("\n");
}

/**
 * Trigger tasks when all fields are complete
 */
async function triggerCompletionTasks(
  phoneNumber: string,
  contact: NetworkingContact,
  config: NetworkingEventConfig,
  supabaseConfig: SupabaseConfig,
): Promise<void> {
  log(`Triggering completion tasks for ${phoneNumber}`);

  // Sync to CRM
  if (config.crm?.provider === "hubspot") {
    try {
      const provider = createHubSpotProvider(config.crm);
      if (provider.isConfigured()) {
        const result = await provider.syncContact(contact);
        if (result.success && result.contactId) {
          await updateContactByPhone(
            phoneNumber,
            {
              crm_contact_id: result.contactId,
              crm_synced_at: new Date().toISOString(),
            },
            supabaseConfig,
          );
          log(`Synced ${phoneNumber} to HubSpot: ${result.contactId}`);
        }
      }
    } catch (error) {
      log(`CRM sync failed: ${error}`);
    }
  }
}

/**
 * Trigger LinkedIn research after email is collected
 */
async function triggerLinkedInResearchWithEmail(
  phoneNumber: string,
  contact: NetworkingContact,
  config: NetworkingEventConfig,
  supabaseConfig: SupabaseConfig,
): Promise<void> {
  if (!config.linkedin || !contact.email) {
    return;
  }

  log(`Triggering LinkedIn research for ${phoneNumber} with email ${contact.email}`);

  try {
    const profile = await enrichContactWithLinkedIn(
      {
        email: contact.email,
        firstName: contact.first_name ?? undefined,
        lastName: contact.last_name ?? undefined,
        companyName: contact.company_name ?? undefined,
      },
      config.linkedin,
    );

    if (profile) {
      const updates: Partial<NetworkingContact> = {};

      if (profile.profileUrl && !contact.linkedin_url) {
        updates.linkedin_url = profile.profileUrl;
      }
      if (profile.company && !contact.company_name) {
        updates.company_name = profile.company;
      }
      if (profile.title && !contact.job_title) {
        updates.job_title = profile.title;
      }
      if (profile.industry && !contact.industry) {
        updates.industry = profile.industry;
      }

      if (Object.keys(updates).length > 0) {
        await updateContactByPhone(phoneNumber, updates, supabaseConfig);
        log(`Enriched ${phoneNumber} with LinkedIn data`);
      }
    }
  } catch (error) {
    log(`LinkedIn enrichment failed: ${error}`);
  }
}

/**
 * Check if a message should be handled by follow-up handler
 */
export function isFollowUpMessage(params: {
  phoneNumber: string;
  isGroup: boolean;
  isFromMe: boolean;
  config: NetworkingEventConfig;
}): boolean {
  // Same criteria as first contact
  if (params.isGroup) return false;
  if (params.isFromMe) return false;
  if (!params.config.enabled) return false;
  return true;
}
