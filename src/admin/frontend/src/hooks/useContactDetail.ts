import { useState, useEffect, useCallback } from 'react';
import type {
  Contact,
  PDLEnrichment,
  LumaAssociations,
  MediaFile,
  AgentActivity,
  ConversationMessage,
} from '../types';
import * as api from '../api/client';

interface ContactDetailData {
  contact: Contact | null;
  enrichment: PDLEnrichment | null;
  luma: LumaAssociations | null;
  media: MediaFile[];
  activities: AgentActivity[];
  messages: ConversationMessage[];
  loading: boolean;
  error: string | null;
}

export function useContactDetail(contactId: string | null): ContactDetailData & { refresh: () => void } {
  const [contact, setContact] = useState<Contact | null>(null);
  const [enrichment, setEnrichment] = useState<PDLEnrichment | null>(null);
  const [luma, setLuma] = useState<LumaAssociations | null>(null);
  const [media, setMedia] = useState<MediaFile[]>([]);
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!contactId) {
      setContact(null);
      setEnrichment(null);
      setLuma(null);
      setMedia([]);
      setActivities([]);
      setMessages([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Fetch all data in parallel
      const [
        contactData,
        enrichmentData,
        lumaData,
        mediaData,
        activitiesData,
        messagesData,
      ] = await Promise.all([
        api.getContactById(contactId),
        api.getContactEnrichment(contactId),
        api.getContactLumaAssociations(contactId),
        api.getContactMedia(contactId),
        api.getContactActivities(contactId),
        api.getContactMessages(contactId),
      ]);

      setContact(contactData);
      setEnrichment(enrichmentData);
      setLuma(lumaData);
      setMedia(mediaData);
      setActivities(activitiesData);
      setMessages(messagesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch contact data');
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    contact,
    enrichment,
    luma,
    media,
    activities,
    messages,
    loading,
    error,
    refresh: fetchData,
  };
}
