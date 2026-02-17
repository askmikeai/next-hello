/**
 * People Data Labs Integration
 *
 * Provides person and company enrichment from PDL's database
 * of 3+ billion profiles.
 *
 * Use the queued functions (enrichPersonQueued, enrichContactQueued) for
 * rate-limited access that respects PDL API limits.
 */

export {
  // Main enrichment functions (direct API calls - use queued versions when possible)
  enrichPerson,
  enrichCompany,
  enrichContact,

  // Convenience functions (direct API calls)
  enrichByEmail,
  enrichByPhone,
  enrichByLinkedIn,
  enrichByNameAndCompany,

  // Utility
  checkApiKey,

  // Types
  type PDLPersonEnrichmentParams,
  type PDLPersonRecord,
  type PDLExperience,
  type PDLEducation,
  type PDLCertification,
  type PDLProfile,
  type PDLEnrichmentResult,
  type PDLCompanyEnrichmentParams,
  type PDLCompanyRecord,
  type PDLCompanyResult,
} from "./client.js";

// Queued enrichment functions (rate-limited via BullMQ)
export {
  enrichPersonQueued,
  enrichCompanyQueued,
  enrichContactQueued,
  enqueuePersonEnrichment,
} from "./queue.js";
