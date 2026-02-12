import type { CrmConfig, NetworkingContact } from "../../config/types.js";
import type {
  CrmContactData,
  CrmOperationResult,
  CrmProvider,
} from "./base.js";
import { applyPropertyMappings, normalizePhoneForCrm, toCrmContactData } from "./base.js";

const HUBSPOT_API_BASE = "https://api.hubapi.com";

function getApiKey(config?: CrmConfig): string | null {
  return config?.apiKey ?? process.env.HUBSPOT_API_KEY ?? null;
}

function log(message: string): void {
  console.log(`[hubspot] ${message}`);
}

/**
 * HubSpot CRM provider
 */
export class HubSpotProvider implements CrmProvider {
  readonly name = "hubspot";
  private config: CrmConfig;

  constructor(config: CrmConfig = {}) {
    this.config = config;
  }

  isConfigured(): boolean {
    return getApiKey(this.config) !== null;
  }

  private getHeaders(): Record<string, string> {
    const apiKey = getApiKey(this.config);
    if (!apiKey) {
      throw new Error("HubSpot API key not configured");
    }

    return {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
  }

  async createContact(data: CrmContactData): Promise<CrmOperationResult> {
    if (!this.isConfigured()) {
      return { success: false, error: "HubSpot not configured" };
    }

    const properties = applyPropertyMappings(data, this.config.propertyMappings);

    // Normalize phone
    if (properties.phone) {
      properties.phone = normalizePhoneForCrm(properties.phone);
    }

    try {
      const response = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/contacts`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ properties }),
      });

      if (!response.ok) {
        const error = await response.text();
        log(`Create contact failed: ${response.status} - ${error}`);

        // Check for duplicate
        if (response.status === 409) {
          const errorData = JSON.parse(error) as { message?: string };
          const existingIdMatch = errorData.message?.match(/ID:\s*(\d+)/);
          if (existingIdMatch) {
            return {
              success: true,
              contactId: existingIdMatch[1],
            };
          }
        }

        return { success: false, error };
      }

      const result = (await response.json()) as { id?: string };
      log(`Contact created: ${result.id}`);

      return { success: true, contactId: result.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Error creating contact: ${message}`);
      return { success: false, error: message };
    }
  }

  async updateContact(
    contactId: string,
    data: Partial<CrmContactData>,
  ): Promise<CrmOperationResult> {
    if (!this.isConfigured()) {
      return { success: false, error: "HubSpot not configured" };
    }

    const properties = applyPropertyMappings(
      data as CrmContactData,
      this.config.propertyMappings,
    );

    // Normalize phone
    if (properties.phone) {
      properties.phone = normalizePhoneForCrm(properties.phone);
    }

    try {
      const response = await fetch(
        `${HUBSPOT_API_BASE}/crm/v3/objects/contacts/${contactId}`,
        {
          method: "PATCH",
          headers: this.getHeaders(),
          body: JSON.stringify({ properties }),
        },
      );

      if (!response.ok) {
        const error = await response.text();
        log(`Update contact failed: ${response.status} - ${error}`);
        return { success: false, error };
      }

      log(`Contact updated: ${contactId}`);
      return { success: true, contactId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Error updating contact: ${message}`);
      return { success: false, error: message };
    }
  }

  async findContactByEmail(email: string): Promise<{ contactId: string } | null> {
    if (!this.isConfigured()) {
      return null;
    }

    try {
      const response = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/contacts/search`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                {
                  propertyName: "email",
                  operator: "EQ",
                  value: email,
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as { results?: Array<{ id: string }> };

      if (data.results && data.results.length > 0) {
        return { contactId: data.results[0].id };
      }

      return null;
    } catch {
      return null;
    }
  }

  async findContactByPhone(phone: string): Promise<{ contactId: string } | null> {
    if (!this.isConfigured()) {
      return null;
    }

    const normalizedPhone = normalizePhoneForCrm(phone);

    try {
      const response = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/contacts/search`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                {
                  propertyName: "phone",
                  operator: "EQ",
                  value: normalizedPhone,
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as { results?: Array<{ id: string }> };

      if (data.results && data.results.length > 0) {
        return { contactId: data.results[0].id };
      }

      return null;
    } catch {
      return null;
    }
  }

  async syncContact(contact: NetworkingContact): Promise<CrmOperationResult> {
    if (!this.isConfigured()) {
      return { success: false, error: "HubSpot not configured" };
    }

    const data = toCrmContactData(contact);

    // Try to find existing contact
    let existingId: string | undefined;

    if (data.email) {
      const byEmail = await this.findContactByEmail(data.email);
      if (byEmail) {
        existingId = byEmail.contactId;
      }
    }

    if (!existingId && data.phone) {
      const byPhone = await this.findContactByPhone(data.phone);
      if (byPhone) {
        existingId = byPhone.contactId;
      }
    }

    if (existingId) {
      log(`Found existing contact ${existingId}, updating`);
      return this.updateContact(existingId, data);
    }

    log(`Creating new contact`);
    return this.createContact(data);
  }

  /**
   * Get contact by ID
   */
  async getContact(
    contactId: string,
  ): Promise<Record<string, unknown> | null> {
    if (!this.isConfigured()) {
      return null;
    }

    try {
      const response = await fetch(
        `${HUBSPOT_API_BASE}/crm/v3/objects/contacts/${contactId}?properties=email,firstname,lastname,phone,company,jobtitle,industry`,
        {
          method: "GET",
          headers: this.getHeaders(),
        },
      );

      if (!response.ok) {
        return null;
      }

      return (await response.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /**
   * Create a deal associated with contact
   */
  async createDeal(
    contactId: string,
    dealData: {
      name: string;
      stage?: string;
      amount?: number;
      pipeline?: string;
    },
  ): Promise<CrmOperationResult> {
    if (!this.isConfigured()) {
      return { success: false, error: "HubSpot not configured" };
    }

    try {
      // Create deal
      const dealResponse = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/deals`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          properties: {
            dealname: dealData.name,
            dealstage: dealData.stage ?? "appointmentscheduled",
            amount: dealData.amount?.toString(),
            pipeline: dealData.pipeline ?? "default",
          },
        }),
      });

      if (!dealResponse.ok) {
        const error = await dealResponse.text();
        return { success: false, error };
      }

      const deal = (await dealResponse.json()) as { id?: string };

      if (!deal.id) {
        return { success: false, error: "No deal ID returned" };
      }

      // Associate deal with contact
      await fetch(
        `${HUBSPOT_API_BASE}/crm/v3/objects/deals/${deal.id}/associations/contacts/${contactId}/deal_to_contact`,
        {
          method: "PUT",
          headers: this.getHeaders(),
        },
      );

      return { success: true, contactId: deal.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  /**
   * Add note to contact
   */
  async addNote(
    contactId: string,
    noteBody: string,
  ): Promise<CrmOperationResult> {
    if (!this.isConfigured()) {
      return { success: false, error: "HubSpot not configured" };
    }

    try {
      const noteResponse = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/notes`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          properties: {
            hs_note_body: noteBody,
            hs_timestamp: new Date().toISOString(),
          },
        }),
      });

      if (!noteResponse.ok) {
        const error = await noteResponse.text();
        return { success: false, error };
      }

      const note = (await noteResponse.json()) as { id?: string };

      if (!note.id) {
        return { success: false, error: "No note ID returned" };
      }

      // Associate note with contact
      await fetch(
        `${HUBSPOT_API_BASE}/crm/v3/objects/notes/${note.id}/associations/contacts/${contactId}/note_to_contact`,
        {
          method: "PUT",
          headers: this.getHeaders(),
        },
      );

      return { success: true, contactId: note.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }
}

/**
 * Create HubSpot provider instance
 */
export function createHubSpotProvider(config?: CrmConfig): HubSpotProvider {
  return new HubSpotProvider(config ?? {});
}
