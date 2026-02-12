import type { CalendlyConfig } from "../../config/types.js";
import {
  getSchedulingLink,
  listEventTypes,
  getCurrentUser,
} from "../../integrations/calendly/client.js";

export interface CalendlyLinkParams {
  eventType?: string;
}

export interface CalendlyLinkResult {
  success: boolean;
  schedulingLink?: string;
  eventTypes?: Array<{
    name: string;
    slug: string;
    schedulingUrl: string;
    duration: number;
  }>;
  error?: string;
}

/**
 * Calendly link tool for AI agent
 *
 * Returns the scheduling link to share with contacts.
 * Can also list available event types.
 */
export async function calendlyLink(
  params: CalendlyLinkParams,
  config: CalendlyConfig,
): Promise<CalendlyLinkResult> {
  try {
    // If we have a configured scheduling link, return it directly
    const configuredLink = getSchedulingLink(config);
    if (configuredLink && !params.eventType) {
      return {
        success: true,
        schedulingLink: configuredLink,
      };
    }

    // Otherwise, fetch available event types
    const eventTypes = await listEventTypes(config);

    if (eventTypes.length === 0) {
      // Try to get user's default scheduling URL
      const user = await getCurrentUser();
      if (user?.schedulingUrl) {
        return {
          success: true,
          schedulingLink: user.schedulingUrl,
        };
      }

      return {
        success: false,
        error: "No event types found and no default link configured",
      };
    }

    // If specific event type requested, find it
    if (params.eventType) {
      const event = eventTypes.find(
        (et) =>
          et.slug === params.eventType ||
          et.name.toLowerCase().includes(params.eventType!.toLowerCase()),
      );

      if (event) {
        return {
          success: true,
          schedulingLink: event.schedulingUrl,
        };
      }

      return {
        success: false,
        error: `Event type "${params.eventType}" not found`,
        eventTypes: eventTypes.map((et) => ({
          name: et.name,
          slug: et.slug,
          schedulingUrl: et.schedulingUrl,
          duration: et.duration,
        })),
      };
    }

    // Return first active event type's link
    const firstEvent = eventTypes[0];
    return {
      success: true,
      schedulingLink: firstEvent.schedulingUrl,
      eventTypes: eventTypes.map((et) => ({
        name: et.name,
        slug: et.slug,
        schedulingUrl: et.schedulingUrl,
        duration: et.duration,
      })),
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
export const calendlyLinkTool = {
  name: "calendly_link",
  description:
    "Get a Calendly scheduling link to share with contacts. Can optionally specify a specific event type.",
  parameters: {
    type: "object",
    properties: {
      eventType: {
        type: "string",
        description:
          "Optional: specific event type name or slug to get link for",
      },
    },
  },
};
