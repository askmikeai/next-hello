import { BaseAgent, type AgentConfig, registerAgentFactory } from "../base-agent.js";
import { defineTool } from "../llm/tool-executor.js";
import type { AgentContext, ToolDefinition, AgentType } from "../types.js";
import { crmSync } from "../../agent/tools/crm-sync.js";
import { findContactByPhone } from "../../contacts/index.js";

/**
 * CRM Agent Configuration
 */
const AGENT_CONFIG: AgentConfig = {
  type: "crm",
  name: "CRM Agent",
  description:
    "Manages HubSpot CRM synchronization, creates deals, and adds notes to contacts.",
  temperature: 0.2, // Low temperature for consistent operations
};

/**
 * CRMAgent - Handles CRM synchronization
 *
 * Responsibilities:
 * - Sync contacts to HubSpot CRM
 * - Create deals/opportunities
 * - Add notes to contacts
 * - Track sync status
 *
 * Tools:
 * - crm_sync: Sync contact to CRM
 * - create_deal: Create a deal for a contact
 * - add_note: Add notes to CRM contact
 */
export class CRMAgent extends BaseAgent {
  constructor() {
    super(AGENT_CONFIG);
  }

  /**
   * Get the system prompt for CRM operations
   */
  protected getSystemPrompt(context: AgentContext): string {
    const ownerName = context.config.ownerName ?? "the host";
    const crmConfigured = !!context.config.crm?.apiKey;

    return `You are a CRM synchronization agent for ${ownerName}'s networking system.

## Your Role
Manage contact synchronization with HubSpot CRM.

## CRM Status
${crmConfigured ? "HubSpot CRM is configured and ready." : "Warning: CRM is not configured. Operations will fail."}

## Tasks You Handle
1. **Contact Sync**: Create or update contacts in HubSpot
2. **Deal Creation**: Create opportunities/deals for qualified leads
3. **Note Adding**: Add context and conversation summaries
4. **Status Tracking**: Track what has been synced

## Best Practices
- Only sync contacts with complete required fields
- Create deals for qualified leads (hot/warm tiers)
- Add meaningful notes summarizing the interaction
- Check if already synced before creating duplicates

## Current Contact
${this.formatContactForSync(context)}

Perform the requested CRM operation.`;
  }

  /**
   * Format contact data for sync context
   */
  private formatContactForSync(context: AgentContext): string {
    const contact = context.contact;
    if (!contact) {
      return "No contact data available.";
    }

    const lines: string[] = [];
    lines.push(`Phone: ${contact.phone_number}`);
    if (contact.first_name) lines.push(`Name: ${contact.first_name} ${contact.last_name || ""}`);
    if (contact.email) lines.push(`Email: ${contact.email}`);
    if (contact.company_name) lines.push(`Company: ${contact.company_name}`);
    if (contact.job_title) lines.push(`Title: ${contact.job_title}`);
    if (contact.event_name) lines.push(`Event: ${contact.event_name}`);

    // Sync status
    if (contact.crm_contact_id) {
      lines.push(`\nAlready synced to CRM: ${contact.crm_contact_id}`);
      if (contact.crm_synced_at) {
        lines.push(`Last sync: ${new Date(contact.crm_synced_at).toLocaleString()}`);
      }
    } else {
      lines.push("\nNot yet synced to CRM");
    }

    // Qualification status
    if (contact.qualification_tier) {
      lines.push(`Qualification: ${contact.qualification_tier} (score: ${contact.qualification_score || "N/A"})`);
    }

    return lines.join("\n");
  }

  /**
   * Define tools available to this agent
   */
  protected getTools(): ToolDefinition[] {
    return [
      defineTool(
        "crm_sync",
        "Sync a contact to HubSpot CRM. Creates or updates the contact and optionally creates a deal or adds a note.",
        {
          phoneNumber: {
            type: "string",
            description: "Phone number of the contact to sync",
          },
          createDeal: {
            type: "boolean",
            description: "Whether to create a deal/opportunity",
          },
          dealName: {
            type: "string",
            description: "Custom name for the deal (optional)",
          },
          addNote: {
            type: "string",
            description: "Note to add to the CRM contact",
          },
        },
        ["phoneNumber"]
      ),
      defineTool(
        "check_sync_status",
        "Check if a contact is already synced to CRM",
        {
          phoneNumber: {
            type: "string",
            description: "Phone number of the contact",
          },
        },
        ["phoneNumber"]
      ),
      defineTool(
        "generate_deal_name",
        "Generate an appropriate deal name based on contact information",
        {
          firstName: {
            type: "string",
            description: "Contact's first name",
          },
          lastName: {
            type: "string",
            description: "Contact's last name",
          },
          company: {
            type: "string",
            description: "Contact's company",
          },
          eventName: {
            type: "string",
            description: "Event where we met",
          },
        }
      ),
    ];
  }

  /**
   * Register tool handlers
   */
  protected registerTools(): void {
    // CRM sync
    this.toolExecutor.registerTool(
      defineTool(
        "crm_sync",
        "Sync to CRM",
        {
          phoneNumber: { type: "string" },
          createDeal: { type: "boolean" },
          dealName: { type: "string" },
          addNote: { type: "string" },
        },
        ["phoneNumber"]
      ),
      async (input, context) => {
        if (!context.config.crm) {
          return { success: false, error: "CRM not configured" };
        }

        const result = await crmSync(
          {
            phoneNumber: input.phoneNumber as string,
            createDeal: input.createDeal as boolean | undefined,
            dealName: input.dealName as string | undefined,
            addNote: input.addNote as string | undefined,
          },
          context.config.crm,
          context.config.supabase
        );

        return result;
      }
    );

    // Check sync status
    this.toolExecutor.registerTool(
      defineTool(
        "check_sync_status",
        "Check CRM sync status",
        { phoneNumber: { type: "string" } },
        ["phoneNumber"]
      ),
      async (input, context) => {
        const contact = await findContactByPhone(
          input.phoneNumber as string,
          context.config.supabase
        );

        if (!contact) {
          return { found: false, error: "Contact not found" };
        }

        return {
          found: true,
          synced: !!contact.crm_contact_id,
          crmContactId: contact.crm_contact_id,
          syncedAt: contact.crm_synced_at,
        };
      }
    );

    // Generate deal name
    this.toolExecutor.registerTool(
      defineTool(
        "generate_deal_name",
        "Generate deal name",
        {
          firstName: { type: "string" },
          lastName: { type: "string" },
          company: { type: "string" },
          eventName: { type: "string" },
        }
      ),
      async (input) => {
        const firstName = (input.firstName as string) || "New";
        const lastName = (input.lastName as string) || "Contact";
        const company = input.company as string;
        const event = (input.eventName as string) || "Networking";

        let dealName = `${firstName} ${lastName}`;
        if (company) {
          dealName += ` - ${company}`;
        }
        dealName += ` (${event})`;

        return { dealName };
      }
    );
  }

  /**
   * Determine if handoff to another agent is needed
   */
  protected determineNextAgent(): AgentType | undefined {
    // CRM is typically the last step in the pipeline
    return undefined;
  }

  /**
   * Check if this agent can handle a given action
   */
  canHandle(action: string): boolean {
    const supportedActions = [
      "crm_sync",
      "create_deal",
      "add_note",
      "check_sync_status",
      "batch_sync",
    ];
    return supportedActions.includes(action);
  }
}

// Register the factory for this agent
registerAgentFactory("crm", () => new CRMAgent());

export default CRMAgent;
