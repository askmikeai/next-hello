/**
 * Media Storage Types
 *
 * Type definitions for the GDPR-compliant media storage system.
 */

/**
 * Category of media file
 */
export type MediaCategory = "voice" | "video" | "image" | "document" | "avatar";

/**
 * Source of the media file
 */
export type MediaSource = "generated" | "uploaded" | "received" | "downloaded";

/**
 * Retention policy for automatic cleanup
 */
export type RetentionPolicy = "standard" | "extended" | "temporary" | "permanent";

/**
 * Media file record (maps to database)
 */
export interface MediaFile {
  id: string;
  contactId?: string | null;
  phoneNumber: string;
  storageKey: string;
  storageBackend: string;
  mediaType: MediaCategory;
  mimeType: string;
  sizeBytes: number;
  checksumSha256?: string | null;
  source: MediaSource;
  sourceUrl?: string | null;
  retentionPolicy: RetentionPolicy;
  expiresAt?: Date | null;
  createdAt: Date;
  accessedAt: Date;
  deletedAt?: Date | null;
}

/**
 * Input for storing media
 */
export interface StoreMediaInput {
  phoneNumber: string;
  contactId?: string;
  mediaType: MediaCategory;
  data: Buffer;
  mimeType: string;
  source: MediaSource;
  sourceUrl?: string;
  retentionPolicy?: RetentionPolicy;
  expiresAt?: Date;
  filename?: string;
}

/**
 * Result of storing media
 */
export interface StoreMediaResult {
  success: boolean;
  mediaFile?: MediaFile;
  storageKey?: string;
  error?: string;
}

/**
 * Summary of contact's media for GDPR requests
 */
export interface ContactMediaSummary {
  phoneNumber: string;
  contactId?: string;
  totalFiles: number;
  totalSizeBytes: number;
  byCategory: Record<MediaCategory, number>;
  files: MediaFile[];
}

/**
 * Result of deleting contact media
 */
export interface DeleteMediaResult {
  success: boolean;
  filesDeleted: number;
  filesErrored: number;
  totalSizeFreed: number;
  hardDelete: boolean;
  errors?: string[];
}

/**
 * Storage backend configuration
 */
export interface StorageBackendConfig {
  /** Storage backend type */
  backend: "local" | "s3" | "r2";

  /** Local filesystem configuration */
  local?: {
    basePath: string;
  };

  /** S3/R2 configuration */
  s3?: {
    bucket: string;
    region?: string;
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    forcePathStyle?: boolean;
  };

  /** Retention settings */
  retention?: {
    defaultDays: number;
    autoCleanup: boolean;
    cleanupIntervalMinutes?: number;
  };
}

/**
 * Database row for media_files table
 */
export interface MediaFileRow {
  id: string;
  contact_id: string | null;
  phone_number: string;
  storage_key: string;
  storage_backend: string;
  media_type: string;
  mime_type: string;
  size_bytes: string; // bigint comes as string
  checksum_sha256: string | null;
  source: string;
  source_url: string | null;
  retention_policy: string;
  expires_at: Date | null;
  created_at: Date;
  accessed_at: Date;
  deleted_at: Date | null;
}

/**
 * Convert database row to MediaFile interface
 */
export function rowToMediaFile(row: MediaFileRow): MediaFile {
  return {
    id: row.id,
    contactId: row.contact_id,
    phoneNumber: row.phone_number,
    storageKey: row.storage_key,
    storageBackend: row.storage_backend,
    mediaType: row.media_type as MediaCategory,
    mimeType: row.mime_type,
    sizeBytes: parseInt(row.size_bytes, 10),
    checksumSha256: row.checksum_sha256,
    source: row.source as MediaSource,
    sourceUrl: row.source_url,
    retentionPolicy: row.retention_policy as RetentionPolicy,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    accessedAt: row.accessed_at,
    deletedAt: row.deleted_at,
  };
}
