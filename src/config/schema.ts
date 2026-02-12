import { z } from "zod";

/**
 * Zod schemas for networking event plugin configuration
 */

export const supabaseConfigSchema = z.object({
  tableName: z.string().optional().default("networking_contacts"),
});

export const heygenConfigSchema = z.object({
  avatarId: z.string().optional(),
  voiceId: z.string().optional(),
  scriptTemplate: z.string().optional(),
  useWebhook: z.boolean().optional().default(false),
  webhookUrl: z.string().url().optional(),
});

export const calendlyConfigSchema = z.object({
  organizationUri: z.string().optional(),
  schedulingLink: z.string().url().optional(),
  webhookSigningKey: z.string().optional(),
});

export const linkedinConfigSchema = z.object({
  provider: z.literal("proxycurl").optional().default("proxycurl"),
  apiKey: z.string().optional(),
});

export const emailConfigSchema = z.object({
  provider: z.enum(["sendgrid", "resend"]).optional().default("sendgrid"),
  fromEmail: z.string().email().optional(),
  fromName: z.string().optional(),
  apiKey: z.string().optional(),
});

export const crmConfigSchema = z.object({
  provider: z.literal("hubspot").optional().default("hubspot"),
  apiKey: z.string().optional(),
  propertyMappings: z.record(z.string()).optional(),
});

export const agentConfigSchema = z.object({
  model: z.string().optional().default("claude-sonnet-4-20250514"),
  systemPromptAdditions: z.string().optional(),
  maxTurns: z.number().int().positive().optional().default(10),
});

export const networkingEventConfigSchema = z.object({
  enabled: z.boolean().optional().default(false),
  eventName: z.string().optional(),
  ownerName: z.string().optional(),
  requiredFields: z
    .array(z.string())
    .optional()
    .default(["email", "company_name", "job_title"]),
  supabase: supabaseConfigSchema.optional(),
  heygen: heygenConfigSchema.optional(),
  calendly: calendlyConfigSchema.optional(),
  linkedin: linkedinConfigSchema.optional(),
  email: emailConfigSchema.optional(),
  crm: crmConfigSchema.optional(),
  agent: agentConfigSchema.optional(),
  channels: z
    .array(z.enum(["whatsapp", "telegram"]))
    .optional()
    .default(["whatsapp"]),
});

export type NetworkingEventConfigInput = z.input<typeof networkingEventConfigSchema>;
export type NetworkingEventConfigOutput = z.output<typeof networkingEventConfigSchema>;

/**
 * Parse and validate plugin configuration
 */
export function parseConfig(input: unknown): NetworkingEventConfigOutput {
  return networkingEventConfigSchema.parse(input);
}

/**
 * Safely parse configuration, returning null on error
 */
export function safeParseConfig(
  input: unknown,
): NetworkingEventConfigOutput | null {
  const result = networkingEventConfigSchema.safeParse(input);
  return result.success ? result.data : null;
}
