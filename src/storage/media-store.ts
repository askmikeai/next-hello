/**
 * Media Store
 *
 * GDPR-compliant media storage system with tracking and cleanup.
 * Provides methods for storing, retrieving, and managing media files
 * with full audit trail for GDPR compliance.
 */

import { createHash } from "crypto";
import { getDatabase, timedQuery } from "../database/client.js";
import { getDefaultDisk, getStorageConfiguration } from "./client.js";
import type {
  MediaFile,
  MediaFileRow,
  MediaCategory,
  StoreMediaInput,
  StoreMediaResult,
  ContactMediaSummary,
  DeleteMediaResult,
  RetentionPolicy,
  rowToMediaFile,
} from "./types.js";

let mediaStoreInstance: MediaStore | null = null;

/**
 * Get file extension from mime type
 */
function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/wav": "wav",
    "audio/webm": "webm",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "application/pdf": "pdf",
    "application/json": "json",
    "text/plain": "txt",
  };

  // Handle mime types with parameters (e.g., "audio/ogg; codecs=opus")
  const baseMimeType = mimeType.split(";")[0].trim();
  return mimeToExt[baseMimeType] || "bin";
}

/**
 * Generate a unique storage key for media
 */
function generateStorageKey(
  phoneNumber: string,
  mediaType: MediaCategory,
  mimeType: string,
  filename?: string
): string {
  const timestamp = Date.now();
  const phoneClean = phoneNumber.replace(/[^0-9]/g, "");
  const ext = filename?.split(".").pop() || getExtensionFromMimeType(mimeType);
  const randomSuffix = Math.random().toString(36).substring(2, 8);

  return `${mediaType}/${phoneClean}/${timestamp}_${randomSuffix}.${ext}`;
}

/**
 * Calculate SHA-256 checksum of data
 */
function calculateChecksum(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * MediaStore class - manages media files with GDPR compliance
 */
export class MediaStore {
  private tableName = "media_files";

  /**
   * Store media with tracking
   */
  async store(input: StoreMediaInput): Promise<StoreMediaResult> {
    const sql = getDatabase();
    const disk = getDefaultDisk();
    const config = getStorageConfiguration();

    if (!sql) {
      return { success: false, error: "Database not configured" };
    }

    try {
      // Generate storage key
      const storageKey = generateStorageKey(
        input.phoneNumber,
        input.mediaType,
        input.mimeType,
        input.filename
      );

      // Calculate checksum
      const checksum = calculateChecksum(input.data);

      // Determine expiration based on retention policy
      const retentionPolicy = input.retentionPolicy || "standard";
      let expiresAt: Date | null = input.expiresAt || null;

      if (!expiresAt && retentionPolicy !== "permanent") {
        const retentionDays = {
          temporary: 7,
          standard: config.retention?.defaultDays || 90,
          extended: 365,
          permanent: null,
        };
        const days = retentionDays[retentionPolicy];
        if (days) {
          expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + days);
        }
      }

      // Store file to disk
      await disk.put(storageKey, input.data);

      // Record in database
      const [row] = await timedQuery("insert", this.tableName, () =>
        sql<MediaFileRow[]>`
          INSERT INTO media_files (
            contact_id,
            phone_number,
            storage_key,
            storage_backend,
            media_type,
            mime_type,
            size_bytes,
            checksum_sha256,
            source,
            source_url,
            retention_policy,
            expires_at
          ) VALUES (
            ${input.contactId || null},
            ${input.phoneNumber},
            ${storageKey},
            ${config.backend},
            ${input.mediaType},
            ${input.mimeType},
            ${input.data.length},
            ${checksum},
            ${input.source},
            ${input.sourceUrl || null},
            ${retentionPolicy},
            ${expiresAt}
          )
          RETURNING *
        `
      );

      console.log(
        `[media-store] Stored ${input.mediaType} for ${input.phoneNumber}: ${storageKey} (${input.data.length} bytes)`
      );

      return {
        success: true,
        storageKey,
        mediaFile: this.rowToMediaFile(row),
      };
    } catch (error) {
      console.error("[media-store] Failed to store media:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Retrieve media data by storage key
   */
  async get(storageKey: string): Promise<Buffer | null> {
    const sql = getDatabase();
    const disk = getDefaultDisk();

    try {
      // Update access time
      if (sql) {
        await timedQuery("update", this.tableName, () =>
          sql`
            UPDATE media_files
            SET accessed_at = NOW()
            WHERE storage_key = ${storageKey} AND deleted_at IS NULL
          `
        );
      }

      // Get file from disk
      const exists = await disk.exists(storageKey);
      if (!exists) {
        return null;
      }

      const content = await disk.getBytes(storageKey);
      return Buffer.from(content);
    } catch (error) {
      console.error("[media-store] Failed to get media:", error);
      return null;
    }
  }

  /**
   * Get public URL for media (for S3/R2 backends)
   */
  async getUrl(storageKey: string, expiresInSeconds = 3600): Promise<string | null> {
    const disk = getDefaultDisk();
    const config = getStorageConfiguration();

    try {
      const exists = await disk.exists(storageKey);
      if (!exists) {
        return null;
      }

      if (config.backend === "local") {
        // For local, return file path
        return `${config.local?.basePath || "./data/media"}/${storageKey}`;
      }

      // For S3/R2, generate signed URL
      return await disk.getSignedUrl(storageKey, { expiresIn: expiresInSeconds + "s" });
    } catch (error) {
      console.error("[media-store] Failed to get URL:", error);
      return null;
    }
  }

  /**
   * Get local file path for media (for local backend)
   */
  getLocalPath(storageKey: string): string {
    const config = getStorageConfiguration();
    return `${config.local?.basePath || "./data/media"}/${storageKey}`;
  }

  /**
   * GDPR: List all media for a contact
   */
  async listContactMedia(phoneNumber: string): Promise<ContactMediaSummary> {
    const sql = getDatabase();

    const summary: ContactMediaSummary = {
      phoneNumber,
      totalFiles: 0,
      totalSizeBytes: 0,
      byCategory: {
        voice: 0,
        video: 0,
        image: 0,
        document: 0,
        avatar: 0,
      },
      files: [],
    };

    if (!sql) {
      return summary;
    }

    try {
      const rows = await timedQuery("select", this.tableName, () =>
        sql<MediaFileRow[]>`
          SELECT * FROM media_files
          WHERE phone_number = ${phoneNumber} AND deleted_at IS NULL
          ORDER BY created_at DESC
        `
      );

      summary.files = rows.map((row) => this.rowToMediaFile(row));
      summary.totalFiles = rows.length;
      summary.totalSizeBytes = rows.reduce(
        (sum, row) => sum + parseInt(row.size_bytes, 10),
        0
      );

      // Count by category
      for (const row of rows) {
        const category = row.media_type as MediaCategory;
        if (category in summary.byCategory) {
          summary.byCategory[category]++;
        }
      }

      // Set contact ID if available
      if (rows.length > 0 && rows[0].contact_id) {
        summary.contactId = rows[0].contact_id;
      }

      return summary;
    } catch (error) {
      console.error("[media-store] Failed to list contact media:", error);
      return summary;
    }
  }

  /**
   * GDPR: Delete all media for a contact
   */
  async deleteContactMedia(
    phoneNumber: string,
    hardDelete = false
  ): Promise<DeleteMediaResult> {
    const sql = getDatabase();
    const disk = getDefaultDisk();

    const result: DeleteMediaResult = {
      success: false,
      filesDeleted: 0,
      filesErrored: 0,
      totalSizeFreed: 0,
      hardDelete,
      errors: [],
    };

    if (!sql) {
      result.errors = ["Database not configured"];
      return result;
    }

    try {
      // Get all files for this contact
      const rows = await timedQuery("select", this.tableName, () =>
        sql<MediaFileRow[]>`
          SELECT * FROM media_files
          WHERE phone_number = ${phoneNumber} AND deleted_at IS NULL
        `
      );

      if (rows.length === 0) {
        result.success = true;
        return result;
      }

      // Delete or soft-delete each file
      for (const row of rows) {
        try {
          if (hardDelete) {
            // Hard delete: remove from storage and database
            try {
              await disk.delete(row.storage_key);
            } catch {
              // File might not exist, continue anyway
            }

            await timedQuery("delete", this.tableName, () =>
              sql`DELETE FROM media_files WHERE id = ${row.id}`
            );
          } else {
            // Soft delete: just mark as deleted
            await timedQuery("update", this.tableName, () =>
              sql`
                UPDATE media_files
                SET deleted_at = NOW()
                WHERE id = ${row.id}
              `
            );
          }

          result.filesDeleted++;
          result.totalSizeFreed += parseInt(row.size_bytes, 10);
        } catch (error) {
          result.filesErrored++;
          result.errors?.push(
            `Failed to delete ${row.storage_key}: ${error instanceof Error ? error.message : "Unknown error"}`
          );
        }
      }

      result.success = result.filesErrored === 0;

      console.log(
        `[media-store] GDPR delete for ${phoneNumber}: ${result.filesDeleted} files, ` +
          `${(result.totalSizeFreed / 1024 / 1024).toFixed(2)} MB freed`
      );

      return result;
    } catch (error) {
      result.errors = [error instanceof Error ? error.message : "Unknown error"];
      return result;
    }
  }

  /**
   * Clean up expired files based on retention policy
   */
  async cleanupExpiredFiles(): Promise<{
    deleted: number;
    errors: number;
    sizeFreed: number;
  }> {
    const sql = getDatabase();
    const disk = getDefaultDisk();

    const result = { deleted: 0, errors: 0, sizeFreed: 0 };

    if (!sql) {
      return result;
    }

    try {
      // Find expired files
      const rows = await timedQuery("select", this.tableName, () =>
        sql<MediaFileRow[]>`
          SELECT * FROM media_files
          WHERE expires_at < NOW()
            AND deleted_at IS NULL
            AND retention_policy != 'permanent'
          LIMIT 100
        `
      );

      if (rows.length === 0) {
        return result;
      }

      console.log(`[media-store] Cleaning up ${rows.length} expired files`);

      for (const row of rows) {
        try {
          // Delete from storage
          try {
            await disk.delete(row.storage_key);
          } catch {
            // File might already be gone
          }

          // Soft delete in database (for audit trail)
          await timedQuery("update", this.tableName, () =>
            sql`
              UPDATE media_files
              SET deleted_at = NOW()
              WHERE id = ${row.id}
            `
          );

          result.deleted++;
          result.sizeFreed += parseInt(row.size_bytes, 10);
        } catch {
          result.errors++;
        }
      }

      console.log(
        `[media-store] Cleanup complete: ${result.deleted} deleted, ${result.errors} errors`
      );

      return result;
    } catch (error) {
      console.error("[media-store] Cleanup failed:", error);
      return result;
    }
  }

  /**
   * Get media file metadata by storage key
   */
  async getMetadata(storageKey: string): Promise<MediaFile | null> {
    const sql = getDatabase();

    if (!sql) {
      return null;
    }

    try {
      const [row] = await timedQuery("select", this.tableName, () =>
        sql<MediaFileRow[]>`
          SELECT * FROM media_files
          WHERE storage_key = ${storageKey} AND deleted_at IS NULL
        `
      );

      return row ? this.rowToMediaFile(row) : null;
    } catch (error) {
      console.error("[media-store] Failed to get metadata:", error);
      return null;
    }
  }

  /**
   * Convert database row to MediaFile interface
   */
  private rowToMediaFile(row: MediaFileRow): MediaFile {
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
      source: row.source as MediaFile["source"],
      sourceUrl: row.source_url,
      retentionPolicy: row.retention_policy as RetentionPolicy,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      accessedAt: row.accessed_at,
      deletedAt: row.deleted_at,
    };
  }
}

/**
 * Get or create the MediaStore singleton
 */
export function getMediaStore(): MediaStore {
  if (!mediaStoreInstance) {
    mediaStoreInstance = new MediaStore();
  }
  return mediaStoreInstance;
}

/**
 * Reset MediaStore (for testing)
 */
export function resetMediaStore(): void {
  mediaStoreInstance = null;
}
