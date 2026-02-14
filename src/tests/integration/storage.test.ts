/**
 * Storage Integration Tests
 *
 * Tests the MediaStore with GDPR compliance features.
 * These tests require a running PostgreSQL database.
 *
 * Run with: npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  getDatabase,
  isDatabaseConfigured,
  resetDatabase,
} from "../../database/client.js";
import {
  getMediaStore,
  resetMediaStore,
  MediaStore,
} from "../../storage/media-store.js";
import {
  resetStorageManager,
  getStorageConfiguration,
  checkStorageHealth,
} from "../../storage/client.js";
import type { MediaCategory, MediaSource } from "../../storage/types.js";

// Skip tests if database is not configured
const runDbTests = process.env.DATABASE_URL || process.env.POSTGRES_HOST;

describe.skipIf(!runDbTests)("Storage Integration", () => {
  let sql: ReturnType<typeof getDatabase>;
  const testPhone = "8888888888"; // Test phone number for storage tests
  const testContactId = "00000000-0000-0000-0000-000000000001";

  beforeAll(() => {
    sql = getDatabase();
    expect(sql).not.toBeNull();
    expect(isDatabaseConfigured()).toBe(true);
  });

  afterAll(async () => {
    // Cleanup test data
    if (sql) {
      await sql`DELETE FROM media_files WHERE phone_number = ${testPhone}`;
    }
    resetMediaStore();
    resetStorageManager();
    resetDatabase();
  });

  describe("Storage Health", () => {
    it("should report storage as healthy", async () => {
      const health = await checkStorageHealth();
      expect(health.healthy).toBe(true);
      expect(health.backend).toBeDefined();
    });

    it("should have valid storage configuration", () => {
      const config = getStorageConfiguration();
      expect(config.backend).toMatch(/^(local|s3|r2)$/);
      expect(config.local?.basePath).toBeDefined();
    });
  });

  describe("MediaStore", () => {
    let mediaStore: MediaStore;

    beforeEach(() => {
      mediaStore = getMediaStore();
    });

    afterAll(async () => {
      if (sql) {
        await sql`DELETE FROM media_files WHERE phone_number = ${testPhone}`;
      }
    });

    it("should store voice media with tracking", async () => {
      const testData = Buffer.from("fake audio data for testing");

      const result = await mediaStore.store({
        phoneNumber: testPhone,
        mediaType: "voice",
        data: testData,
        mimeType: "audio/ogg",
        source: "generated",
      });

      expect(result.success).toBe(true);
      expect(result.storageKey).toBeDefined();
      expect(result.storageKey).toContain("voice/");
      expect(result.storageKey).toContain(testPhone);
      expect(result.mediaFile).toBeDefined();
      expect(result.mediaFile?.phoneNumber).toBe(testPhone);
      expect(result.mediaFile?.mediaType).toBe("voice");
      expect(result.mediaFile?.mimeType).toBe("audio/ogg");
      expect(result.mediaFile?.source).toBe("generated");
      expect(result.mediaFile?.sizeBytes).toBe(testData.length);
      expect(result.mediaFile?.checksumSha256).toBeDefined();
    });

    it("should store image media without contact ID", async () => {
      const testData = Buffer.from("fake image data for testing");

      const result = await mediaStore.store({
        phoneNumber: testPhone,
        mediaType: "image",
        data: testData,
        mimeType: "image/jpeg",
        source: "received",
      });

      expect(result.success).toBe(true);
      expect(result.storageKey).toContain("image/");
      expect(result.mediaFile?.phoneNumber).toBe(testPhone);
      expect(result.mediaFile?.mediaType).toBe("image");
    });

    it("should store image media with valid contact ID", async () => {
      // First create a contact in the database
      if (!sql) return;

      const [contact] = await sql`
        INSERT INTO networking_contacts (phone_number, first_name, status)
        VALUES (${testPhone}, 'Test', 'active')
        ON CONFLICT (phone_number) DO UPDATE SET first_name = 'Test'
        RETURNING id
      `;

      const testData = Buffer.from("image with contact");

      const result = await mediaStore.store({
        phoneNumber: testPhone,
        contactId: contact.id,
        mediaType: "image",
        data: testData,
        mimeType: "image/jpeg",
        source: "received",
      });

      expect(result.success).toBe(true);
      expect(result.mediaFile?.contactId).toBe(contact.id);

      // Cleanup
      await sql`DELETE FROM networking_contacts WHERE phone_number = ${testPhone}`;
    });

    it("should store video media", async () => {
      const testData = Buffer.from("fake video data for testing");

      const result = await mediaStore.store({
        phoneNumber: testPhone,
        mediaType: "video",
        data: testData,
        mimeType: "video/mp4",
        source: "downloaded",
        sourceUrl: "https://example.com/video.mp4",
      });

      expect(result.success).toBe(true);
      expect(result.storageKey).toContain("video/");
      expect(result.mediaFile?.sourceUrl).toBe("https://example.com/video.mp4");
    });

    it("should store document media", async () => {
      const testData = Buffer.from("fake document data");

      const result = await mediaStore.store({
        phoneNumber: testPhone,
        mediaType: "document",
        data: testData,
        mimeType: "application/pdf",
        source: "uploaded",
      });

      expect(result.success).toBe(true);
      expect(result.storageKey).toContain("document/");
    });

    it("should retrieve stored media", async () => {
      const testData = Buffer.from("retrievable test data");

      const storeResult = await mediaStore.store({
        phoneNumber: testPhone,
        mediaType: "voice",
        data: testData,
        mimeType: "audio/ogg",
        source: "generated",
      });

      expect(storeResult.success).toBe(true);

      const retrieved = await mediaStore.get(storeResult.storageKey!);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.toString()).toBe(testData.toString());
    });

    it("should return null for non-existent media", async () => {
      const retrieved = await mediaStore.get("nonexistent/file.ogg");
      expect(retrieved).toBeNull();
    });

    it("should get local path for storage key", () => {
      const path = mediaStore.getLocalPath("voice/123/test.ogg");
      expect(path).toContain("voice/123/test.ogg");
    });

    it("should get metadata for stored media", async () => {
      const testData = Buffer.from("metadata test data");

      const storeResult = await mediaStore.store({
        phoneNumber: testPhone,
        mediaType: "voice",
        data: testData,
        mimeType: "audio/ogg",
        source: "generated",
      });

      const metadata = await mediaStore.getMetadata(storeResult.storageKey!);
      expect(metadata).not.toBeNull();
      expect(metadata?.storageKey).toBe(storeResult.storageKey);
      expect(metadata?.phoneNumber).toBe(testPhone);
    });

    it("should store media with custom retention policy", async () => {
      const testData = Buffer.from("temporary data");

      const result = await mediaStore.store({
        phoneNumber: testPhone,
        mediaType: "voice",
        data: testData,
        mimeType: "audio/ogg",
        source: "generated",
        retentionPolicy: "temporary",
      });

      expect(result.success).toBe(true);
      expect(result.mediaFile?.retentionPolicy).toBe("temporary");
      expect(result.mediaFile?.expiresAt).not.toBeNull();
    });

    it("should store media with permanent retention", async () => {
      const testData = Buffer.from("permanent data");

      const result = await mediaStore.store({
        phoneNumber: testPhone,
        mediaType: "avatar",
        data: testData,
        mimeType: "image/png",
        source: "uploaded",
        retentionPolicy: "permanent",
      });

      expect(result.success).toBe(true);
      expect(result.mediaFile?.retentionPolicy).toBe("permanent");
      expect(result.mediaFile?.expiresAt).toBeNull();
    });
  });

  describe("GDPR Compliance", () => {
    let mediaStore: MediaStore;
    const gdprTestPhone = "7777777777";

    beforeAll(async () => {
      mediaStore = getMediaStore();

      // Store multiple test files for GDPR tests
      await mediaStore.store({
        phoneNumber: gdprTestPhone,
        mediaType: "voice",
        data: Buffer.from("gdpr voice 1"),
        mimeType: "audio/ogg",
        source: "generated",
      });

      await mediaStore.store({
        phoneNumber: gdprTestPhone,
        mediaType: "image",
        data: Buffer.from("gdpr image 1"),
        mimeType: "image/jpeg",
        source: "received",
      });

      await mediaStore.store({
        phoneNumber: gdprTestPhone,
        mediaType: "video",
        data: Buffer.from("gdpr video 1"),
        mimeType: "video/mp4",
        source: "downloaded",
      });
    });

    afterAll(async () => {
      if (sql) {
        await sql`DELETE FROM media_files WHERE phone_number = ${gdprTestPhone}`;
      }
    });

    it("should list all media for a contact (Right to Access)", async () => {
      const summary = await mediaStore.listContactMedia(gdprTestPhone);

      expect(summary.phoneNumber).toBe(gdprTestPhone);
      expect(summary.totalFiles).toBeGreaterThanOrEqual(3);
      expect(summary.totalSizeBytes).toBeGreaterThan(0);
      expect(summary.byCategory.voice).toBeGreaterThanOrEqual(1);
      expect(summary.byCategory.image).toBeGreaterThanOrEqual(1);
      expect(summary.byCategory.video).toBeGreaterThanOrEqual(1);
      expect(summary.files.length).toBeGreaterThanOrEqual(3);
    });

    it("should return empty summary for unknown contact", async () => {
      const summary = await mediaStore.listContactMedia("0000000000");

      expect(summary.totalFiles).toBe(0);
      expect(summary.totalSizeBytes).toBe(0);
      expect(summary.files.length).toBe(0);
    });

    it("should soft delete all contact media (Right to Erasure)", async () => {
      // Create a separate phone for deletion test
      const deleteTestPhone = "6666666666";

      await mediaStore.store({
        phoneNumber: deleteTestPhone,
        mediaType: "voice",
        data: Buffer.from("delete test 1"),
        mimeType: "audio/ogg",
        source: "generated",
      });

      await mediaStore.store({
        phoneNumber: deleteTestPhone,
        mediaType: "image",
        data: Buffer.from("delete test 2"),
        mimeType: "image/jpeg",
        source: "received",
      });

      // Verify files exist
      const beforeSummary = await mediaStore.listContactMedia(deleteTestPhone);
      expect(beforeSummary.totalFiles).toBe(2);

      // Soft delete
      const deleteResult = await mediaStore.deleteContactMedia(
        deleteTestPhone,
        false
      );

      expect(deleteResult.success).toBe(true);
      expect(deleteResult.filesDeleted).toBe(2);
      expect(deleteResult.hardDelete).toBe(false);
      expect(deleteResult.totalSizeFreed).toBeGreaterThan(0);

      // Verify files no longer listed (but still in DB with deleted_at)
      const afterSummary = await mediaStore.listContactMedia(deleteTestPhone);
      expect(afterSummary.totalFiles).toBe(0);

      // Cleanup
      if (sql) {
        await sql`DELETE FROM media_files WHERE phone_number = ${deleteTestPhone}`;
      }
    });

    it("should hard delete all contact media", async () => {
      const hardDeletePhone = "5555555555";

      await mediaStore.store({
        phoneNumber: hardDeletePhone,
        mediaType: "voice",
        data: Buffer.from("hard delete test"),
        mimeType: "audio/ogg",
        source: "generated",
      });

      const deleteResult = await mediaStore.deleteContactMedia(
        hardDeletePhone,
        true
      );

      expect(deleteResult.success).toBe(true);
      expect(deleteResult.filesDeleted).toBe(1);
      expect(deleteResult.hardDelete).toBe(true);

      // Verify completely removed from DB
      if (sql) {
        const remaining =
          await sql`SELECT COUNT(*) as count FROM media_files WHERE phone_number = ${hardDeletePhone}`;
        expect(parseInt(remaining[0].count)).toBe(0);
      }
    });
  });

  describe("Retention Cleanup", () => {
    let mediaStore: MediaStore;

    beforeEach(() => {
      mediaStore = getMediaStore();
    });

    it("should run cleanup without errors on empty expired set", async () => {
      const result = await mediaStore.cleanupExpiredFiles();

      expect(result.deleted).toBeGreaterThanOrEqual(0);
      expect(result.errors).toBe(0);
    });

    it("should not delete permanent files during cleanup", async () => {
      const permanentPhone = "4444444444";

      await mediaStore.store({
        phoneNumber: permanentPhone,
        mediaType: "avatar",
        data: Buffer.from("permanent avatar"),
        mimeType: "image/png",
        source: "uploaded",
        retentionPolicy: "permanent",
      });

      await mediaStore.cleanupExpiredFiles();

      const summary = await mediaStore.listContactMedia(permanentPhone);
      expect(summary.totalFiles).toBe(1);

      // Cleanup
      if (sql) {
        await sql`DELETE FROM media_files WHERE phone_number = ${permanentPhone}`;
      }
    });
  });
});

describe.skipIf(runDbTests)("Storage Integration (Skipped)", () => {
  it("skips storage tests when database not configured", () => {
    console.log(
      "Storage tests skipped - set DATABASE_URL or POSTGRES_* env vars to run"
    );
    expect(true).toBe(true);
  });
});
