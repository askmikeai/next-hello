import type { LinkedInConfig, SupabaseConfig } from "../../config/types.js";
import {
  enrichContactWithLinkedIn,
  lookupProfileByUrl,
  lookupCompany,
} from "../../integrations/linkedin/client.js";
import { updateContactByPhone } from "../../contacts/supabase-repo.js";

export interface LinkedInResearchParams {
  phoneNumber?: string;
  email?: string;
  linkedinUrl?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
}

export interface LinkedInResearchResult {
  success: boolean;
  profile?: {
    firstName?: string;
    lastName?: string;
    headline?: string;
    company?: string;
    title?: string;
    industry?: string;
    location?: string;
    profileUrl?: string;
  };
  company?: {
    name: string;
    industry: string;
    description: string;
    website: string;
  };
  enriched: boolean;
  error?: string;
}

/**
 * LinkedIn research tool for AI agent
 *
 * Looks up LinkedIn profile information to enrich contact data.
 * Can search by LinkedIn URL, email, or name + company.
 */
export async function linkedinResearch(
  params: LinkedInResearchParams,
  linkedinConfig?: LinkedInConfig,
  supabaseConfig?: SupabaseConfig,
): Promise<LinkedInResearchResult> {
  try {
    // If we have a LinkedIn URL, lookup directly
    if (params.linkedinUrl) {
      const profile = await lookupProfileByUrl(params.linkedinUrl, linkedinConfig);

      if (profile) {
        // Optionally update contact in database
        if (params.phoneNumber) {
          try {
            await updateContactByPhone(
              params.phoneNumber,
              {
                linkedin_url: params.linkedinUrl,
                first_name: profile.firstName,
                last_name: profile.lastName,
                company_name: profile.company,
                job_title: profile.title,
                industry: profile.industry,
              },
              supabaseConfig,
            );
          } catch (error) {
            console.log(`[linkedin-tool] Failed to update contact: ${error}`);
          }
        }

        return {
          success: true,
          profile: {
            firstName: profile.firstName,
            lastName: profile.lastName,
            headline: profile.headline,
            company: profile.company,
            title: profile.title,
            industry: profile.industry,
            location: profile.location,
            profileUrl: profile.profileUrl,
          },
          enriched: true,
        };
      }
    }

    // Try to enrich with available info
    const profile = await enrichContactWithLinkedIn(
      {
        email: params.email,
        linkedinUrl: params.linkedinUrl,
        firstName: params.firstName,
        lastName: params.lastName,
        companyName: params.companyName,
      },
      linkedinConfig,
    );

    if (profile) {
      // Update contact if we have phone number
      if (params.phoneNumber) {
        try {
          await updateContactByPhone(
            params.phoneNumber,
            {
              linkedin_url: profile.profileUrl,
              first_name: profile.firstName,
              last_name: profile.lastName,
              company_name: profile.company,
              job_title: profile.title,
              industry: profile.industry,
            },
            supabaseConfig,
          );
        } catch (error) {
          console.log(`[linkedin-tool] Failed to update contact: ${error}`);
        }
      }

      return {
        success: true,
        profile: {
          firstName: profile.firstName,
          lastName: profile.lastName,
          headline: profile.headline,
          company: profile.company,
          title: profile.title,
          industry: profile.industry,
          location: profile.location,
          profileUrl: profile.profileUrl,
        },
        enriched: true,
      };
    }

    // If we have company name, try to lookup company info
    if (params.companyName) {
      const company = await lookupCompany(params.companyName, linkedinConfig);

      if (company) {
        return {
          success: true,
          company: {
            name: company.name,
            industry: company.industry,
            description: company.description,
            website: company.website,
          },
          enriched: false,
        };
      }
    }

    return {
      success: false,
      enriched: false,
      error: "Could not find LinkedIn profile with provided information",
    };
  } catch (error) {
    return {
      success: false,
      enriched: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Tool definition for agent registration
 */
export const linkedinResearchTool = {
  name: "linkedin_research",
  description:
    "Research a contact on LinkedIn to gather professional information. Can search by LinkedIn URL, email, or name + company. Updates contact record with found information.",
  parameters: {
    type: "object",
    properties: {
      phoneNumber: {
        type: "string",
        description: "Phone number of the contact to enrich (for saving data)",
      },
      email: {
        type: "string",
        description: "Email to search LinkedIn by",
      },
      linkedinUrl: {
        type: "string",
        description: "Direct LinkedIn profile URL",
      },
      firstName: {
        type: "string",
        description: "First name to help with search",
      },
      lastName: {
        type: "string",
        description: "Last name to help with search",
      },
      companyName: {
        type: "string",
        description: "Company name to help narrow search",
      },
    },
  },
};
