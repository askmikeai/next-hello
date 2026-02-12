/**
 * NextHello - Turn event connections into conversations
 *
 * AI-powered follow-up automation with personalized videos,
 * smart data collection, and CRM sync.
 */

// Re-export everything from src
export * from "./src/index.js";

// Main exports for convenience
export {
  handleFirstContact,
  isFirstContact,
} from "./src/handlers/first-contact.js";

export {
  handleFollowUp,
  isFollowUpMessage,
} from "./src/handlers/follow-up.js";

export {
  findContactByPhone,
  findContactByEmail,
  createContact,
  updateContactByPhone,
  getContactsByStatus,
} from "./src/contacts/supabase-repo.js";

export {
  parseConfig,
  safeParseConfig,
  networkingEventConfigSchema,
} from "./src/config/schema.js";

export type { NetworkingEventConfig, NetworkingContact } from "./src/config/types.js";

// Version
export const VERSION = "1.0.0";
