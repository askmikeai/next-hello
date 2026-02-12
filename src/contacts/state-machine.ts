import type { ContactStatus, NetworkingContact } from "../config/types.js";

/**
 * Contact workflow state machine
 *
 * States:
 * - new: Just created, no interaction yet
 * - welcomed: Welcome message sent, HeyGen video triggered
 * - collecting: AI chatbot is collecting missing fields
 * - fields_complete: All required fields collected
 * - synced: Contact synced to CRM
 * - meeting_scheduled: Calendly meeting booked
 * - complete: Workflow complete (all done)
 */

export type StateTransition = {
  from: ContactStatus;
  to: ContactStatus;
  trigger: string;
};

const VALID_TRANSITIONS: StateTransition[] = [
  // Initial welcome flow
  { from: "new", to: "welcomed", trigger: "welcome_sent" },

  // Collecting fields
  { from: "welcomed", to: "collecting", trigger: "start_collection" },
  { from: "collecting", to: "collecting", trigger: "field_updated" },
  { from: "collecting", to: "fields_complete", trigger: "all_fields_collected" },

  // Skip collection if already complete
  { from: "welcomed", to: "fields_complete", trigger: "all_fields_collected" },

  // CRM sync
  { from: "fields_complete", to: "synced", trigger: "crm_synced" },

  // Meeting scheduled (can happen from multiple states)
  { from: "welcomed", to: "meeting_scheduled", trigger: "meeting_booked" },
  { from: "collecting", to: "meeting_scheduled", trigger: "meeting_booked" },
  { from: "fields_complete", to: "meeting_scheduled", trigger: "meeting_booked" },
  { from: "synced", to: "meeting_scheduled", trigger: "meeting_booked" },

  // Complete
  { from: "synced", to: "complete", trigger: "workflow_complete" },
  { from: "meeting_scheduled", to: "complete", trigger: "workflow_complete" },
];

/**
 * Check if a state transition is valid
 */
export function isValidTransition(
  from: ContactStatus,
  to: ContactStatus,
): boolean {
  return VALID_TRANSITIONS.some((t) => t.from === from && t.to === to);
}

/**
 * Get valid next states from current state
 */
export function getValidNextStates(current: ContactStatus): ContactStatus[] {
  return [...new Set(VALID_TRANSITIONS.filter((t) => t.from === current).map((t) => t.to))];
}

/**
 * Determine next status based on contact data and required fields
 */
export function determineNextStatus(
  contact: NetworkingContact,
  requiredFields: string[],
): ContactStatus {
  const currentStatus = contact.status ?? "new";

  // If new, next step is welcome
  if (currentStatus === "new") {
    return "welcomed";
  }

  // Check if all required fields are present
  const missingFields = getMissingRequiredFields(contact, requiredFields);
  const allFieldsComplete = missingFields.length === 0;

  // If welcomed and all fields complete, skip to fields_complete
  if (currentStatus === "welcomed" && allFieldsComplete) {
    return "fields_complete";
  }

  // If welcomed and missing fields, start collecting
  if (currentStatus === "welcomed" && !allFieldsComplete) {
    return "collecting";
  }

  // If collecting and now complete, move to fields_complete
  if (currentStatus === "collecting" && allFieldsComplete) {
    return "fields_complete";
  }

  // If fields_complete and CRM synced
  if (currentStatus === "fields_complete" && contact.crm_synced_at) {
    return "synced";
  }

  // If meeting is scheduled, check if we can complete
  if (currentStatus === "meeting_scheduled" && contact.crm_synced_at) {
    return "complete";
  }

  // If synced and meeting scheduled
  if (currentStatus === "synced" && contact.calendly_scheduled_at) {
    return "complete";
  }

  // Stay in current status if no transition applies
  return currentStatus;
}

/**
 * Get missing required fields from contact
 */
export function getMissingRequiredFields(
  contact: NetworkingContact,
  requiredFields: string[],
): string[] {
  const missing: string[] = [];

  for (const field of requiredFields) {
    const value = contact[field as keyof NetworkingContact];
    if (value === null || value === undefined || value === "") {
      missing.push(field);
    }
  }

  return missing;
}

/**
 * Check if contact workflow is complete
 */
export function isWorkflowComplete(contact: NetworkingContact): boolean {
  return contact.status === "complete";
}

/**
 * Check if contact needs AI chatbot interaction
 */
export function needsChatbotInteraction(
  contact: NetworkingContact,
  requiredFields: string[],
): boolean {
  // If welcome message was sent, they need chatbot interaction to collect fields
  if (!contact.sent_personalized_message) {
    return false;
  }

  // Check if there are missing fields to collect
  return getMissingRequiredFields(contact, requiredFields).length > 0;
}

/**
 * Get human-readable status description
 */
export function getStatusDescription(status: ContactStatus): string {
  const descriptions: Record<ContactStatus, string> = {
    // Database statuses
    active: "Active contact",
    inactive: "Inactive contact",
    archived: "Archived contact",
    // Workflow statuses
    new: "New contact, pending welcome message",
    welcomed: "Welcome message sent, awaiting response",
    collecting: "AI chatbot collecting information",
    fields_complete: "All required information collected",
    synced: "Contact synced to CRM",
    meeting_scheduled: "Meeting scheduled via Calendly",
    complete: "Workflow complete",
  };

  return descriptions[status] ?? "Unknown status";
}
