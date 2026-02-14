/**
 * Networking Event Plugin Configuration Types
 */

// Database status values (from your Supabase schema)
export type ContactStatus =
  | "active"
  | "inactive"
  | "archived"
  // Workflow status values (used internally)
  | "new"
  | "welcomed"
  | "collecting"
  | "fields_complete"
  | "synced"
  | "meeting_scheduled"
  | "complete";

export type SupportedChannel = "whatsapp" | "telegram";

/**
 * @deprecated Use DatabaseConfig instead
 */
export interface SupabaseConfig {
  /** Table name for contacts (default: "networking_contacts") */
  tableName?: string;
  /** Supabase project URL */
  url?: string;
  /** Supabase service role key */
  serviceRoleKey?: string;
}

/**
 * PostgreSQL database configuration
 */
export interface DatabaseConfig {
  /** Connection URL (takes precedence over individual options) */
  url?: string;
  /** PostgreSQL host */
  host?: string;
  /** PostgreSQL port */
  port?: number;
  /** Database name */
  database?: string;
  /** Username */
  username?: string;
  /** Password */
  password?: string;
  /** Table name for contacts (default: "networking_contacts") */
  tableName?: string;
  /** Maximum connections in pool */
  maxConnections?: number;
  /** Enable SSL */
  ssl?: boolean | "require" | "prefer";
}

export interface HeyGenConfig {
  /** HeyGen API key */
  apiKey?: string;
  /** HeyGen avatar ID for video generation */
  avatarId?: string;
  /** HeyGen voice ID for video generation */
  voiceId?: string;
  /** Script template for personalized videos */
  scriptTemplate?: string;
  /** Whether to use async webhook instead of polling */
  useWebhook?: boolean;
  /** Callback URL for webhook notifications */
  webhookUrl?: string;
}

export interface ElevenLabsConfig {
  /** ElevenLabs API key (falls back to ELEVENLABS_API_KEY env) */
  apiKey?: string;
  /** Voice ID to use for TTS */
  voiceId?: string;
  /** Model ID (default: eleven_monolingual_v1) */
  modelId?: string;
  /** Script template for personalized voice messages */
  scriptTemplate?: string;
  /** Voice stability (0-1, default: 0.5) */
  stability?: number;
  /** Similarity boost (0-1, default: 0.75) */
  similarityBoost?: number;
  /** Style (0-1, default: 0) */
  style?: number;
  /** Use speaker boost (default: true) */
  useSpeakerBoost?: boolean;
}

export interface CalendlyConfig {
  /** Calendly organization URI */
  organizationUri?: string;
  /** Default scheduling link to include in messages */
  schedulingLink?: string;
  /** Webhook signing key for verification */
  webhookSigningKey?: string;
}

export interface LinkedInConfig {
  /** Provider for LinkedIn research (ProxyCurl shut down - needs alternative) */
  provider?: "disabled";
  /** API key for LinkedIn data provider */
  apiKey?: string;
}

export interface EmailConfig {
  /** Email provider ("sendgrid" or "resend") */
  provider?: "sendgrid" | "resend";
  /** From email address */
  fromEmail?: string;
  /** From display name */
  fromName?: string;
  /** API key (falls back to SENDGRID_API_KEY or RESEND_API_KEY env) */
  apiKey?: string;
}

export interface CrmConfig {
  /** CRM provider (currently only "hubspot") */
  provider?: "hubspot";
  /** API key (falls back to HUBSPOT_API_KEY env) */
  apiKey?: string;
  /** Custom property mappings for HubSpot */
  propertyMappings?: Record<string, string>;
}

export interface AgentConfig {
  /** Model to use for AI chatbot */
  model?: string;
  /** Custom system prompt additions */
  systemPromptAdditions?: string;
  /** Max conversation turns before escalation */
  maxTurns?: number;
}

/**
 * Redis configuration for queue and state management
 */
export interface RedisConfig {
  /** Redis host (default: localhost) */
  host?: string;
  /** Redis port (default: 6379) */
  port?: number;
  /** Redis password */
  password?: string;
  /** Redis database number (default: 0) */
  db?: number;
  /** Enable TLS */
  tls?: boolean;
}

/**
 * Storage configuration for media files
 */
export interface StorageConfig {
  /** Storage backend type (default: local) */
  backend?: "local" | "s3" | "r2";

  /** Local filesystem configuration */
  local?: {
    /** Base path for media storage (default: ./data/media) */
    basePath?: string;
  };

  /** S3/R2 configuration */
  s3?: {
    /** S3 bucket name */
    bucket?: string;
    /** AWS region */
    region?: string;
    /** Custom endpoint (for R2/MinIO) */
    endpoint?: string;
    /** Force path style (for non-AWS S3) */
    forcePathStyle?: boolean;
  };

  /** Retention policy settings */
  retention?: {
    /** Default retention days (default: 90) */
    defaultDays?: number;
    /** Enable automatic cleanup (default: true) */
    autoCleanup?: boolean;
    /** Cleanup interval in minutes (default: 60) */
    cleanupIntervalMinutes?: number;
  };
}

/**
 * Individual agent toggle configuration
 */
export interface AgentToggleConfig {
  /** Whether this agent is enabled */
  enabled?: boolean;
}

/**
 * Swarm AI configuration
 */
export interface SwarmConfig {
  /** Enable AI swarm (default: false, uses rule-based) */
  enabled?: boolean;

  /** Percentage of contacts to route through AI swarm (0-100) */
  rolloutPercentage?: number;

  /** Fallback to rule-based handling when AI fails */
  fallbackToRules?: boolean;

  /** Maximum conversation turns before handoff */
  maxConversationTurns?: number;

  /** Token budget for conversation context (default: 8000) */
  contextTokenBudget?: number;

  /** Default model for swarm agents */
  defaultModel?: string;

  /** Redis configuration for swarm state */
  redis?: RedisConfig;

  /** Individual agent configurations */
  agents?: {
    conversation?: AgentToggleConfig;
    research?: AgentToggleConfig;
    qualification?: AgentToggleConfig;
    personalization?: AgentToggleConfig;
    video?: AgentToggleConfig;
    voice?: AgentToggleConfig;
    crm?: AgentToggleConfig;
  };
}

export interface NetworkingEventConfig {
  /** Enable the plugin (default: false) */
  enabled?: boolean;

  /** Event name for context (e.g., "AI Summit 2024") */
  eventName?: string;

  /** Owner/host name for personalization */
  ownerName?: string;

  /** Required fields to collect (default: ["email", "company_name", "job_title"]) */
  requiredFields?: string[];

  /** Database configuration (PostgreSQL) */
  database?: DatabaseConfig;

  /** @deprecated Use database instead */
  supabase?: SupabaseConfig;

  /** HeyGen video generation configuration */
  heygen?: HeyGenConfig;

  /** ElevenLabs voice message configuration */
  elevenlabs?: ElevenLabsConfig;

  /** Calendly scheduling configuration */
  calendly?: CalendlyConfig;

  /** LinkedIn research configuration */
  linkedin?: LinkedInConfig;

  /** Email sending configuration */
  email?: EmailConfig;

  /** CRM sync configuration */
  crm?: CrmConfig;

  /** AI agent configuration */
  agent?: AgentConfig;

  /** Enabled channels (default: ["whatsapp"]) */
  channels?: SupportedChannel[];

  /** AI Swarm configuration */
  swarm?: SwarmConfig;

  /** Media storage configuration */
  storage?: StorageConfig;
}

/**
 * Contact record stored in Supabase
 * Matches networking_contacts table schema
 */
export interface NetworkingContact {
  id?: string; // UUID
  phone_number: string;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  company_name?: string | null;
  job_title?: string | null;
  website?: string | null;
  linkedin_url?: string | null;
  twitter_handle?: string | null;

  // Event context
  event_met_at?: string | null;
  event_name?: string | null; // alias for event_met_at (used by code)
  date_met?: string | null; // date

  // Relationship details
  mutual_connection?: string | null;
  how_i_can_help?: string | null;
  what_theyre_working_on?: string | null;
  their_ask_or_need?: string | null;

  // Organization
  tags?: string[] | null;
  notes?: string | null;
  industry?: string | null;

  // Follow-up tracking
  last_contact_date?: string | null; // date
  next_followup_date?: string | null; // date
  last_message_at?: string | null;

  // Workflow
  status?: ContactStatus;

  // HeyGen
  heygen_video_id?: string | null;
  heygen_video_url?: string | null;

  // Calendly
  calendly_event_uri?: string | null;
  calendly_scheduled_at?: string | null;

  // CRM
  crm_contact_id?: string | null;
  crm_synced_at?: string | null;

  // Messaging
  channel?: string;
  sent_personalized_message?: boolean;

  // Timestamps
  created_at?: string;
  updated_at?: string;

  // Swarm/AI fields
  /** Lead qualification score (0-100) */
  qualification_score?: number | null;
  /** Lead qualification tier */
  qualification_tier?: "hot" | "warm" | "cold" | "unqualified" | null;
  /** Research status */
  research_status?: "pending" | "in_progress" | "complete" | "failed" | null;
  /** Enriched research data */
  research_data?: Record<string, unknown> | null;
  /** Total conversation turns */
  total_turns?: number | null;
  /** Additional swarm metadata */
  swarm_metadata?: Record<string, unknown> | null;
}

/**
 * LinkedIn profile data from ProxyCurl
 */
export interface LinkedInProfile {
  firstName?: string;
  lastName?: string;
  headline?: string;
  summary?: string;
  company?: string;
  title?: string;
  industry?: string;
  location?: string;
  profileUrl?: string;
  photoUrl?: string;
  connectionCount?: number;
}

/**
 * HubSpot contact for CRM sync
 */
export interface HubSpotContact {
  id?: string;
  email?: string;
  firstname?: string;
  lastname?: string;
  company?: string;
  jobtitle?: string;
  phone?: string;
  industry?: string;
  linkedin?: string;
  [key: string]: string | undefined;
}
