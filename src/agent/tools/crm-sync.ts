import type { CrmConfig, SupabaseConfig } from "../../config/types.js";
import { createHubSpotProvider } from "../../integrations/crm/hubspot.js";
import {
  findContactByPhone,
  updateCrmSync,
} from "../../contacts/index.js";

export interface CrmSyncParams {
  phoneNumber: string;
  createDeal?: boolean;
  dealName?: string;
  addNote?: string;
}

export interface CrmSyncResult {
  success: boolean;
  crmContactId?: string;
  dealId?: string;
  noteId?: string;
  error?: string;
}

/**
 * CRM sync tool for AI agent
 *
 * Syncs a contact to the configured CRM (HubSpot).
 * Can also create deals and add notes.
 */
export async function crmSync(
  params: CrmSyncParams,
  crmConfig: CrmConfig,
  supabaseConfig?: SupabaseConfig,
): Promise<CrmSyncResult> {
  if (!params.phoneNumber) {
    return {
      success: false,
      error: "phoneNumber is required",
    };
  }

  try {
    // Get contact from database
    const contact = await findContactByPhone(params.phoneNumber, supabaseConfig);

    if (!contact) {
      return {
        success: false,
        error: "Contact not found in database",
      };
    }

    // Get CRM provider (currently only HubSpot)
    const provider = createHubSpotProvider(crmConfig);

    if (!provider.isConfigured()) {
      return {
        success: false,
        error: "CRM provider not configured",
      };
    }

    // Sync contact to CRM
    const syncResult = await provider.syncContact(contact);

    if (!syncResult.success) {
      return {
        success: false,
        error: syncResult.error ?? "Failed to sync contact",
      };
    }

    const crmContactId = syncResult.contactId;

    // Update local database with CRM ID
    if (crmContactId) {
      await updateCrmSync(params.phoneNumber, crmContactId, supabaseConfig);
    }

    let dealId: string | undefined;
    let noteId: string | undefined;

    // Optionally create deal
    if (params.createDeal && crmContactId) {
      const dealResult = await provider.createDeal(crmContactId, {
        name:
          params.dealName ??
          `${contact.first_name ?? "New"} ${contact.last_name ?? "Contact"} - ${contact.event_name ?? "Networking"}`,
      });

      if (dealResult.success) {
        dealId = dealResult.contactId;
      }
    }

    // Optionally add note
    if (params.addNote && crmContactId) {
      const noteResult = await provider.addNote(crmContactId, params.addNote);

      if (noteResult.success) {
        noteId = noteResult.contactId;
      }
    }

    return {
      success: true,
      crmContactId,
      dealId,
      noteId,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Tool definition for agent registration
 */
export const crmSyncTool = {
  name: "crm_sync",
  description:
    "Sync a contact to the CRM (HubSpot). Creates or updates the contact in CRM and optionally creates a deal or adds a note.",
  parameters: {
    type: "object",
    properties: {
      phoneNumber: {
        type: "string",
        description: "Phone number of the contact to sync",
      },
      createDeal: {
        type: "boolean",
        description: "Whether to create a deal/opportunity for this contact",
      },
      dealName: {
        type: "string",
        description: "Custom name for the deal (optional)",
      },
      addNote: {
        type: "string",
        description: "Note to add to the contact in CRM",
      },
    },
    required: ["phoneNumber"],
  },
};
