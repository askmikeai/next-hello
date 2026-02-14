/**
 * Media Storage Module
 *
 * GDPR-compliant media storage system with support for multiple backends.
 *
 * @example
 * ```typescript
 * import { getMediaStore } from './storage';
 *
 * const mediaStore = getMediaStore();
 *
 * // Store media with GDPR tracking
 * const result = await mediaStore.store({
 *   phoneNumber: '+1234567890',
 *   mediaType: 'voice',
 *   data: audioBuffer,
 *   mimeType: 'audio/ogg',
 *   source: 'generated',
 * });
 *
 * // GDPR: List all media for a contact
 * const summary = await mediaStore.listContactMedia('+1234567890');
 *
 * // GDPR: Delete all media for a contact
 * const deleteResult = await mediaStore.deleteContactMedia('+1234567890', true);
 * ```
 */

// Storage client
export {
  getStorageManager,
  getDefaultDisk,
  getDisk,
  getStorageConfiguration,
  checkStorageHealth,
  resetStorageManager,
  useFakeStorage,
  restoreStorage,
} from "./client.js";

// Media store
export {
  MediaStore,
  getMediaStore,
  resetMediaStore,
} from "./media-store.js";

// Types
export type {
  MediaCategory,
  MediaSource,
  RetentionPolicy,
  MediaFile,
  StoreMediaInput,
  StoreMediaResult,
  ContactMediaSummary,
  DeleteMediaResult,
  StorageBackendConfig,
  MediaFileRow,
} from "./types.js";

export { rowToMediaFile } from "./types.js";
