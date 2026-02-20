import type {
  ContactStats,
  Contact,
  QueueStats,
  HealthStatus,
  ConversationMessage,
  AgentActivity,
  SwarmState,
  AgentStats,
  GreetingVideoInfo,
  PDLEnrichment,
  LumaAssociations,
  MediaFile,
} from '../types';

const BASE_URL = '/admin/api';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

export async function getStats(): Promise<ContactStats> {
  return fetchJson<ContactStats>(`${BASE_URL}/stats`);
}

export async function getContacts(limit = 15): Promise<Contact[]> {
  return fetchJson<Contact[]>(`${BASE_URL}/contacts?limit=${limit}`);
}

export async function getQueues(): Promise<QueueStats[]> {
  return fetchJson<QueueStats[]>(`${BASE_URL}/queues`);
}

export async function getHealth(): Promise<HealthStatus> {
  return fetchJson<HealthStatus>(`${BASE_URL}/health`);
}

export async function getMessages(limit = 50, phone?: string): Promise<ConversationMessage[]> {
  let url = `${BASE_URL}/messages?limit=${limit}`;
  if (phone) {
    url += `&phone=${encodeURIComponent(phone)}`;
  }
  return fetchJson<ConversationMessage[]>(url);
}

export async function getActivities(limit = 20, agentType?: string): Promise<AgentActivity[]> {
  let url = `${BASE_URL}/activities?limit=${limit}`;
  if (agentType) {
    url += `&agentType=${encodeURIComponent(agentType)}`;
  }
  return fetchJson<AgentActivity[]>(url);
}

export async function getSwarmStates(): Promise<SwarmState[]> {
  return fetchJson<SwarmState[]>(`${BASE_URL}/swarm/states`);
}

export async function getAgentStats(): Promise<AgentStats[]> {
  return fetchJson<AgentStats[]>(`${BASE_URL}/swarm/agents`);
}

export async function sendVoice(contactId: string): Promise<{ success: boolean; jobId?: string; error?: string }> {
  return postJson(`${BASE_URL}/send-voice/${contactId}`);
}

export async function sendVideo(contactId: string): Promise<{ success: boolean; jobId?: string; error?: string }> {
  return postJson(`${BASE_URL}/send-video/${contactId}`);
}

export async function getGreetingVideo(): Promise<GreetingVideoInfo> {
  return fetchJson<GreetingVideoInfo>(`${BASE_URL}/settings/greeting-video`);
}

export async function uploadGreetingVideo(file: File): Promise<{ success: boolean; error?: string }> {
  const formData = new FormData();
  formData.append('video', file);

  const res = await fetch(`${BASE_URL}/settings/greeting-video`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}: ${res.statusText}`);
  }

  return res.json();
}

export async function deleteGreetingVideo(): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`${BASE_URL}/settings/greeting-video`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}: ${res.statusText}`);
  }

  return res.json();
}

// Contact Detail APIs

export async function getContactById(contactId: string): Promise<Contact | null> {
  return fetchJson<Contact | null>(`${BASE_URL}/contacts/${contactId}`);
}

export async function getContactEnrichment(contactId: string): Promise<PDLEnrichment | null> {
  return fetchJson<PDLEnrichment | null>(`${BASE_URL}/contacts/${contactId}/enrichment`);
}

export async function getContactLumaAssociations(contactId: string): Promise<LumaAssociations> {
  return fetchJson<LumaAssociations>(`${BASE_URL}/contacts/${contactId}/luma`);
}

export async function getContactMedia(contactId: string): Promise<MediaFile[]> {
  return fetchJson<MediaFile[]>(`${BASE_URL}/contacts/${contactId}/media`);
}

export async function getContactActivities(contactId: string): Promise<AgentActivity[]> {
  return fetchJson<AgentActivity[]>(`${BASE_URL}/contacts/${contactId}/activities`);
}

export async function getContactMessages(contactId: string, limit = 50): Promise<ConversationMessage[]> {
  return fetchJson<ConversationMessage[]>(`${BASE_URL}/contacts/${contactId}/messages?limit=${limit}`);
}
