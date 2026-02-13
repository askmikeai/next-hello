import type { NetworkingContact, SupabaseConfig } from "../../config/types.js";
import {
  findContactByPhone,
  updateContactByPhone,
  updateContactStatus,
} from "../../contacts/index.js";
import { validateField } from "../../contacts/field-validator.js";
import {
  determineNextStatus,
  getMissingRequiredFields,
} from "../../contacts/state-machine.js";

export interface ContactUpdateParams {
  phoneNumber: string;
  updates: {
    email?: string;
    first_name?: string;
    last_name?: string;
    company_name?: string;
    job_title?: string;
    industry?: string;
    linkedin_url?: string;
  };
}

export interface ContactUpdateResult {
  success: boolean;
  contact?: {
    phone_number: string;
    status: string;
    email?: string;
    company_name?: string;
    job_title?: string;
  };
  missingFields?: string[];
  fieldsComplete: boolean;
  validationErrors?: Array<{ field: string; error: string }>;
  error?: string;
}

/**
 * Contact update tool for AI agent
 *
 * Allows the agent to update contact information collected during conversation.
 * Validates fields before updating and checks if all required fields are complete.
 */
export async function contactUpdate(
  params: ContactUpdateParams,
  config?: SupabaseConfig,
  requiredFields: string[] = ["email", "company_name", "job_title"],
): Promise<ContactUpdateResult> {
  if (!params.phoneNumber) {
    return {
      success: false,
      fieldsComplete: false,
      error: "phoneNumber is required",
    };
  }

  try {
    // Find existing contact
    const contact = await findContactByPhone(params.phoneNumber, config);
    if (!contact) {
      return {
        success: false,
        fieldsComplete: false,
        error: "Contact not found",
      };
    }

    // Validate each field being updated
    const validationErrors: Array<{ field: string; error: string }> = [];
    const validatedUpdates: Partial<NetworkingContact> = {};

    for (const [field, value] of Object.entries(params.updates)) {
      if (value === undefined || value === null || value === "") {
        continue;
      }

      const validation = validateField(field, String(value));

      if (!validation.valid && validation.error) {
        validationErrors.push({ field, error: validation.error });
      } else {
        validatedUpdates[field as keyof NetworkingContact] = validation.value as never;
      }
    }

    // If there are validation errors but some fields are valid, still update valid ones
    if (Object.keys(validatedUpdates).length > 0) {
      await updateContactByPhone(params.phoneNumber, validatedUpdates, config);
    }

    // Refresh contact to get updated state
    const updatedContact = await findContactByPhone(params.phoneNumber, config);
    if (!updatedContact) {
      return {
        success: false,
        fieldsComplete: false,
        error: "Failed to refresh contact",
      };
    }

    // Check remaining missing fields
    const missingFields = getMissingRequiredFields(updatedContact, requiredFields);
    const fieldsComplete = missingFields.length === 0;

    // Update status if needed
    const nextStatus = determineNextStatus(updatedContact, requiredFields);
    if (nextStatus !== updatedContact.status) {
      await updateContactStatus(params.phoneNumber, nextStatus, config);
    }

    return {
      success: validationErrors.length === 0,
      contact: {
        phone_number: updatedContact.phone_number,
        status: nextStatus,
        email: updatedContact.email ?? undefined,
        company_name: updatedContact.company_name ?? undefined,
        job_title: updatedContact.job_title ?? undefined,
      },
      missingFields: missingFields.length > 0 ? missingFields : undefined,
      fieldsComplete,
      validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
    };
  } catch (error) {
    return {
      success: false,
      fieldsComplete: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Tool definition for agent registration
 */
export const contactUpdateTool = {
  name: "contact_update",
  description:
    "Update contact information in the database. Use this to save information the user provides during conversation (email, company, job title, etc.). Validates input and reports any missing required fields.",
  parameters: {
    type: "object",
    properties: {
      phoneNumber: {
        type: "string",
        description: "Phone number of the contact to update (E.164 format)",
      },
      updates: {
        type: "object",
        description: "Fields to update",
        properties: {
          email: {
            type: "string",
            description: "Email address",
          },
          first_name: {
            type: "string",
            description: "First name",
          },
          last_name: {
            type: "string",
            description: "Last name",
          },
          company_name: {
            type: "string",
            description: "Company name",
          },
          job_title: {
            type: "string",
            description: "Job title / role",
          },
          industry: {
            type: "string",
            description: "Industry sector",
          },
          linkedin_url: {
            type: "string",
            description: "LinkedIn profile URL",
          },
        },
      },
    },
    required: ["phoneNumber", "updates"],
  },
};
