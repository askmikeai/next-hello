import type { LinkedInConfig, LinkedInProfile } from "../../config/types.js";

/**
 * LinkedIn enrichment client
 *
 * NOTE: ProxyCurl has been shut down. This module now returns null for all lookups.
 * To enable LinkedIn enrichment, integrate an alternative provider:
 * - Apollo.io
 * - Clearbit
 * - People Data Labs
 * - RocketReach
 */

function log(message: string): void {
  console.log(`[linkedin] ${message}`);
}

/**
 * Look up a LinkedIn profile by URL
 * @deprecated ProxyCurl shut down - returns null
 */
export async function lookupProfileByUrl(
  linkedinUrl: string,
  _config?: LinkedInConfig,
): Promise<LinkedInProfile | null> {
  log(`LinkedIn lookup disabled (ProxyCurl shut down): ${linkedinUrl}`);
  return null;
}

/**
 * Look up a LinkedIn profile by email
 * @deprecated ProxyCurl shut down - returns null
 */
export async function lookupProfileByEmail(
  email: string,
  _config?: LinkedInConfig,
): Promise<LinkedInProfile | null> {
  log(`LinkedIn lookup disabled (ProxyCurl shut down): ${email}`);
  return null;
}

/**
 * Look up a company by name
 * @deprecated ProxyCurl shut down - returns null
 */
export async function lookupCompany(
  companyName: string,
  _config?: LinkedInConfig,
): Promise<{
  name: string;
  industry: string;
  description: string;
  website: string;
  linkedinUrl: string;
  employeeCount: string;
} | null> {
  log(`Company lookup disabled (ProxyCurl shut down): ${companyName}`);
  return null;
}

/**
 * Enrich a contact with LinkedIn data
 * @deprecated ProxyCurl shut down - returns null
 */
export async function enrichContactWithLinkedIn(
  params: {
    email?: string;
    linkedinUrl?: string;
    firstName?: string;
    lastName?: string;
    companyName?: string;
  },
  _config?: LinkedInConfig,
): Promise<LinkedInProfile | null> {
  log(`LinkedIn enrichment disabled (ProxyCurl shut down)`);
  return null;
}

/**
 * Extract LinkedIn URL from text
 */
export function extractLinkedInUrl(text: string): string | null {
  const match = text.match(
    /https?:\/\/(www\.)?linkedin\.com\/(in|pub|company)\/[\w-]+\/?/i,
  );
  return match ? match[0] : null;
}

/**
 * Validate LinkedIn URL format
 */
export function isValidLinkedInUrl(url: string): boolean {
  const regex = /^https?:\/\/(www\.)?linkedin\.com\/(in|pub)\/[\w-]+\/?$/i;
  return regex.test(url);
}

/**
 * Get profile type from URL
 */
export function getProfileType(
  url: string,
): "personal" | "company" | "unknown" {
  if (url.includes("/in/") || url.includes("/pub/")) {
    return "personal";
  }
  if (url.includes("/company/")) {
    return "company";
  }
  return "unknown";
}
