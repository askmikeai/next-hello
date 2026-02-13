/**
 * Contact Repository Unit Tests
 *
 * Tests the contact repository in demo mode (no database).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setupTestEnv, clearTestEnv, createMockContact } from "../setup.js";

// Import fresh module to reset singleton
async function importFreshModule() {
  vi.resetModules();
  // Reset database module first
  const dbModule = await import("../../src/database/client.js");
  dbModule.resetDatabase();
  // Then import contacts module
  return import("../../src/contacts/postgres-repo.js");
}

describe("Contact Repository Unit Tests", () => {
  beforeEach(() => {
    clearTestEnv();
    setupTestEnv(); // Sets empty database config
  });

  afterEach(() => {
    clearTestEnv();
  });

  describe("Demo Mode (No Database)", () => {
    it("should return null when finding contact without database", async () => {
      const { findContactByPhone } = await importFreshModule();
      const result = await findContactByPhone("+1234567890");
      expect(result).toBeNull();
    });

    it("should return null when finding by email without database", async () => {
      const { findContactByEmail } = await importFreshModule();
      const result = await findContactByEmail("test@example.com");
      expect(result).toBeNull();
    });

    it("should return mock contact when creating without database", async () => {
      const { createContact } = await importFreshModule();

      const result = await createContact({
        phone_number: "+1234567890",
        first_name: "Demo",
      });

      expect(result).toBeDefined();
      expect(result.phone_number).toBe("+1234567890");
      expect(result.first_name).toBe("Demo");
      expect(result.status).toBe("new");
      expect(result.id).toBeDefined();
    });

    it("should return mock updated contact when updating by phone", async () => {
      const { updateContactByPhone } = await importFreshModule();

      const result = await updateContactByPhone("+1234567890", {
        first_name: "Updated",
        company_name: "Demo Corp",
      });

      expect(result).toBeDefined();
      expect(result.phone_number).toBe("+1234567890");
      expect(result.first_name).toBe("Updated");
      expect(result.company_name).toBe("Demo Corp");
    });

    it("should return mock updated contact when updating by ID", async () => {
      const { updateContactById } = await importFreshModule();

      const result = await updateContactById("test-id-123", {
        first_name: "UpdatedById",
      });

      expect(result).toBeDefined();
      expect(result.id).toBe("test-id-123");
      expect(result.first_name).toBe("UpdatedById");
    });

    it("should return success when deleting without database", async () => {
      const { deleteContactByPhone } = await importFreshModule();

      const result = await deleteContactByPhone("+1234567890");

      expect(result.success).toBe(true);
    });

    it("should return empty array when getting by status without database", async () => {
      const { getContactsByStatus } = await importFreshModule();

      const result = await getContactsByStatus("new");

      expect(result).toEqual([]);
    });

    it("should return empty array when getting contacts needing CRM sync", async () => {
      const { getContactsNeedingCrmSync } = await importFreshModule();

      const result = await getContactsNeedingCrmSync();

      expect(result).toEqual([]);
    });

    it("should return empty array when getting pending videos", async () => {
      const { getContactsWithPendingVideos } = await importFreshModule();

      const result = await getContactsWithPendingVideos();

      expect(result).toEqual([]);
    });
  });

  describe("Helper Functions", () => {
    it("updateContactStatus should call updateContactByPhone", async () => {
      const { updateContactStatus } = await importFreshModule();

      const result = await updateContactStatus("+1234567890", "collecting");

      expect(result.status).toBe("collecting");
    });

    it("updateHeyGenVideo should update video fields", async () => {
      const { updateHeyGenVideo } = await importFreshModule();

      const result = await updateHeyGenVideo(
        "+1234567890",
        "video-123",
        "https://example.com/video.mp4"
      );

      expect(result.heygen_video_id).toBe("video-123");
      expect(result.heygen_video_url).toBe("https://example.com/video.mp4");
    });

    it("updateCalendlyBooking should update booking fields", async () => {
      const { updateCalendlyBooking } = await importFreshModule();

      const result = await updateCalendlyBooking(
        "+1234567890",
        "event-uri-123",
        "2024-01-15T10:00:00Z"
      );

      expect(result.calendly_event_uri).toBe("event-uri-123");
      expect(result.calendly_scheduled_at).toBe("2024-01-15T10:00:00Z");
      expect(result.status).toBe("meeting_scheduled");
    });

    it("updateCrmSync should update CRM fields", async () => {
      const { updateCrmSync } = await importFreshModule();

      const result = await updateCrmSync("+1234567890", "crm-id-456");

      expect(result.crm_contact_id).toBe("crm-id-456");
      expect(result.crm_synced_at).toBeDefined();
      expect(result.status).toBe("synced");
    });

    it("markMessageSent should update message sent fields", async () => {
      const { markMessageSent } = await importFreshModule();

      const result = await markMessageSent("+1234567890");

      expect(result.sent_personalized_message).toBe(true);
      expect(result.last_contact_date).toBeDefined();
    });
  });

  describe("Backwards Compatibility", () => {
    it("should export getSupabaseClient as alias", async () => {
      const { getSupabaseClient, getDatabaseClient } = await importFreshModule();

      expect(getSupabaseClient).toBe(getDatabaseClient);
    });
  });
});
