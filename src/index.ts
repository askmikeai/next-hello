/**
 * Networking Event Automation Plugin
 *
 * Multi-channel follow-up automation for networking events with:
 * - AI chatbot for natural data collection
 * - HeyGen personalized video generation
 * - Calendly scheduling integration
 * - LinkedIn research via ProxyCurl
 * - Email sending via SendGrid/Resend
 * - CRM sync with HubSpot
 *
 * @module @openclaw/networking-event
 */

// Config
export { networkingEventConfigSchema, parseConfig, safeParseConfig } from "./config/schema.js";
export type {
  NetworkingEventConfig,
  NetworkingContact,
  ContactStatus,
  SupportedChannel,
  SupabaseConfig,
  HeyGenConfig,
  CalendlyConfig,
  LinkedInConfig,
  EmailConfig,
  CrmConfig,
  AgentConfig,
  LinkedInProfile,
  HubSpotContact,
} from "./config/types.js";

// Contacts
export {
  getSupabaseClient, // Backwards compatibility alias
  getDatabaseClient,
  findContactByPhone,
  findContactByEmail,
  findContactByCrmId,
  createContact,
  updateContactByPhone,
  updateContactById,
  updateContactStatus,
  updateHeyGenVideo,
  updateCalendlyBooking,
  updateCrmSync,
  markMessageSent,
  getContactsByStatus,
  getContactsNeedingCrmSync,
  getContactsByEvent,
  getContactsWithPendingVideos,
} from "./contacts/index.js";

// Database
export {
  getDatabase,
  isDatabaseConfigured,
  checkDatabaseHealth,
  closeDatabase,
} from "./database/client.js";

export {
  isValidTransition,
  getValidNextStates,
  determineNextStatus,
  getMissingRequiredFields,
  isWorkflowComplete,
  needsChatbotInteraction,
  getStatusDescription,
} from "./contacts/state-machine.js";

export {
  validateEmail,
  validateCompanyName,
  validateJobTitle,
  validateLinkedInUrl,
  validateField,
  getMissingFields,
  hasAllRequiredFields,
  formatFieldName,
  formatFieldList,
  extractFieldsFromMessage,
  parseFieldUpdates,
} from "./contacts/field-validator.js";

// Integrations
export {
  generatePersonalizedVideo,
  getVideoStatus,
  parseWebhookPayload as parseHeyGenWebhook,
  listAvatars,
  listVoices,
} from "./integrations/heygen/client.js";

export {
  getCurrentUser as getCalendlyUser,
  listEventTypes,
  getEvent,
  getEventInvitees,
  createWebhookSubscription,
  verifyWebhookSignature as verifyCalendlySignature,
  parseWebhookPayload as parseCalendlyWebhook,
  getSchedulingLink,
  formatEventSummary,
} from "./integrations/calendly/client.js";

export {
  lookupProfileByUrl,
  lookupProfileByEmail,
  lookupCompany,
  enrichContactWithLinkedIn,
  extractLinkedInUrl,
  isValidLinkedInUrl,
  getProfileType,
} from "./integrations/linkedin/client.js";

export {
  sendEmail,
  sendWelcomeEmail,
  sendMeetingConfirmationEmail,
  sendCrmSyncNotification,
  isValidEmail,
} from "./integrations/email/client.js";

export {
  toCrmContactData,
  applyPropertyMappings,
  normalizePhoneForCrm,
} from "./integrations/crm/base.js";
export type { CrmContactData, CrmOperationResult, CrmProvider } from "./integrations/crm/base.js";

export { HubSpotProvider, createHubSpotProvider } from "./integrations/crm/hubspot.js";

// Agent
export {
  buildSystemPrompt,
  buildContactContext,
  buildFirstContactPrompt,
  buildMissingFieldsPrompt,
  buildCompletedContactPrompt,
} from "./agent/prompts.js";

export { contactLookup, contactLookupTool } from "./agent/tools/contact-lookup.js";
export { contactUpdate, contactUpdateTool } from "./agent/tools/contact-update.js";
export { heygenVideo, checkVideoStatus, heygenVideoTool, checkVideoStatusTool } from "./agent/tools/heygen-video.js";
export { calendlyLink, calendlyLinkTool } from "./agent/tools/calendly-link.js";
export { linkedinResearch, linkedinResearchTool } from "./agent/tools/linkedin-research.js";
export { sendEmailTool, sendEmailToolDef } from "./agent/tools/send-email.js";
export { crmSync, crmSyncTool } from "./agent/tools/crm-sync.js";

// Handlers
export { handleFirstContact, isFirstContact } from "./handlers/first-contact.js";
export { handleFollowUp, isFollowUpMessage } from "./handlers/follow-up.js";

// Webhooks
export {
  registerWebhookRoute,
  getWebhookRoutes,
  matchRoute,
  parseJsonBody,
  getRawBody,
  sendJsonResponse,
  sendSuccess,
  sendError,
  logWebhook,
} from "./webhooks/registry.js";

export { handleCalendlyWebhook, getCalendlyWebhookPath } from "./webhooks/calendly.js";
export { handleHeyGenWebhook, getHeyGenWebhookPath } from "./webhooks/heygen.js";
