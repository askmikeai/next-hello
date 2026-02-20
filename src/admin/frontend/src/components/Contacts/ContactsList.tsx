import { useState, useMemo } from 'react';
import type { Contact } from '../../types';

interface ContactsListProps {
  contacts: Contact[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
}

function QualificationDot({ tier }: { tier: string | null }) {
  const colors: Record<string, string> = {
    hot: 'var(--error)',
    warm: 'var(--warning)',
    cold: 'var(--info)',
  };

  return (
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: tier ? colors[tier] || 'var(--text-muted)' : 'var(--bg-tertiary)',
        flexShrink: 0,
      }}
    />
  );
}

function ContactRow({
  contact,
  selected,
  onClick,
}: {
  contact: Contact;
  selected: boolean;
  onClick: () => void;
}) {
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Unknown';

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.75rem 1rem',
        border: 'none',
        borderLeft: selected ? '3px solid var(--accent)' : '3px solid transparent',
        background: selected ? 'var(--bg-tertiary)' : 'transparent',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => {
        if (!selected) {
          e.currentTarget.style.background = 'var(--bg-secondary)';
        }
      }}
      onMouseLeave={(e) => {
        if (!selected) {
          e.currentTarget.style.background = 'transparent';
        }
      }}
    >
      <QualificationDot tier={contact.qualification_tier} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 500,
            color: 'var(--text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </div>
        <div
          style={{
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {contact.company_name || contact.email || contact.phone_number || 'No details'}
        </div>
      </div>
    </button>
  );
}

export default function ContactsList({ contacts, selectedId, onSelect, loading }: ContactsListProps) {
  const [search, setSearch] = useState('');

  const filteredContacts = useMemo(() => {
    if (!search.trim()) return contacts;

    const query = search.toLowerCase();
    return contacts.filter((c) => {
      const searchable = [
        c.first_name,
        c.last_name,
        c.email,
        c.phone_number,
        c.company_name,
        c.job_title,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return searchable.includes(query);
    });
  }, [contacts, search]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        borderRight: '1px solid var(--border)',
      }}
    >
      {/* Search */}
      <div style={{ padding: '0.75rem', borderBottom: '1px solid var(--border)' }}>
        <input
          type="text"
          placeholder="Search contacts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%',
            padding: '0.5rem 0.75rem',
            borderRadius: '6px',
            border: '1px solid var(--border)',
            background: 'var(--bg-secondary)',
            color: 'var(--text)',
            fontSize: '0.875rem',
          }}
        />
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            Loading contacts...
          </div>
        ) : filteredContacts.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            {search ? 'No matches found' : 'No contacts'}
          </div>
        ) : (
          filteredContacts.map((contact) => (
            <ContactRow
              key={contact.id}
              contact={contact}
              selected={contact.id === selectedId}
              onClick={() => onSelect(contact.id)}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: '0.5rem 1rem',
          borderTop: '1px solid var(--border)',
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
          textAlign: 'center',
        }}
      >
        {filteredContacts.length} of {contacts.length} contacts
      </div>
    </div>
  );
}
