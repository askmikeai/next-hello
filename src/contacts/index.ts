/**
 * Contact Repository
 *
 * Re-exports from postgres-repo for backwards compatibility.
 * All consumer code can import from this file or directly from postgres-repo.
 */

export {
  // Client access
  getDatabaseClient,
  getSupabaseClient, // Backwards compatibility alias
  resetDatabaseClient,
  // Find operations
  findContactByPhone,
  findContactByEmail,
  findContactByCrmId,
  // Create/Update operations
  createContact,
  updateContactByPhone,
  updateContactById,
  updateContactStatus,
  // Specialized updates
  updateHeyGenVideo,
  updateCalendlyBooking,
  updateCrmSync,
  markMessageSent,
  // Delete
  deleteContactByPhone,
  // Query operations
  getContactsByStatus,
  getContactsNeedingCrmSync,
  getContactsByEvent,
  getContactsWithPendingVideos,
  // Types
  type RepoConfig,
} from "./postgres-repo.js";
