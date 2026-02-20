import { BaseAgent, type AgentConfig, registerAgentFactory } from "../base-agent.js";
import { defineTool } from "../llm/tool-executor.js";
import type { AgentContext, ToolDefinition, AgentType } from "../types.js";
import { updateContactByPhone } from "../../contacts/index.js";
import { enrichContactQueued, type PDLEnrichmentResult } from "../../integrations/pdl/index.js";
import {
  login as lumaLogin,
  loginWithOtp as lumaLoginWithOtp,
  hasValidSession as lumaHasSession,
  scrapeEventGuests,
  getUserEvents,
  matchContactToGuests,
  findContactInEvents,
  type LumaScrapedEvent,
  type LumaScrapedGuest,
} from "../../integrations/luma/scraper.js";
import { findEventByAttendee } from "../../integrations/luma/client.js";

/**
 * Research Agent Configuration
 */
const AGENT_CONFIG: AgentConfig = {
  type: "research",
  name: "Research Agent",
  description:
    "Performs LinkedIn and company research to enrich contact data and provide background information.",
  temperature: 0.3, // Lower temperature for more factual responses
};

/**
 * ResearchAgent - Handles LinkedIn and company research
 *
 * Responsibilities:
 * - Look up LinkedIn profiles by URL, email, or name
 * - Enrich contacts using People Data Labs API
 * - Research companies
 * - Enrich contact records with found data
 * - Update research status in database
 *
 * Tools:
 * - pdl_enrich: Enrich contact using People Data Labs (primary method)
 * - linkedin_research: Look up LinkedIn profiles (fallback)
 * - update_research_status: Mark research as complete/failed
 */
export class ResearchAgent extends BaseAgent {
  constructor() {
    super(AGENT_CONFIG);
  }

  /**
   * Get the system prompt for research
   */
  protected getSystemPrompt(context: AgentContext): string {
    const ownerName = context.config.ownerName ?? "the host";

    return `You are a research agent for ${ownerName}'s networking follow-up system.

## Your Role
You research contacts to gather professional background information that helps personalize follow-up communications.

## Research Tool: PDL Enrichment
Use the \`pdl_enrich\` tool to look up contacts. People Data Labs has a database of 3+ billion profiles and provides:
- Verified work email addresses
- Current job title and company
- Work history and education
- LinkedIn profile URL
- Company details (size, industry, revenue)
- Inferred salary range
- Skills and certifications

PDL can lookup by: email, phone number, LinkedIn URL, or name + company.

## Guidelines
- Pass the phoneNumber parameter to save enriched data automatically
- If PDL returns a match, the contact record will be updated automatically
- Report what data was found and the confidence level (likelihood score)
- If no match is found, update the research status to "failed"

## Current Task
${context.contact ? `Researching contact: ${context.contact.first_name || "Unknown"} (${context.phoneNumber})` : "New research request"}

Available info for lookup:
${context.contact?.linkedin_url ? `- LinkedIn: ${context.contact.linkedin_url}` : ""}
${context.contact?.email ? `- Email: ${context.contact.email}` : ""}
${context.contact?.first_name ? `- First Name: ${context.contact.first_name}` : ""}
${context.contact?.last_name ? `- Last Name: ${context.contact.last_name}` : ""}
${context.contact?.company_name ? `- Company: ${context.contact.company_name}` : ""}

Call pdl_enrich with the available information.`;
  }

  /**
   * Define tools available to this agent
   */
  protected getTools(): ToolDefinition[] {
    return [
      defineTool(
        "pdl_enrich",
        "Enrich a contact using People Data Labs API. Can lookup by email, phone, LinkedIn URL, or name + company. Returns comprehensive professional data including work history, education, skills, and verified contact info.",
        {
          phoneNumber: {
            type: "string",
            description: "Phone number of the contact (for saving enriched data)",
          },
          email: {
            type: "string",
            description: "Email address to lookup",
          },
          linkedinUrl: {
            type: "string",
            description: "LinkedIn profile URL",
          },
          firstName: {
            type: "string",
            description: "First name (use with lastName + company)",
          },
          lastName: {
            type: "string",
            description: "Last name (use with firstName + company)",
          },
          company: {
            type: "string",
            description: "Company name (helps narrow search when using name)",
          },
        }
      ),
      defineTool(
        "update_research_status",
        "Update the research status for a contact (pending, in_progress, complete, failed)",
        {
          phoneNumber: {
            type: "string",
            description: "Phone number of the contact",
          },
          status: {
            type: "string",
            enum: ["pending", "in_progress", "complete", "failed"],
            description: "Research status",
          },
          researchData: {
            type: "object",
            description: "Research data to store (optional)",
          },
        },
        ["phoneNumber", "status"]
      ),
      defineTool(
        "luma_check_session",
        "Check if Luma browser session is valid. Returns whether login is needed.",
        {}
      ),
      defineTool(
        "luma_login",
        "Open browser for Luma login. User will manually log in, session is saved for future use.",
        {}
      ),
      defineTool(
        "luma_scrape_event",
        "Scrape all guests from a Luma event page. Returns attendee names and social profiles.",
        {
          eventUrl: {
            type: "string",
            description: "Full Luma event URL (e.g., https://lu.ma/event-name)",
          },
        },
        ["eventUrl"]
      ),
      defineTool(
        "luma_get_user_events",
        "Get list of events the user is attending or hosting on Luma.",
        {}
      ),
      defineTool(
        "luma_find_event_match",
        "Find which event a contact attended by matching their name against scraped guest lists.",
        {
          contactName: {
            type: "string",
            description: "Full name of the contact to match",
          },
          phoneNumber: {
            type: "string",
            description: "Phone number to update if match found (optional)",
          },
        },
        ["contactName"]
      ),
      defineTool(
        "luma_api_lookup",
        "Look up a contact in Luma events using the API (requires API key, limited to hosted events).",
        {
          contactName: {
            type: "string",
            description: "Full name of the contact to search for",
          },
        },
        ["contactName"]
      ),
    ];
  }

  /**
   * Register tool handlers
   */
  protected registerTools(): void {
    // PDL Enrichment (primary method)
    this.toolExecutor.registerTool(
      defineTool(
        "pdl_enrich",
        "Enrich contact using People Data Labs",
        {
          phoneNumber: { type: "string" },
          email: { type: "string" },
          linkedinUrl: { type: "string" },
          firstName: { type: "string" },
          lastName: { type: "string" },
          company: { type: "string" },
        }
      ),
      async (input, context) => {
        const result: PDLEnrichmentResult = await enrichContactQueued({
          email: input.email as string | undefined,
          phone: input.phoneNumber as string | undefined,
          linkedinUrl: input.linkedinUrl as string | undefined,
          firstName: input.firstName as string | undefined,
          lastName: input.lastName as string | undefined,
          company: input.company as string | undefined,
        }, { correlationId: context.correlationId });

        if (result.success && result.data && input.phoneNumber) {
          // Update contact with enriched data
          try {
            const enrichedData: Record<string, unknown> = {};

            if (result.data.job_title) enrichedData.job_title = result.data.job_title;
            if (result.data.job_company_name) enrichedData.company_name = result.data.job_company_name;
            if (result.data.linkedin_url) enrichedData.linkedin_url = result.data.linkedin_url;
            if (result.data.work_email) enrichedData.email = result.data.work_email;
            if (result.data.first_name) enrichedData.first_name = result.data.first_name;
            if (result.data.last_name) enrichedData.last_name = result.data.last_name;
            if (result.data.location_locality) enrichedData.location = result.data.location_name;
            if (result.data.job_company_industry) enrichedData.industry = result.data.job_company_industry;

            await updateContactByPhone(
              input.phoneNumber as string,
              enrichedData,
              context.config.supabase
            );

            context.logger.info({
              msg: "Contact enriched via PDL",
              phoneNumber: input.phoneNumber,
              likelihood: result.likelihood,
              matchedOn: result.matched_on,
            });
          } catch (error) {
            context.logger.error({
              msg: "Failed to update contact with PDL data",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        return {
          success: result.success,
          likelihood: result.likelihood,
          matchedOn: result.matched_on,
          data: result.data ? {
            fullName: result.data.full_name,
            jobTitle: result.data.job_title,
            company: result.data.job_company_name,
            companyIndustry: result.data.job_company_industry,
            companySize: result.data.job_company_size,
            linkedinUrl: result.data.linkedin_url,
            workEmail: result.data.work_email,
            location: result.data.location_name,
            inferredSalary: result.data.inferred_salary,
            yearsExperience: result.data.inferred_years_experience,
            skills: result.data.skills,
            educationCount: result.data.education?.length ?? 0,
            experienceCount: result.data.experience?.length ?? 0,
          } : undefined,
          error: result.error,
        };
      }
    );

    // Update research status
    this.toolExecutor.registerTool(
      defineTool(
        "update_research_status",
        "Update research status",
        {
          phoneNumber: { type: "string" },
          status: { type: "string" },
          researchData: { type: "object" },
        },
        ["phoneNumber", "status"]
      ),
      async (input, context) => {
        try {
          await updateContactByPhone(
            input.phoneNumber as string,
            {
              research_status: input.status as "pending" | "in_progress" | "complete" | "failed",
              research_data: input.researchData as Record<string, unknown> | undefined,
            },
            context.config.supabase
          );
          return { success: true, status: input.status };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      }
    );

    // Luma: Check session
    this.toolExecutor.registerTool(
      defineTool("luma_check_session", "Check Luma session", {}),
      async () => {
        const hasSession = await lumaHasSession();
        return {
          hasValidSession: hasSession,
          needsLogin: !hasSession,
          message: hasSession
            ? "Luma session is valid"
            : "No valid Luma session. Use luma_login to authenticate.",
        };
      }
    );

    // Luma: Login (opens browser for manual OTP entry)
    this.toolExecutor.registerTool(
      defineTool("luma_login", "Login to Luma (opens browser for email OTP)", {}),
      async (_input, context) => {
        context.logger.info({ msg: "Opening browser for Luma login (email OTP)" });
        const success = await lumaLogin();
        return {
          success,
          message: success
            ? "Successfully logged in to Luma. Session saved."
            : "Login failed or was cancelled.",
        };
      }
    );

    // Luma: Login with OTP (automated flow)
    this.toolExecutor.registerTool(
      defineTool("luma_login_otp", "Login to Luma with OTP code from email", {
        email: { type: "string" },
        otpCode: { type: "string" },
      }, ["email", "otpCode"]),
      async (input, context) => {
        const email = input.email as string;
        const otpCode = input.otpCode as string;
        context.logger.info({ msg: "Logging in to Luma with OTP", email });
        const success = await lumaLoginWithOtp(email, otpCode);
        return {
          success,
          message: success
            ? "Successfully logged in to Luma with OTP. Session saved."
            : "OTP login failed. Code may be expired or invalid.",
        };
      }
    );

    // Luma: Scrape event guests (click modal, scroll, extract)
    this.toolExecutor.registerTool(
      defineTool("luma_scrape_event", "Scrape Luma event guests by clicking attendee modal", {
        eventUrlOrSlug: { type: "string" },
      }, ["eventUrlOrSlug"]),
      async (input, context) => {
        const eventUrlOrSlug = input.eventUrlOrSlug as string;
        context.logger.info({ msg: "Scraping Luma event", eventUrlOrSlug });

        const event = await scrapeEventGuests(eventUrlOrSlug);
        if (!event) {
          return { success: false, error: "Failed to scrape event. May need to login first." };
        }

        // Store in cache for future matching
        this.cacheScrapedEvent(event);

        return {
          success: true,
          event: {
            slug: event.slug,
            name: event.name,
            url: event.url,
            date: event.date,
            guestCount: event.guestCount,
            scrapedGuests: event.guests.length,
            guests: event.guests.slice(0, 20).map(g => ({
              name: g.name,
              lumaProfile: g.lumaProfile,
              instagram: g.instagram,
              twitter: g.twitter,
            })),
          },
        };
      }
    );

    // Luma: Get user events from /home page
    this.toolExecutor.registerTool(
      defineTool("luma_get_user_events", "Get user's upcoming and past Luma events", {}),
      async (_input, context) => {
        context.logger.info({ msg: "Fetching user's Luma events from /home" });
        const events = await getUserEvents();

        if (events.length === 0) {
          return {
            success: false,
            error: "No events found. May need to login first.",
            needsLogin: true,
          };
        }

        return {
          success: true,
          count: events.length,
          events: events.map(e => ({
            slug: e.slug,
            name: e.name,
            url: e.url,
            date: e.date,
            tab: e.tab, // "upcoming" or "past"
          })),
        };
      }
    );

    // Luma: Find event match for a contact name
    this.toolExecutor.registerTool(
      defineTool("luma_find_event_match", "Match contact name against scraped event guests", {
        contactName: { type: "string" },
        phoneNumber: { type: "string" },
      }, ["contactName"]),
      async (input, context) => {
        const contactName = input.contactName as string;
        const phoneNumber = input.phoneNumber as string | undefined;

        // Get cached events
        const cachedEvents = this.getCachedEvents();

        if (cachedEvents.length === 0) {
          return {
            success: false,
            error: "No scraped events in cache. Use luma_scrape_event first.",
          };
        }

        // Find match across all cached events
        const match = await findContactInEvents(contactName, cachedEvents);

        if (match && phoneNumber) {
          // Update contact with event info
          try {
            await updateContactByPhone(
              phoneNumber,
              { event_met_at: match.event.name },
              context.config.supabase
            );
            context.logger.info({
              msg: "Updated contact with event match",
              phoneNumber,
              eventName: match.event.name,
            });
          } catch (error) {
            context.logger.error({
              msg: "Failed to update contact with event",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        if (match) {
          return {
            success: true,
            matched: true,
            eventSlug: match.event.slug,
            eventName: match.event.name,
            eventUrl: match.event.url,
            eventDate: match.event.date,
            guestName: match.guest.name,
            matchScore: match.score,
            guestLumaProfile: match.guest.lumaProfile,
            guestInstagram: match.guest.instagram,
            guestTwitter: match.guest.twitter,
          };
        }

        return {
          success: true,
          matched: false,
          message: `No match found for "${contactName}" in ${cachedEvents.length} cached events`,
        };
      }
    );

    // Luma: API lookup (for hosted events)
    this.toolExecutor.registerTool(
      defineTool("luma_api_lookup", "Luma API lookup", {
        contactName: { type: "string" },
      }, ["contactName"]),
      async (input, context) => {
        const contactName = input.contactName as string;

        const match = await findEventByAttendee(contactName, context.config.luma);

        if (match) {
          return {
            success: true,
            matched: true,
            eventName: match.event.name,
            eventDate: match.event.start_at,
            guestName: match.guest.name,
            similarity: match.similarity,
          };
        }

        return {
          success: true,
          matched: false,
          message: `No match found via API for "${contactName}"`,
        };
      }
    );
  }

  // Cache for scraped events (in-memory, could be Redis)
  private scrapedEventsCache: LumaScrapedEvent[] = [];

  private cacheScrapedEvent(event: LumaScrapedEvent): void {
    // Remove old version if exists (by slug)
    this.scrapedEventsCache = this.scrapedEventsCache.filter(e => e.slug !== event.slug);
    this.scrapedEventsCache.push(event);
  }

  private getCachedEvents(): LumaScrapedEvent[] {
    return this.scrapedEventsCache;
  }

  /**
   * Determine if handoff to another agent is needed
   */
  protected determineNextAgent(): AgentType | undefined {
    // After research, typically hand off to qualification
    return "qualification";
  }

  /**
   * Check if this agent can handle a given action
   */
  canHandle(action: string): boolean {
    const supportedActions = [
      "pdl_enrich",
      "company_research",
      "enrich_contact",
      "background_check",
    ];
    return supportedActions.includes(action);
  }
}

// Register the factory for this agent
registerAgentFactory("research", () => new ResearchAgent());

export default ResearchAgent;
