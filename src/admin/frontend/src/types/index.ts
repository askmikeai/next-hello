export interface ContactStats {
  total: number;
  byStatus: Record<string, number>;
  byQualification: Record<string, number>;
}

export interface Contact {
  id: string;
  phone_number: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company_name: string | null;
  job_title: string | null;
  status: string | null;
  qualification_tier: 'hot' | 'warm' | 'cold' | null;
  created_at: string;
  updated_at: string | null;
}

export interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export interface HealthStatus {
  redis: {
    connected: boolean;
    latencyMs: number;
    error?: string;
  };
  postgres: {
    healthy: boolean;
    latencyMs?: number;
    error?: string;
  };
}

export interface ConversationMessage {
  id: string;
  contactId: string;
  phoneNumber: string;
  correlationId: string;
  direction: 'inbound' | 'outbound';
  channel: string;
  messageType: string;
  content?: string;
  agentId?: string;
  createdAt: string;
  contactName?: string;
}

export interface AgentActivity {
  id: string;
  correlationId: string;
  agentType: string;
  action: string;
  status: 'started' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  toolName?: string;
  metadata?: Record<string, unknown>;
}

export interface SwarmState {
  correlationId: string;
  phoneNumber: string;
  currentAgent: string | null;
  conversationTurns: number;
  lastActivityAt: string;
  taskQueueLength: number;
  channel: string;
}

export interface AgentStats {
  agentType: string;
  executions: number;
  avgDurationMs: number;
  successRate: number;
}

export type Tab = 'overview' | 'swarm' | 'contacts' | 'settings';

export interface GreetingVideoInfo {
  exists: boolean;
  storageKey?: string;
  filename?: string;
  sizeBytes?: number;
  uploadedAt?: string;
  url?: string;
}

export interface PDLEnrichment {
  id: string;
  contactId: string;
  pdlId: string | null;
  likelihood: number | null;
  matchedOn: string[] | null;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  workEmail: string | null;
  personalEmails: string[] | null;
  mobilePhone: string | null;
  jobTitle: string | null;
  jobTitleRole: string | null;
  jobTitleLevels: string[] | null;
  jobStartDate: string | null;
  inferredSalary: string | null;
  inferredYearsExperience: number | null;
  jobCompanyName: string | null;
  jobCompanyWebsite: string | null;
  jobCompanyLinkedinUrl: string | null;
  jobCompanySize: string | null;
  jobCompanyIndustry: string | null;
  jobCompanyType: string | null;
  jobCompanyEmployeeCount: number | null;
  jobCompanyInferredRevenue: string | null;
  locationName: string | null;
  locationLocality: string | null;
  locationRegion: string | null;
  locationCountry: string | null;
  linkedinUrl: string | null;
  linkedinId: string | null;
  linkedinUsername: string | null;
  linkedinConnections: number | null;
  twitterUrl: string | null;
  twitterUsername: string | null;
  githubUrl: string | null;
  githubUsername: string | null;
  facebookUrl: string | null;
  experience: unknown[] | null;
  education: unknown[] | null;
  skills: string[] | null;
  interests: string[] | null;
  enrichedAt: string | null;
}

export interface LumaGuest {
  id: string;
  lumaUserId: string | null;
  lumaProfileUrl: string;
  name: string;
  bio: string | null;
  instagramUrl: string | null;
  twitterUrl: string | null;
  linkedinUrl: string | null;
  websiteUrl: string | null;
  instagramHandle: string | null;
  twitterHandle: string | null;
}

export interface LumaEvent {
  id: string;
  slug: string;
  name: string;
  url: string;
  eventDate: string | null;
  location: string | null;
  isOnline: boolean;
  hostName: string | null;
  guestCount: number;
  isFeatured: boolean;
  isHost: boolean;
}

export interface LumaAssociations {
  guest: LumaGuest | null;
  events: LumaEvent[];
}

export interface MediaFile {
  id: string;
  storageKey: string;
  mediaType: string;
  mimeType: string;
  sizeBytes: number;
  source: string;
  createdAt: string;
  url: string;
}
