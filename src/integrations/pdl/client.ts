/**
 * People Data Labs API Client
 *
 * Enriches contact data using PDL's person and company APIs.
 * Documentation: https://docs.peopledatalabs.com/
 */

import { createLogger } from "../../observability/logger.js";
import { recordIntegrationCall, startTimer } from "../../observability/metrics.js";

const logger = createLogger({ component: "pdl-client" });

const PDL_API_BASE = "https://api.peopledatalabs.com/v5";

// Rate limit configuration
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000; // 1 second
const MAX_DELAY_MS = 30000; // 30 seconds

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay with jitter
 */
function getBackoffDelay(attempt: number, retryAfterHeader?: string | null): number {
  // If server provided Retry-After header, use it
  if (retryAfterHeader) {
    const retryAfterSeconds = parseInt(retryAfterHeader, 10);
    if (!isNaN(retryAfterSeconds)) {
      return Math.min(retryAfterSeconds * 1000, MAX_DELAY_MS);
    }
  }

  // Exponential backoff: 1s, 2s, 4s, etc. with jitter
  const exponentialDelay = BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * 500; // 0-500ms jitter
  return Math.min(exponentialDelay + jitter, MAX_DELAY_MS);
}

// ============================================================================
// Types
// ============================================================================

export interface PDLPersonEnrichmentParams {
  // Identity (at least one required)
  email?: string;
  phone?: string;
  profile?: string;  // LinkedIn URL
  lid?: string;      // LinkedIn ID
  pdl_id?: string;

  // Name + context (alternative to identity)
  first_name?: string;
  last_name?: string;
  name?: string;
  company?: string;
  school?: string;
  location?: string;
  locality?: string;
  region?: string;
  country?: string;

  // Options
  min_likelihood?: number;  // 1-10, default 2
  titlecase?: boolean;
  include_if_matched?: boolean;
  required?: string;
  data_include?: string;
}

export interface PDLPersonRecord {
  id: string;
  full_name: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  birth_year?: number;
  birth_date?: string;
  sex?: "male" | "female";

  // Contact info
  work_email?: string;
  personal_emails?: string[];
  recommended_personal_email?: string;
  mobile_phone?: string;
  phone_numbers?: string[];

  // Current job
  job_title?: string;
  job_title_role?: string;
  job_title_sub_role?: string;
  job_title_levels?: string[];
  job_start_date?: string;
  inferred_salary?: string;
  inferred_years_experience?: number;

  // Current company
  job_company_name?: string;
  job_company_id?: string;
  job_company_website?: string;
  job_company_linkedin_url?: string;
  job_company_size?: string;
  job_company_industry?: string;
  job_company_type?: string;
  job_company_founded?: number;
  job_company_location_name?: string;
  job_company_employee_count?: number;
  job_company_inferred_revenue?: string;

  // Location
  location_name?: string;
  location_locality?: string;
  location_region?: string;
  location_country?: string;
  location_postal_code?: string;
  location_street_address?: string;
  location_geo?: string;

  // Social profiles
  linkedin_url?: string;
  linkedin_id?: string;
  linkedin_username?: string;
  linkedin_connections?: number;
  twitter_url?: string;
  twitter_username?: string;
  github_url?: string;
  github_username?: string;
  facebook_url?: string;

  // Arrays
  experience?: PDLExperience[];
  education?: PDLEducation[];
  certifications?: PDLCertification[];
  skills?: string[];
  interests?: string[];
  languages?: Array<{ name: string; proficiency?: number }>;
  profiles?: PDLProfile[];

  // Metadata
  num_sources?: number;
  num_records?: number;
  first_seen?: string;
  last_seen?: string;
  dataset_version?: string;
}

export interface PDLExperience {
  company?: {
    name?: string;
    size?: string;
    industry?: string;
    location_name?: string;
    website?: string;
    linkedin_url?: string;
  };
  title?: {
    name?: string;
    role?: string;
    sub_role?: string;
    levels?: string[];
  };
  start_date?: string;
  end_date?: string;
  is_primary?: boolean;
  summary?: string;
}

export interface PDLEducation {
  school?: {
    name?: string;
    type?: string;
    location_name?: string;
    website?: string;
    linkedin_url?: string;
  };
  degrees?: string[];
  majors?: string[];
  minors?: string[];
  start_date?: string;
  end_date?: string;
  gpa?: number;
  summary?: string;
}

export interface PDLCertification {
  name?: string;
  organization?: string;
  start_date?: string;
  end_date?: string;
}

export interface PDLProfile {
  network?: string;
  username?: string;
  id?: string;
  url?: string;
  first_seen?: string;
  last_seen?: string;
}

export interface PDLEnrichmentResult {
  success: boolean;
  status: number;
  likelihood?: number;
  matched_on?: string[];
  data?: PDLPersonRecord;
  error?: string;
}

export interface PDLCompanyEnrichmentParams {
  name?: string;
  website?: string;
  profile?: string;  // LinkedIn URL
  ticker?: string;
  pdl_id?: string;
}

export interface PDLCompanyRecord {
  id: string;
  name: string;
  display_name?: string;
  website?: string;
  size?: string;
  employee_count?: number;
  industry?: string;
  naics_code?: string;
  sic_code?: string;
  type?: string;
  founded?: number;
  inferred_revenue?: string;
  total_funding_raised?: number;
  latest_funding_stage?: string;

  // Location
  location_name?: string;
  location_locality?: string;
  location_region?: string;
  location_country?: string;
  location_street_address?: string;
  location_postal_code?: string;
  location_geo?: string;

  // Social
  linkedin_url?: string;
  linkedin_id?: string;
  twitter_url?: string;
  facebook_url?: string;

  // Tags
  tags?: string[];

  // Affiliates
  affiliated_entities?: Array<{
    name: string;
    type: string;
  }>;
}

export interface PDLCompanyResult {
  success: boolean;
  status: number;
  data?: PDLCompanyRecord;
  error?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

function getApiKey(): string | null {
  return process.env.PDL_API_KEY ?? null;
}

function buildQueryString(params: Record<string, unknown>): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.append(key, String(value));
    }
  }

  return searchParams.toString();
}

// ============================================================================
// Person Enrichment
// ============================================================================

/**
 * Enrich a person using PDL's Person Enrichment API
 *
 * @param params - Lookup parameters (email, phone, LinkedIn, name+company, etc.)
 * @returns Enrichment result with person data
 */
export async function enrichPerson(
  params: PDLPersonEnrichmentParams
): Promise<PDLEnrichmentResult> {
  const apiKey = getApiKey();

  if (!apiKey) {
    logger.warn("PDL API key not configured (PDL_API_KEY)");
    return {
      success: false,
      status: 401,
      error: "PDL API key not configured",
    };
  }

  // Validate minimum required parameters
  const hasIdentity = params.email || params.phone || params.profile || params.lid || params.pdl_id;
  const hasNameContext =
    (params.first_name && params.last_name || params.name) &&
    (params.company || params.school || params.location || params.locality || params.region);

  if (!hasIdentity && !hasNameContext) {
    return {
      success: false,
      status: 400,
      error: "Insufficient parameters: need email/phone/LinkedIn OR name + company/location",
    };
  }

  const endTimer = startTimer();

  const queryParams = {
    api_key: apiKey,
    ...params,
    titlecase: params.titlecase ?? true,
    min_likelihood: params.min_likelihood ?? 5,
    include_if_matched: params.include_if_matched ?? true,
  };

  const queryString = buildQueryString(queryParams);
  const url = `${PDL_API_BASE}/person/enrich?${queryString}`;

  logger.info({
    msg: "Calling PDL Person Enrichment API",
    hasEmail: !!params.email,
    hasPhone: !!params.phone,
    hasLinkedIn: !!params.profile || !!params.lid,
    hasName: !!params.first_name || !!params.name,
  });

  let lastError: string | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      // Handle rate limiting with retry
      if (response.status === 429) {
        if (attempt < MAX_RETRIES) {
          const retryAfter = response.headers.get("Retry-After");
          const delay = getBackoffDelay(attempt, retryAfter);
          logger.warn({
            msg: "PDL rate limited, retrying",
            attempt: attempt + 1,
            maxRetries: MAX_RETRIES,
            delayMs: delay,
          });
          await sleep(delay);
          continue;
        }
        // Max retries exceeded
        recordIntegrationCall("pdl", "person_enrich", "failure", endTimer());
        logger.error({ msg: "PDL rate limit exceeded after retries", attempts: attempt + 1 });
        return {
          success: false,
          status: 429,
          error: "Rate limit exceeded after retries",
        };
      }

      const responseData = (await response.json()) as {
        status?: number;
        likelihood?: number;
        data?: PDLPersonRecord;
        error?: { message?: string };
        matched?: string[];
      };

      if (response.ok && responseData.status === 200) {
        recordIntegrationCall("pdl", "person_enrich", "success", endTimer());

        logger.info({
          msg: "PDL enrichment successful",
          likelihood: responseData.likelihood,
          matchedOn: responseData.matched,
          hasWorkEmail: !!responseData.data?.work_email,
          hasLinkedIn: !!responseData.data?.linkedin_url,
        });

        return {
          success: true,
          status: 200,
          likelihood: responseData.likelihood,
          matched_on: responseData.matched,
          data: responseData.data,
        };
      }

      // 404 means no match found (not an error)
      if (response.status === 404) {
        recordIntegrationCall("pdl", "person_enrich", "success", endTimer()); // 404 is valid response, not failure
        logger.info("PDL enrichment: no match found");
        return {
          success: false,
          status: 404,
          error: "No matching person found",
        };
      }

      // Other errors (don't retry)
      recordIntegrationCall("pdl", "person_enrich", "failure", endTimer());
      const errorMsg = responseData.error?.message ?? `HTTP ${response.status}`;
      logger.error({ msg: "PDL enrichment failed", status: response.status, error: errorMsg });

      return {
        success: false,
        status: response.status,
        error: errorMsg,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);

      // Retry on network errors
      if (attempt < MAX_RETRIES) {
        const delay = getBackoffDelay(attempt);
        logger.warn({
          msg: "PDL API error, retrying",
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
          error: lastError,
          delayMs: delay,
        });
        await sleep(delay);
        continue;
      }
    }
  }

  // All retries exhausted
  recordIntegrationCall("pdl", "person_enrich", "failure", endTimer());
  logger.error({ msg: "PDL API error after retries", error: lastError });

  return {
    success: false,
    status: 500,
    error: lastError ?? "Unknown error after retries",
  };
}

// ============================================================================
// Company Enrichment
// ============================================================================

/**
 * Enrich a company using PDL's Company Enrichment API
 *
 * @param params - Lookup parameters (name, website, LinkedIn, etc.)
 * @returns Enrichment result with company data
 */
export async function enrichCompany(
  params: PDLCompanyEnrichmentParams
): Promise<PDLCompanyResult> {
  const apiKey = getApiKey();

  if (!apiKey) {
    return {
      success: false,
      status: 401,
      error: "PDL API key not configured",
    };
  }

  if (!params.name && !params.website && !params.profile && !params.ticker && !params.pdl_id) {
    return {
      success: false,
      status: 400,
      error: "At least one lookup parameter required (name, website, profile, ticker)",
    };
  }

  const endTimer = startTimer();

  const queryParams = {
    api_key: apiKey,
    ...params,
  };

  const queryString = buildQueryString(queryParams);
  const url = `${PDL_API_BASE}/company/enrich?${queryString}`;

  logger.info({
    msg: "Calling PDL Company Enrichment API",
    hasName: !!params.name,
    hasWebsite: !!params.website,
    hasLinkedIn: !!params.profile,
  });

  let lastError: string | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      // Handle rate limiting with retry
      if (response.status === 429) {
        if (attempt < MAX_RETRIES) {
          const retryAfter = response.headers.get("Retry-After");
          const delay = getBackoffDelay(attempt, retryAfter);
          logger.warn({
            msg: "PDL rate limited, retrying",
            attempt: attempt + 1,
            maxRetries: MAX_RETRIES,
            delayMs: delay,
          });
          await sleep(delay);
          continue;
        }
        recordIntegrationCall("pdl", "company_enrich", "failure", endTimer());
        logger.error({ msg: "PDL rate limit exceeded after retries", attempts: attempt + 1 });
        return {
          success: false,
          status: 429,
          error: "Rate limit exceeded after retries",
        };
      }

      const responseData = (await response.json()) as {
        status?: number;
        data?: PDLCompanyRecord;
        error?: { message?: string };
      };

      if (response.ok && responseData.status === 200) {
        recordIntegrationCall("pdl", "company_enrich", "success", endTimer());

        logger.info({
          msg: "PDL company enrichment successful",
          companyName: responseData.data?.name,
          industry: responseData.data?.industry,
        });

        return {
          success: true,
          status: 200,
          data: responseData.data,
        };
      }

      if (response.status === 404) {
        recordIntegrationCall("pdl", "company_enrich", "success", endTimer()); // 404 is valid response
        return {
          success: false,
          status: 404,
          error: "No matching company found",
        };
      }

      // Other errors (don't retry)
      recordIntegrationCall("pdl", "company_enrich", "failure", endTimer());
      return {
        success: false,
        status: response.status,
        error: responseData.error?.message ?? `HTTP ${response.status}`,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);

      if (attempt < MAX_RETRIES) {
        const delay = getBackoffDelay(attempt);
        logger.warn({
          msg: "PDL API error, retrying",
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
          error: lastError,
          delayMs: delay,
        });
        await sleep(delay);
        continue;
      }
    }
  }

  recordIntegrationCall("pdl", "company_enrich", "failure", endTimer());
  logger.error({ msg: "PDL API error after retries", error: lastError });

  return {
    success: false,
    status: 500,
    error: lastError ?? "Unknown error after retries",
  };
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Enrich by email address
 */
export async function enrichByEmail(email: string): Promise<PDLEnrichmentResult> {
  return enrichPerson({ email });
}

/**
 * Enrich by phone number (must include country code, e.g., +1)
 */
export async function enrichByPhone(phone: string): Promise<PDLEnrichmentResult> {
  // Ensure phone has + prefix
  const normalizedPhone = phone.startsWith("+") ? phone : `+${phone}`;
  return enrichPerson({ phone: normalizedPhone });
}

/**
 * Enrich by LinkedIn URL
 */
export async function enrichByLinkedIn(linkedinUrl: string): Promise<PDLEnrichmentResult> {
  return enrichPerson({ profile: linkedinUrl });
}

/**
 * Enrich by name and company
 */
export async function enrichByNameAndCompany(
  firstName: string,
  lastName: string,
  company: string
): Promise<PDLEnrichmentResult> {
  return enrichPerson({
    first_name: firstName,
    last_name: lastName,
    company,
  });
}

/**
 * Full enrichment - tries multiple lookup methods in order of specificity
 */
export async function enrichContact(params: {
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
}): Promise<PDLEnrichmentResult> {
  const { email, phone, linkedinUrl, firstName, lastName, company } = params;

  // Try in order of specificity
  // 1. LinkedIn URL (most specific)
  if (linkedinUrl) {
    const result = await enrichByLinkedIn(linkedinUrl);
    if (result.success) return result;
  }

  // 2. Email
  if (email) {
    const result = await enrichByEmail(email);
    if (result.success) return result;
  }

  // 3. Phone
  if (phone) {
    const result = await enrichByPhone(phone);
    if (result.success) return result;
  }

  // 4. Name + Company
  if (firstName && lastName && company) {
    const result = await enrichByNameAndCompany(firstName, lastName, company);
    if (result.success) return result;
  }

  // No match found with any method
  return {
    success: false,
    status: 404,
    error: "No match found with available information",
  };
}

/**
 * Check API key validity and get account info
 */
export async function checkApiKey(): Promise<{
  valid: boolean;
  error?: string;
}> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { valid: false, error: "PDL_API_KEY not set" };
  }

  try {
    // Try a simple enrichment to check if key works
    const response = await fetch(
      `${PDL_API_BASE}/person/enrich?api_key=${apiKey}&email=test@example.com`,
      { method: "GET" }
    );

    // 401/403 means invalid key, 404 means key is valid but no match
    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: "Invalid API key" };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
