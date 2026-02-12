import type { LinkedInConfig, LinkedInProfile } from "../../config/types.js";

const PROXYCURL_API_BASE = "https://nubela.co/proxycurl/api";

function getApiKey(config?: LinkedInConfig): string | null {
  return config?.apiKey ?? process.env.PROXYCURL_API_KEY ?? null;
}

function log(message: string): void {
  console.log(`[linkedin] ${message}`);
}

/**
 * Look up a LinkedIn profile by URL
 */
export async function lookupProfileByUrl(
  linkedinUrl: string,
  config?: LinkedInConfig,
): Promise<LinkedInProfile | null> {
  const apiKey = getApiKey(config);
  if (!apiKey) {
    log("ProxyCurl API key not configured (PROXYCURL_API_KEY)");
    return null;
  }

  try {
    const params = new URLSearchParams({
      url: linkedinUrl,
      fallback_to_cache: "on-error",
      use_cache: "if-present",
    });

    const response = await fetch(
      `${PROXYCURL_API_BASE}/v2/linkedin?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );

    if (!response.ok) {
      if (response.status === 404) {
        log(`Profile not found: ${linkedinUrl}`);
        return null;
      }
      log(`Failed to lookup profile: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as Record<string, unknown>;

    return parseProfileResponse(data, linkedinUrl);
  } catch (error) {
    log(`Error looking up profile: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Look up a LinkedIn profile by email
 */
export async function lookupProfileByEmail(
  email: string,
  config?: LinkedInConfig,
): Promise<LinkedInProfile | null> {
  const apiKey = getApiKey(config);
  if (!apiKey) {
    log("ProxyCurl API key not configured");
    return null;
  }

  try {
    const params = new URLSearchParams({
      email,
      lookup_depth: "superficial",
      enrich_profile: "enrich",
    });

    const response = await fetch(
      `${PROXYCURL_API_BASE}/linkedin/profile/resolve/email?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );

    if (!response.ok) {
      if (response.status === 404) {
        log(`No LinkedIn profile found for email: ${email}`);
        return null;
      }
      log(`Failed to lookup by email: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as { profile?: string } & Record<string, unknown>;

    // If we get a profile URL, fetch the full profile
    if (data.profile && typeof data.profile === "string") {
      return lookupProfileByUrl(data.profile, config);
    }

    return parseProfileResponse(data, undefined);
  } catch (error) {
    log(`Error looking up by email: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Look up a company by name
 */
export async function lookupCompany(
  companyName: string,
  config?: LinkedInConfig,
): Promise<{
  name: string;
  industry: string;
  description: string;
  website: string;
  linkedinUrl: string;
  employeeCount: string;
} | null> {
  const apiKey = getApiKey(config);
  if (!apiKey) {
    return null;
  }

  try {
    const params = new URLSearchParams({
      company_name: companyName,
      enrich_profile: "enrich",
    });

    const response = await fetch(
      `${PROXYCURL_API_BASE}/linkedin/company/resolve?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as Record<string, unknown>;

    return {
      name: String(data.name ?? companyName),
      industry: String(data.industry ?? ""),
      description: String(data.description ?? ""),
      website: String(data.website ?? ""),
      linkedinUrl: String(data.url ?? ""),
      employeeCount: String(data.company_size ?? ""),
    };
  } catch {
    return null;
  }
}

/**
 * Parse profile response from ProxyCurl
 */
function parseProfileResponse(
  data: Record<string, unknown>,
  profileUrl?: string,
): LinkedInProfile {
  // Extract experience for current job
  let company: string | undefined;
  let title: string | undefined;

  const experiences = data.experiences as Array<Record<string, unknown>> | undefined;
  if (experiences && experiences.length > 0) {
    const current = experiences.find((exp) => !exp.ends_at) ?? experiences[0];
    company = current.company as string | undefined;
    title = current.title as string | undefined;
  }

  return {
    firstName: data.first_name as string | undefined,
    lastName: data.last_name as string | undefined,
    headline: data.headline as string | undefined,
    summary: data.summary as string | undefined,
    company,
    title,
    industry: data.industry as string | undefined,
    location: formatLocation(data),
    profileUrl: profileUrl ?? (data.public_identifier
      ? `https://linkedin.com/in/${data.public_identifier}`
      : undefined),
    photoUrl: data.profile_pic_url as string | undefined,
    connectionCount: data.connections as number | undefined,
  };
}

/**
 * Format location from profile data
 */
function formatLocation(data: Record<string, unknown>): string | undefined {
  const city = data.city as string | undefined;
  const state = data.state as string | undefined;
  const country = data.country_full_name as string | undefined;

  const parts = [city, state, country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/**
 * Enrich a contact with LinkedIn data
 */
export async function enrichContactWithLinkedIn(
  params: {
    email?: string;
    linkedinUrl?: string;
    firstName?: string;
    lastName?: string;
    companyName?: string;
  },
  config?: LinkedInConfig,
): Promise<LinkedInProfile | null> {
  // Try LinkedIn URL first if available
  if (params.linkedinUrl) {
    const profile = await lookupProfileByUrl(params.linkedinUrl, config);
    if (profile) {
      return profile;
    }
  }

  // Try email lookup
  if (params.email) {
    const profile = await lookupProfileByEmail(params.email, config);
    if (profile) {
      return profile;
    }
  }

  // Could add name + company search here if needed
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
