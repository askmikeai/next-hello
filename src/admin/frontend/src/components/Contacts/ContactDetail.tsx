import ContactInfoCard from './ContactInfoCard';
import ConversationHistory from './ConversationHistory';
import EnrichmentPanel from './EnrichmentPanel';
import LumaEventsPanel from './LumaEventsPanel';
import MediaFilesPanel from './MediaFilesPanel';
import type { Contact, PDLEnrichment, LumaAssociations, MediaFile, ConversationMessage } from '../../types';

interface ContactDetailProps {
  contact: Contact | null;
  enrichment: PDLEnrichment | null;
  luma: LumaAssociations | null;
  media: MediaFile[];
  messages: ConversationMessage[];
  loading: boolean;
  error: string | null;
}

export default function ContactDetail({
  contact,
  enrichment,
  luma,
  media,
  messages,
  loading,
  error,
}: ContactDetailProps) {
  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--text-muted)',
        }}
      >
        Loading contact details...
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--error)',
        }}
      >
        Error: {error}
      </div>
    );
  }

  if (!contact) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--text-muted)',
        }}
      >
        Select a contact to view details
      </div>
    );
  }

  return (
    <div style={{ padding: '1rem', overflowY: 'auto', height: '100%' }}>
      <ContactInfoCard contact={contact} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div>
          <ConversationHistory messages={messages} />
          <MediaFilesPanel media={media} />
        </div>
        <div>
          <EnrichmentPanel enrichment={enrichment} />
          <LumaEventsPanel luma={luma} />
        </div>
      </div>
    </div>
  );
}
