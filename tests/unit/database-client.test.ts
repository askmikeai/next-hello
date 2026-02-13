/**
 * Database Client Unit Tests
 *
 * Tests the database connection manager in isolation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setupTestEnv, clearTestEnv } from "../setup.js";

// We need to reset the module between tests to test singleton behavior
async function importFreshModule() {
  // Clear the module cache
  vi.resetModules();
  return import("../../src/database/client.js");
}

describe("Database Client", () => {
  beforeEach(() => {
    clearTestEnv();
  });

  afterEach(() => {
    clearTestEnv();
  });

  describe("getDatabase", () => {
    it("should return null when DATABASE_URL is not configured", async () => {
      setupTestEnv({ DATABASE_URL: "" });
      const { getDatabase, resetDatabase } = await importFreshModule();
      resetDatabase();

      const sql = getDatabase();
      expect(sql).toBeNull();
    });

    it("should return null when individual vars are missing", async () => {
      setupTestEnv({
        POSTGRES_HOST: "localhost",
        // Missing other required vars
      });
      const { getDatabase, resetDatabase } = await importFreshModule();
      resetDatabase();

      const sql = getDatabase();
      expect(sql).toBeNull();
    });

    it("should create connection when DATABASE_URL is set", async () => {
      setupTestEnv({
        DATABASE_URL: "postgresql://user:pass@localhost:5432/testdb",
      });
      const { getDatabase, resetDatabase, isDatabaseConfigured } = await importFreshModule();
      resetDatabase();

      const sql = getDatabase();
      // Will be non-null even if DB doesn't exist (lazy connection)
      expect(sql).not.toBeNull();
      expect(isDatabaseConfigured()).toBe(true);

      // Clean up
      resetDatabase();
    });

    it("should create connection when individual vars are set", async () => {
      setupTestEnv({
        POSTGRES_HOST: "localhost",
        POSTGRES_PORT: "5432",
        POSTGRES_DB: "testdb",
        POSTGRES_USER: "user",
        POSTGRES_PASSWORD: "pass",
      });
      const { getDatabase, resetDatabase, isDatabaseConfigured } = await importFreshModule();
      resetDatabase();

      const sql = getDatabase();
      expect(sql).not.toBeNull();
      expect(isDatabaseConfigured()).toBe(true);

      resetDatabase();
    });

    it("should return same instance on multiple calls (singleton)", async () => {
      setupTestEnv({
        DATABASE_URL: "postgresql://user:pass@localhost:5432/testdb",
      });
      const { getDatabase, resetDatabase } = await importFreshModule();
      resetDatabase();

      const sql1 = getDatabase();
      const sql2 = getDatabase();

      expect(sql1).toBe(sql2);

      resetDatabase();
    });
  });

  describe("isDatabaseConfigured", () => {
    it("should return false when not configured", async () => {
      setupTestEnv({ DATABASE_URL: "" });
      const { isDatabaseConfigured, resetDatabase } = await importFreshModule();
      resetDatabase();

      expect(isDatabaseConfigured()).toBe(false);
    });

    it("should return true after getDatabase creates connection", async () => {
      setupTestEnv({
        DATABASE_URL: "postgresql://user:pass@localhost:5432/testdb",
      });
      const { getDatabase, isDatabaseConfigured, resetDatabase } = await importFreshModule();
      resetDatabase();

      // Not configured until we call getDatabase
      getDatabase();
      expect(isDatabaseConfigured()).toBe(true);

      resetDatabase();
    });
  });

  describe("resetDatabase", () => {
    it("should reset the singleton instance", async () => {
      setupTestEnv({
        DATABASE_URL: "postgresql://user:pass@localhost:5432/testdb",
      });
      const { getDatabase, resetDatabase, isDatabaseConfigured } = await importFreshModule();

      getDatabase();
      expect(isDatabaseConfigured()).toBe(true);

      resetDatabase();
      expect(isDatabaseConfigured()).toBe(false);
    });
  });

  describe("checkDatabaseHealth", () => {
    it("should return unhealthy when not configured", async () => {
      setupTestEnv({ DATABASE_URL: "" });
      const { checkDatabaseHealth, resetDatabase } = await importFreshModule();
      resetDatabase();

      const health = await checkDatabaseHealth();
      expect(health.healthy).toBe(false);
      expect(health.error).toBe("Database not configured");
    });

    it("should return unhealthy when connection fails", async () => {
      setupTestEnv({
        DATABASE_URL: "postgresql://user:pass@localhost:59999/nonexistent",
      });
      const { checkDatabaseHealth, resetDatabase } = await importFreshModule();
      resetDatabase();

      const health = await checkDatabaseHealth();
      expect(health.healthy).toBe(false);
      expect(health.error).toBeDefined();
      expect(health.latencyMs).toBeDefined();

      resetDatabase();
    });
  });
});
