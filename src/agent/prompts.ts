import type { NetworkingContact, NetworkingEventConfig } from "../config/types.js";
import { formatFieldList, getMissingFields } from "../contacts/field-validator.js";
import { getStatusDescription } from "../contacts/state-machine.js";

/**
 * Build the system prompt for the AI chatbot
 */
export function buildSystemPrompt(config: NetworkingEventConfig): string {
  const ownerName = config.ownerName ?? "the host";
  const eventName = config.eventName ?? "the event";
  const requiredFields = config.requiredFields ?? ["email", "company_name", "job_title"];

  const fieldDescriptions = requiredFields
    .map((field) => {
      switch (field) {
        case "email":
          return "- Email address (for follow-up communication)";
        case "company_name":
          return "- Company name (where they work)";
        case "job_title":
          return "- Job title / role";
        case "industry":
          return "- Industry sector";
        case "linkedin_url":
          return "- LinkedIn profile URL";
        case "first_name":
          return "- First name";
        case "last_name":
          return "- Last name";
        default:
          return `- ${field.replace(/_/g, " ")}`;
      }
    })
    .join("\n");

  return `You are ${ownerName}'s AI assistant, helping follow up with contacts from ${eventName}.

## Your Role
You're having natural conversations to:
1. Build rapport and maintain the connection from the event
2. Collect missing contact information organically
3. Schedule follow-up meetings when appropriate
4. Answer questions about ${ownerName} and their work

## Required Information to Collect
${fieldDescriptions}

## Conversation Guidelines

### Be Natural
- Converse like a helpful human assistant, not a form-filler
- Reference the event and any context you have about the contact
- Ask for information conversationally, not as a checklist
- If they provide information naturally, capture it immediately

### Be Efficient
- Don't ask for information you already have
- Acknowledge what they share before asking for more
- If they seem busy, offer to continue later

### Be Helpful
- If they mention a pain point, briefly note how ${ownerName} might help
- Offer the Calendly link when it feels natural
- If they ask questions, answer if you can or note for ${ownerName}

## Tools Available
- contact_lookup: Check what information you have
- contact_update: Save new information they provide
- calendly_link: Get scheduling link to share
- heygen_video: Generate personalized video (if not already sent)
- linkedin_research: Look up their professional background
- send_email: Send follow-up emails
- crm_sync: Sync completed contacts to CRM

## Example Flows

### New Contact Response
"Hey! Great to hear from you. [Name] mentioned meeting you at ${eventName}.
I'd love to help coordinate a follow-up - what's the best email to reach you at?"

### Collecting Company Info
"Great, I've got your email. And you're at [company] as a [role], right?
Just want to make sure [Name] has the full picture before your call."

### When All Info Collected
"Perfect, I've got everything I need! I'll sync this over to [Name]'s calendar.
Here's a link to book some time directly: [calendly_link]"

${config.agent?.systemPromptAdditions ?? ""}

Remember: Be helpful, be human, and make every interaction feel valuable.`;
}

/**
 * Build context prompt with contact information
 */
export function buildContactContext(
  contact: NetworkingContact | null,
  requiredFields: string[],
): string {
  if (!contact) {
    return `## Contact Status
This is a NEW contact. You have ZERO information about them.
IMPORTANT: Do NOT claim to have their name, company, or any details - you don't have any yet!
Start fresh by greeting them and asking who they are.`;
  }

  // Check if contact has any meaningful info beyond phone number
  const hasInfo = contact.first_name || contact.email || contact.company_name || contact.job_title;
  if (!hasInfo) {
    return `## Contact Status
Contact exists but you have NO information about them except their phone number.
IMPORTANT: Do NOT claim to know their name, company, or role - you need to ask!
Start by greeting them and asking who they are.`;
  }

  const missingFields = getMissingFields(contact, requiredFields);
  const statusDesc = getStatusDescription(contact.status ?? "new");

  const lines = [
    "## Contact Information",
    `- Phone: ${contact.phone_number}`,
  ];

  if (contact.first_name) lines.push(`- First Name: ${contact.first_name}`);
  if (contact.last_name) lines.push(`- Last Name: ${contact.last_name}`);
  if (contact.email) lines.push(`- Email: ${contact.email}`);
  if (contact.company_name) lines.push(`- Company: ${contact.company_name}`);
  if (contact.job_title) lines.push(`- Job Title: ${contact.job_title}`);
  if (contact.industry) lines.push(`- Industry: ${contact.industry}`);
  if (contact.linkedin_url) lines.push(`- LinkedIn: ${contact.linkedin_url}`);
  if (contact.event_name) lines.push(`- Event: ${contact.event_name}`);

  lines.push("");
  lines.push(`## Status: ${statusDesc}`);

  if (missingFields.length > 0) {
    lines.push("");
    lines.push(
      `## Still Need: ${formatFieldList(missingFields)}`,
    );
    lines.push("Collect this information naturally during conversation.");
  } else {
    lines.push("");
    lines.push("## All required information collected!");
    lines.push("Consider syncing to CRM and offering to schedule a meeting.");
  }

  if (contact.sent_personalized_message) {
    lines.push("");
    lines.push("Note: Personalized welcome message already sent.");
  }

  if (contact.heygen_video_url) {
    lines.push(`HeyGen video available: ${contact.heygen_video_url}`);
  }

  if (contact.calendly_scheduled_at) {
    lines.push(
      `Meeting scheduled: ${new Date(contact.calendly_scheduled_at).toLocaleString()}`,
    );
  }

  if (contact.crm_synced_at) {
    lines.push(`Synced to CRM: ${contact.crm_contact_id}`);
  }

  return lines.join("\n");
}

/**
 * Build prompt for first contact welcome
 */
export function buildFirstContactPrompt(
  firstName: string | undefined,
  eventName: string | undefined,
): string {
  const name = firstName ?? "there";
  const event = eventName ?? "the event";

  return `Generate a warm, brief welcome message for ${name} who we just met at ${event}.

Key points to include:
- Acknowledge meeting them at the event
- Mention you're an AI assistant following up
- Express interest in connecting further
- If a Calendly link is available, mention they can book time

Keep it conversational and under 50 words.`;
}

/**
 * Build prompt for missing field collection
 */
export function buildMissingFieldsPrompt(
  contact: NetworkingContact,
  missingFields: string[],
): string {
  const name = contact.first_name ?? "there";
  const formattedFields = formatFieldList(missingFields);

  return `Continue the conversation with ${name} to naturally collect: ${formattedFields}.

Current context:
- We have their phone number from the event
${contact.email ? `- Email: ${contact.email}` : ""}
${contact.company_name ? `- Works at: ${contact.company_name}` : ""}
${contact.job_title ? `- Role: ${contact.job_title}` : ""}

Ask for the missing information in a natural way, not as a checklist.
If they've shared information that matches required fields, save it immediately using contact_update.`;
}

/**
 * Build prompt for completed contact
 */
export function buildCompletedContactPrompt(
  contact: NetworkingContact,
  hasMeeting: boolean,
  isSyncedToCrm: boolean,
): string {
  const name = contact.first_name ?? "there";

  const actions: string[] = [];

  if (!isSyncedToCrm) {
    actions.push("- Sync contact to CRM using crm_sync");
  }

  if (!hasMeeting) {
    actions.push("- Offer to schedule a meeting with calendly_link");
  }

  if (actions.length === 0) {
    return `${name}'s contact is complete with a meeting scheduled and CRM synced.

If they message:
- Answer any questions helpfully
- Offer additional value where possible
- Keep the connection warm`;
  }

  return `${name}'s contact information is complete!

Suggested actions:
${actions.join("\n")}

Respond warmly and mention next steps.`;
}
