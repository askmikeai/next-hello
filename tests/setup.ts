/**
 * Test Setup and Utilities
 *
 * Provides helpers for both unit tests (mocked) and integration tests (real DB).
 */

import { vi } from "vitest";

/**
 * Environment setup for tests
 */
export function setupTestEnv(overrides: Record<string, string> = {}) {
  const defaults = {
    DATABASE_URL: "",
    POSTGRES_HOST: "",
    POSTGRES_PORT: "",
    POSTGRES_DB: "",
    POSTGRES_USER: "",
    POSTGRES_PASSWORD: "",
    LOG_LEVEL: "silent",
    NODE_ENV: "test",
  };

  Object.entries({ ...defaults, ...overrides }).forEach(([key, value]) => {
    process.env[key] = value;
  });
}

/**
 * Setup for integration tests with real database
 */
export function setupIntegrationEnv() {
  setupTestEnv({
    DATABASE_URL: "postgresql://nexthello:nexthello_dev@localhost:5432/nexthello_test",
    POSTGRES_HOST: "localhost",
    POSTGRES_PORT: "5432",
    POSTGRES_DB: "nexthello_test",
    POSTGRES_USER: "nexthello",
    POSTGRES_PASSWORD: "nexthello_dev",
  });
}

/**
 * Clear all environment variables related to database
 */
export function clearTestEnv() {
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_HOST;
  delete process.env.POSTGRES_PORT;
  delete process.env.POSTGRES_DB;
  delete process.env.POSTGRES_USER;
  delete process.env.POSTGRES_PASSWORD;
}

/**
 * Create a mock contact for testing
 */
export function createMockContact(overrides: Record<string, unknown> = {}) {
  return {
    id: "test-uuid-123",
    phone_number: "+1234567890",
    first_name: "John",
    last_name: "Doe",
    email: "john@example.com",
    company_name: "Acme Inc",
    job_title: "Engineer",
    status: "new",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create a mock message for testing
 */
export function createMockMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-uuid-123",
    phone_number: "+1234567890",
    correlation_id: "corr-123",
    direction: "inbound",
    channel: "whatsapp",
    content: "Hello, world!",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error("waitFor timeout");
}

/**
 * Generate a unique phone number for tests
 */
export function uniquePhone(): string {
  return `+1${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

/**
 * Generate a unique email for tests
 */
export function uniqueEmail(): string {
  return `test-${Date.now()}-${Math.floor(Math.random() * 1000)}@example.com`;
}
