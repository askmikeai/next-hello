/**
 * Contact Repository Integration Tests
 *
 * These tests run against a real PostgreSQL database.
 * Requires: docker compose up postgres -d
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { uniquePhone, uniqueEmail } from "../setup.js";

// Set up environment before importing modules
process.env.DATABASE_URL = "postgresql://nexthello:nexthello_dev@localhost:5432/nexthello";

// Import after env is set
import {
  findContactByPhone,
  findContactByEmail,
  createContact,
  updateContactByPhone,
  updateContactById,
  updateContactStatus,
  updateHeyGenVideo,
  deleteContactByPhone,
  getContactsByStatus,
  getDatabaseClient,
} from "../../src/contacts/index.js";
import { getDatabase, resetDatabase, checkDatabaseHealth } from "../../src/database/client.js";

describe("Contact Repository Integration Tests", () => {
  // Track contacts created during tests for cleanup
  const createdPhones: string[] = [];

  beforeAll(async () => {
    // Verify database is available
    const health = await checkDatabaseHealth();
    if (!health.healthy) {
      throw new Error(
        `Database not available: ${health.error}. Run 'docker compose up postgres -d' first.`
      );
    }
  });

  afterAll(async () => {
    // Clean up all test contacts
    for (const phone of createdPhones) {
      try {
        await deleteContactByPhone(phone);
      } catch {
        // Ignore cleanup errors
      }
    }
    resetDatabase();
  });

  describe("createContact", () => {
    it("should create a new contact with minimal data", async () => {
      const phone = uniquePhone();
      createdPhones.push(phone);

      const contact = await createContact({ phone_number: phone });

      expect(contact).toBeDefined();
      expect(contact.phone_number).toBe(phone);
      expect(contact.status).toBe("new");
      expect(contact.id).toBeDefined();
      expect(contact.created_at).toBeDefined();
    });

    it("should create a contact with full profile data", async () => {
      const phone = uniquePhone();
      const email = uniqueEmail();
      createdPhones.push(phone);

      const contact = await createContact({
        phone_number: phone,
        first_name: "Integration",
        last_name: "Test",
        email,
        company_name: "Test Corp",
        job_title: "QA Engineer",
        status: "collecting",
      });

      expect(contact.phone_number).toBe(phone);
      expect(contact.first_name).toBe("Integration");
      expect(contact.last_name).toBe("Test");
      expect(contact.email).toBe(email);
      expect(contact.company_name).toBe("Test Corp");
      expect(contact.job_title).toBe("QA Engineer");
      expect(contact.status).toBe("collecting");
    });

    it("should fail when creating duplicate phone number", async () => {
      const phone = uniquePhone();
      createdPhones.push(phone);

      await createContact({ phone_number: phone });

      await expect(createContact({ phone_number: phone })).rejects.toThrow();
    });
  });

  describe("findContactByPhone", () => {
    it("should find an existing contact by phone", async () => {
      const phone = uniquePhone();
      createdPhones.push(phone);

      await createContact({
        phone_number: phone,
        first_name: "FindMe",
      });

      const found = await findContactByPhone(phone);

      expect(found).not.toBeNull();
      expect(found?.phone_number).toBe(phone);
      expect(found?.first_name).toBe("FindMe");
    });

    it("should return null for non-existent phone", async () => {
      const found = await findContactByPhone("+19999999999");
      expect(found).toBeNull();
    });
  });

  describe("findContactByEmail", () => {
    it("should find an existing contact by email", async () => {
      const phone = uniquePhone();
      const email = uniqueEmail();
      createdPhones.push(phone);

      await createContact({
        phone_number: phone,
        email,
        first_name: "EmailTest",
      });

      const found = await findContactByEmail(email);

      expect(found).not.toBeNull();
      expect(found?.email).toBe(email);
      expect(found?.first_name).toBe("EmailTest");
    });

    it("should return null for non-existent email", async () => {
      const found = await findContactByEmail("nonexistent@test.com");
      expect(found).toBeNull();
    });
  });

  describe("updateContactByPhone", () => {
    it("should update contact fields", async () => {
      const phone = uniquePhone();
      createdPhones.push(phone);

      await createContact({
        phone_number: phone,
        first_name: "Before",
      });

      const updated = await updateContactByPhone(phone, {
        first_name: "After",
        company_name: "Updated Corp",
      });

      expect(updated.first_name).toBe("After");
      expect(updated.company_name).toBe("Updated Corp");
      expect(new Date(updated.updated_at!).getTime()).toBeGreaterThan(
        new Date(updated.created_at!).getTime() - 1000
      );
    });

    it("should throw when updating non-existent contact", async () => {
      await expect(
        updateContactByPhone("+19999999999", { first_name: "Ghost" })
      ).rejects.toThrow();
    });
  });

  describe("updateContactById", () => {
    it("should update contact by ID", async () => {
      const phone = uniquePhone();
      createdPhones.push(phone);

      const created = await createContact({ phone_number: phone });

      const updated = await updateContactById(created.id!, {
        first_name: "UpdatedById",
        job_title: "New Title",
      });

      expect(updated.first_name).toBe("UpdatedById");
      expect(updated.job_title).toBe("New Title");
    });
  });

  describe("updateContactStatus", () => {
    it("should update contact status", async () => {
      const phone = uniquePhone();
      createdPhones.push(phone);

      await createContact({ phone_number: phone, status: "new" });

      const updated = await updateContactStatus(phone, "collecting");

      expect(updated.status).toBe("collecting");
    });
  });

  describe("updateHeyGenVideo", () => {
    it("should update HeyGen video fields", async () => {
      const phone = uniquePhone();
      createdPhones.push(phone);

      await createContact({ phone_number: phone });

      const updated = await updateHeyGenVideo(
        phone,
        "video-123",
        "https://heygen.com/video/123.mp4"
      );

      expect(updated.heygen_video_id).toBe("video-123");
      expect(updated.heygen_video_url).toBe("https://heygen.com/video/123.mp4");
    });
  });

  describe("deleteContactByPhone", () => {
    it("should delete an existing contact", async () => {
      const phone = uniquePhone();
      // Don't add to cleanup since we're deleting it

      await createContact({ phone_number: phone });

      const result = await deleteContactByPhone(phone);

      expect(result.success).toBe(true);

      // Verify deletion
      const found = await findContactByPhone(phone);
      expect(found).toBeNull();
    });

    it("should succeed even for non-existent contact", async () => {
      const result = await deleteContactByPhone("+19999999999");
      expect(result.success).toBe(true);
    });
  });

  describe("getContactsByStatus", () => {
    it("should return contacts with specific status", async () => {
      const phone1 = uniquePhone();
      const phone2 = uniquePhone();
      const phone3 = uniquePhone();
      createdPhones.push(phone1, phone2, phone3);

      await createContact({ phone_number: phone1, status: "collecting" });
      await createContact({ phone_number: phone2, status: "collecting" });
      await createContact({ phone_number: phone3, status: "fields_complete" });

      const collecting = await getContactsByStatus("collecting");

      expect(collecting.length).toBeGreaterThanOrEqual(2);
      expect(collecting.every((c) => c.status === "collecting")).toBe(true);
    });

    it("should respect limit parameter", async () => {
      const contacts = await getContactsByStatus("new", undefined, 5);
      expect(contacts.length).toBeLessThanOrEqual(5);
    });
  });

  describe("Swarm fields", () => {
    it("should update qualification fields", async () => {
      const phone = uniquePhone();
      createdPhones.push(phone);

      await createContact({ phone_number: phone });

      const updated = await updateContactByPhone(phone, {
        qualification_score: 85,
        qualification_tier: "hot",
      });

      // PostgreSQL NUMERIC is returned as string, so convert for comparison
      expect(Number(updated.qualification_score)).toBe(85);
      expect(updated.qualification_tier).toBe("hot");
    });

    it("should update research fields", async () => {
      const phone = uniquePhone();
      createdPhones.push(phone);

      await createContact({ phone_number: phone });

      const updated = await updateContactByPhone(phone, {
        research_status: "complete",
        research_data: {
          linkedin: { headline: "CEO at StartupXYZ" },
          company: { size: "50-200" },
        },
      });

      expect(updated.research_status).toBe("complete");
      expect(updated.research_data).toBeDefined();
      expect((updated.research_data as Record<string, unknown>)?.linkedin).toBeDefined();
    });

    it("should update swarm metadata", async () => {
      const phone = uniquePhone();
      createdPhones.push(phone);

      await createContact({ phone_number: phone });

      const updated = await updateContactByPhone(phone, {
        total_turns: 5,
        swarm_metadata: {
          lastAgent: "conversation",
          handoffs: 2,
        },
      });

      expect(updated.total_turns).toBe(5);
      expect(updated.swarm_metadata).toBeDefined();
    });
  });
});
