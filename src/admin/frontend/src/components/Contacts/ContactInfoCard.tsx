import type { Contact } from '../../types';

interface ContactInfoCardProps {
  contact: Contact;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function QualificationBadge({ tier }: { tier: string | null }) {
  if (!tier) return null;

  const colors: Record<string, { bg: string; text: string }> = {
    hot: { bg: 'var(--error)', text: '#fff' },
    warm: { bg: 'var(--warning)', text: '#000' },
    cold: { bg: 'var(--info)', text: '#fff' },
  };

  const style = colors[tier] || { bg: 'var(--bg-tertiary)', text: 'var(--text)' };

  return (
    <span
      style={{
        padding: '0.25rem 0.5rem',
        borderRadius: '4px',
        fontSize: '0.75rem',
        fontWeight: 500,
        background: style.bg,
        color: style.text,
        textTransform: 'uppercase',
      }}
    >
      {tier}
    </span>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;

  return (
    <span
      style={{
        padding: '0.25rem 0.5rem',
        borderRadius: '4px',
        fontSize: '0.75rem',
        background: 'var(--bg-tertiary)',
        color: 'var(--text-muted)',
      }}
    >
      {status}
    </span>
  );
}

export default function ContactInfoCard({ contact }: ContactInfoCardProps) {
  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Unknown';

  return (
    <div className="panel" style={{ marginBottom: '1rem' }}>
      <div className="panel-header">
        <span>Contact Info</span>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <QualificationBadge tier={contact.qualification_tier} />
          <StatusBadge status={contact.status} />
        </div>
      </div>
      <div style={{ padding: '1rem' }}>
        <h2 style={{ margin: '0 0 1rem 0', fontSize: '1.5rem' }}>{fullName}</h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div>
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                Phone
              </div>
              <div style={{ fontFamily: 'monospace' }}>
                {contact.phone_number || 'N/A'}
              </div>
            </div>

            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                Email
              </div>
              <div>
                {contact.email ? (
                  <a href={`mailto:${contact.email}`} style={{ color: 'var(--accent)' }}>
                    {contact.email}
                  </a>
                ) : (
                  'N/A'
                )}
              </div>
            </div>
          </div>

          <div>
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                Company
              </div>
              <div>{contact.company_name || 'N/A'}</div>
            </div>

            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                Job Title
              </div>
              <div>{contact.job_title || 'N/A'}</div>
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: '1rem',
            paddingTop: '1rem',
            borderTop: '1px solid var(--border)',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            display: 'flex',
            gap: '1rem',
          }}
        >
          <span>Created: {formatDate(contact.created_at)}</span>
          {contact.updated_at && <span>Updated: {formatDate(contact.updated_at)}</span>}
        </div>
      </div>
    </div>
  );
}
