import type { NetworkingContact } from "../config/types.js";

/**
 * Field validation utilities for networking contacts
 */

export interface FieldValidationResult {
  valid: boolean;
  field: string;
  value: string;
  error?: string;
}

export interface ExtractedFields {
  email?: string;
  company_name?: string;
  job_title?: string;
  first_name?: string;
  last_name?: string;
  industry?: string;
  linkedin_url?: string;
}

/**
 * Validate email format
 */
export function validateEmail(email: string): FieldValidationResult {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const valid = emailRegex.test(email.trim());

  return {
    valid,
    field: "email",
    value: email.trim().toLowerCase(),
    error: valid ? undefined : "Invalid email format",
  };
}

/**
 * Validate company name
 */
export function validateCompanyName(name: string): FieldValidationResult {
  const trimmed = name.trim();
  const valid = trimmed.length >= 2 && trimmed.length <= 200;

  return {
    valid,
    field: "company_name",
    value: trimmed,
    error: valid ? undefined : "Company name must be 2-200 characters",
  };
}

/**
 * Validate job title
 */
export function validateJobTitle(title: string): FieldValidationResult {
  const trimmed = title.trim();
  const valid = trimmed.length >= 2 && trimmed.length <= 100;

  return {
    valid,
    field: "job_title",
    value: trimmed,
    error: valid ? undefined : "Job title must be 2-100 characters",
  };
}

/**
 * Validate LinkedIn URL
 */
export function validateLinkedInUrl(url: string): FieldValidationResult {
  const trimmed = url.trim();
  const linkedinRegex =
    /^https?:\/\/(www\.)?linkedin\.com\/(in|pub|company)\/[\w-]+\/?$/i;
  const valid = linkedinRegex.test(trimmed);

  return {
    valid,
    field: "linkedin_url",
    value: trimmed,
    error: valid ? undefined : "Invalid LinkedIn URL format",
  };
}

/**
 * Validate a specific field
 */
export function validateField(
  field: string,
  value: string,
): FieldValidationResult {
  switch (field) {
    case "email":
      return validateEmail(value);
    case "company_name":
      return validateCompanyName(value);
    case "job_title":
      return validateJobTitle(value);
    case "linkedin_url":
      return validateLinkedInUrl(value);
    case "first_name":
    case "last_name":
      return {
        valid: value.trim().length >= 1,
        field,
        value: value.trim(),
        error: value.trim().length >= 1 ? undefined : `${field.replace("_", " ")} is required`,
      };
    case "industry":
      return {
        valid: value.trim().length >= 2,
        field,
        value: value.trim(),
        error: value.trim().length >= 2 ? undefined : "Industry must be at least 2 characters",
      };
    default:
      // Accept any non-empty value for unknown fields
      return {
        valid: value.trim().length > 0,
        field,
        value: value.trim(),
      };
  }
}

/**
 * Get missing required fields
 */
export function getMissingFields(
  contact: NetworkingContact,
  requiredFields: string[],
): string[] {
  const missing: string[] = [];

  for (const field of requiredFields) {
    const value = contact[field as keyof NetworkingContact];
    if (value === null || value === undefined || value === "") {
      missing.push(field);
    }
  }

  return missing;
}

/**
 * Check if all required fields are present
 */
export function hasAllRequiredFields(
  contact: NetworkingContact,
  requiredFields: string[],
): boolean {
  return getMissingFields(contact, requiredFields).length === 0;
}

/**
 * Format field names for human-readable display
 */
export function formatFieldName(field: string): string {
  return field
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Format multiple field names for display
 */
export function formatFieldList(fields: string[]): string {
  const formatted = fields.map(formatFieldName);

  if (formatted.length === 1) {
    return formatted[0];
  }

  if (formatted.length === 2) {
    return `${formatted[0]} and ${formatted[1]}`;
  }

  const last = formatted.pop();
  return `${formatted.join(", ")}, and ${last}`;
}

/**
 * Extract field values from natural language message
 * This is a basic extraction - the AI agent does the heavy lifting
 */
export function extractFieldsFromMessage(message: string): ExtractedFields {
  const extracted: ExtractedFields = {};

  // Email extraction
  const emailMatch = message.match(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/);
  if (emailMatch) {
    extracted.email = emailMatch[0].toLowerCase();
  }

  // LinkedIn URL extraction
  const linkedinMatch = message.match(
    /https?:\/\/(www\.)?linkedin\.com\/(in|pub|company)\/[\w-]+\/?/i,
  );
  if (linkedinMatch) {
    extracted.linkedin_url = linkedinMatch[0];
  }

  return extracted;
}

/**
 * Parse structured field updates from AI response
 * Expected format: field_name: value
 */
export function parseFieldUpdates(
  text: string,
): Array<{ field: string; value: string }> {
  const updates: Array<{ field: string; value: string }> = [];
  const lines = text.split("\n");

  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      const [, field, value] = match;
      updates.push({
        field: field.toLowerCase(),
        value: value.trim(),
      });
    }
  }

  return updates;
}
