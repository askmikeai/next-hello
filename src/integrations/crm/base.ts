import type { CrmConfig, NetworkingContact } from "../../config/types.js";

/**
 * CRM contact data for sync
 */
export interface CrmContactData {
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  company?: string;
  jobTitle?: string;
  industry?: string;
  linkedinUrl?: string;
  eventName?: string;
  customFields?: Record<string, string>;
}

/**
 * Result of a CRM operation
 */
export interface CrmOperationResult {
  success: boolean;
  contactId?: string;
  error?: string;
}

/**
 * CRM provider interface
 */
export interface CrmProvider {
  /**
   * Provider name
   */
  readonly name: string;

  /**
   * Check if provider is configured
   */
  isConfigured(): boolean;

  /**
   * Create a new contact in CRM
   */
  createContact(data: CrmContactData): Promise<CrmOperationResult>;

  /**
   * Update an existing contact in CRM
   */
  updateContact(
    contactId: string,
    data: Partial<CrmContactData>,
  ): Promise<CrmOperationResult>;

  /**
   * Find contact by email
   */
  findContactByEmail(email: string): Promise<{ contactId: string } | null>;

  /**
   * Find contact by phone
   */
  findContactByPhone(phone: string): Promise<{ contactId: string } | null>;

  /**
   * Sync a networking contact to CRM
   * Creates if not exists, updates if exists
   */
  syncContact(contact: NetworkingContact): Promise<CrmOperationResult>;
}

/**
 * Convert NetworkingContact to CrmContactData
 */
export function toCrmContactData(contact: NetworkingContact): CrmContactData {
  return {
    email: contact.email ?? undefined,
    firstName: contact.first_name ?? undefined,
    lastName: contact.last_name ?? undefined,
    phone: contact.phone_number,
    company: contact.company_name ?? undefined,
    jobTitle: contact.job_title ?? undefined,
    industry: contact.industry ?? undefined,
    linkedinUrl: contact.linkedin_url ?? undefined,
    eventName: contact.event_name ?? undefined,
  };
}

/**
 * Apply custom property mappings
 */
export function applyPropertyMappings(
  data: CrmContactData,
  mappings?: Record<string, string>,
): Record<string, string> {
  const defaultMappings: Record<string, string> = {
    email: "email",
    firstName: "firstname",
    lastName: "lastname",
    phone: "phone",
    company: "company",
    jobTitle: "jobtitle",
    industry: "industry",
    linkedinUrl: "linkedin",
    eventName: "event_source",
  };

  const finalMappings = { ...defaultMappings, ...mappings };
  const result: Record<string, string> = {};

  for (const [key, crmProperty] of Object.entries(finalMappings)) {
    const value = data[key as keyof CrmContactData];
    if (typeof value === "string" && value.trim()) {
      result[crmProperty] = value.trim();
    }
  }

  // Include custom fields
  if (data.customFields) {
    for (const [key, value] of Object.entries(data.customFields)) {
      if (value.trim()) {
        result[key] = value.trim();
      }
    }
  }

  return result;
}

/**
 * Normalize phone number for CRM
 */
export function normalizePhoneForCrm(phone: string): string {
  // Remove non-digit characters except leading +
  const cleaned = phone.replace(/[^\d+]/g, "");

  // Ensure it starts with country code
  if (!cleaned.startsWith("+")) {
    // Assume US if no country code
    return `+1${cleaned}`;
  }

  return cleaned;
}

/**
 * Factory to get CRM provider
 */
export function getCrmProvider(config: CrmConfig): CrmProvider | null {
  // Import dynamically to avoid circular dependencies
  switch (config.provider) {
    case "hubspot":
      // HubSpot provider loaded separately
      return null; // Caller should use hubspot.ts directly
    default:
      return null;
  }
}
