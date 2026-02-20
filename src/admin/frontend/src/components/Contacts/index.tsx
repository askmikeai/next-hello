import { useState, useEffect } from 'react';
import ContactsList from './ContactsList';
import ContactDetail from './ContactDetail';
import { useContactDetail } from '../../hooks/useContactDetail';
import * as api from '../../api/client';
import type { Contact } from '../../types';

export default function Contacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Fetch contacts list
  useEffect(() => {
    async function fetchContacts() {
      setContactsLoading(true);
      try {
        const data = await api.getContacts(100);
        setContacts(data);
      } catch (err) {
        console.error('Failed to fetch contacts:', err);
      } finally {
        setContactsLoading(false);
      }
    }
    fetchContacts();
  }, []);

  // Fetch contact detail when selection changes
  const { contact, enrichment, luma, media, messages, loading, error } = useContactDetail(selectedId);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '320px 1fr',
        height: 'calc(100vh - 180px)',
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      <ContactsList
        contacts={contacts}
        selectedId={selectedId}
        onSelect={setSelectedId}
        loading={contactsLoading}
      />
      <ContactDetail
        contact={contact}
        enrichment={enrichment}
        luma={luma}
        media={media}
        messages={messages}
        loading={loading}
        error={error}
      />
    </div>
  );
}
