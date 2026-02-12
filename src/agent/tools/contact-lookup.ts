import type { SupabaseConfig } from "../../config/types.js";
import {
  findContactByEmail,
  findContactByPhone,
} from "../../contacts/supabase-repo.js";
import { getMissingRequiredFields } from "../../contacts/state-machine.js";

export interface ContactLookupParams {
  phoneNumber?: string;
  email?: string;
}

export interface ContactLookupResult {
  found: boolean;
  contact?: {
    phone_number: string;
    email?: string;
    first_name?: string;
    last_name?: string;
    company_name?: string;
    job_title?: string;
    industry?: string;
    linkedin_url?: string;
    event_name?: string;
    status?: string;
  };
  missingFields?: string[];
  error?: string;
}

/**
 * Contact lookup tool for AI agent
 *
 * Allows the agent to look up contact information by phone number or email.
 */
export async function contactLookup(
  params: ContactLookupParams,
  config?: SupabaseConfig,
  requiredFields: string[] = ["email", "company_name", "job_title"],
): Promise<ContactLookupResult> {
  if (!params.phoneNumber && !params.email) {
    return {
      found: false,
      error: "Either phoneNumber or email must be provided",
    };
  }

  try {
    let contact = null;

    if (params.phoneNumber) {
      contact = await findContactByPhone(params.phoneNumber, config);
    }

    if (!contact && params.email) {
      contact = await findContactByEmail(params.email, config);
    }

    if (!contact) {
      return { found: false };
    }

    const missingFields = getMissingRequiredFields(contact, requiredFields);

    return {
      found: true,
      contact: {
        phone_number: contact.phone_number,
        email: contact.email ?? undefined,
        first_name: contact.first_name ?? undefined,
        last_name: contact.last_name ?? undefined,
        company_name: contact.company_name ?? undefined,
        job_title: contact.job_title ?? undefined,
        industry: contact.industry ?? undefined,
        linkedin_url: contact.linkedin_url ?? undefined,
        event_name: contact.event_name ?? undefined,
        status: contact.status ?? "new",
      },
      missingFields: missingFields.length > 0 ? missingFields : undefined,
    };
  } catch (error) {
    return {
      found: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Tool definition for agent registration
 */
export const contactLookupTool = {
  name: "contact_lookup",
  description:
    "Look up a contact in the database by phone number or email. Returns contact details and any missing required fields that need to be collected.",
  parameters: {
    type: "object",
    properties: {
      phoneNumber: {
        type: "string",
        description: "Phone number to look up (E.164 format preferred)",
      },
      email: {
        type: "string",
        description: "Email address to look up",
      },
    },
  },
};
