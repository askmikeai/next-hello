import type { LumaAssociations, LumaEvent, LumaGuest } from '../../types';

interface LumaEventsPanelProps {
  luma: LumaAssociations | null;
}

function formatEventDate(dateStr: string | null): string {
  if (!dateStr) return 'Date TBD';
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function GuestProfile({ guest }: { guest: LumaGuest }) {
  const socialLinks = [
    { label: 'IG', url: guest.instagramUrl, handle: guest.instagramHandle },
    { label: 'X', url: guest.twitterUrl, handle: guest.twitterHandle },
    { label: 'LI', url: guest.linkedinUrl, handle: null },
    { label: 'Web', url: guest.websiteUrl, handle: null },
  ].filter((l) => l.url);

  return (
    <div
      style={{
        padding: '0.75rem',
        background: 'var(--bg-tertiary)',
        borderRadius: '6px',
        marginBottom: '1rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
        <div>
          <div style={{ fontWeight: 500 }}>{guest.name}</div>
          {guest.bio && (
            <div
              style={{
                fontSize: '0.8rem',
                color: 'var(--text-muted)',
                marginTop: '0.25rem',
                maxWidth: '300px',
              }}
            >
              {guest.bio.slice(0, 100)}
              {guest.bio.length > 100 ? '...' : ''}
            </div>
          )}
        </div>
        <a
          href={guest.lumaProfileUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            padding: '0.25rem 0.5rem',
            borderRadius: '4px',
            background: 'var(--accent)',
            color: '#fff',
            textDecoration: 'none',
            fontSize: '0.75rem',
          }}
        >
          Luma Profile
        </a>
      </div>
      {socialLinks.length > 0 && (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          {socialLinks.map((link) => (
            <a
              key={link.label}
              href={link.url!}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: '0.125rem 0.375rem',
                borderRadius: '3px',
                background: 'var(--bg-secondary)',
                color: 'var(--text-muted)',
                textDecoration: 'none',
                fontSize: '0.7rem',
              }}
            >
              {link.label}
              {link.handle && `: @${link.handle}`}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function EventRow({ event }: { event: LumaEvent }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0.5rem 0',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div style={{ flex: 1 }}>
        <a
          href={event.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}
        >
          {event.name}
        </a>
        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            marginTop: '0.25rem',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
          }}
        >
          <span>{formatEventDate(event.eventDate)}</span>
          <span>|</span>
          <span>{event.isOnline ? 'Online' : event.location || 'TBD'}</span>
          {event.guestCount > 0 && (
            <>
              <span>|</span>
              <span>{event.guestCount} guests</span>
            </>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '0.25rem' }}>
        {event.isHost && (
          <span
            style={{
              padding: '0.125rem 0.375rem',
              borderRadius: '3px',
              background: 'var(--accent)',
              color: '#fff',
              fontSize: '0.65rem',
            }}
          >
            HOST
          </span>
        )}
        {event.isFeatured && (
          <span
            style={{
              padding: '0.125rem 0.375rem',
              borderRadius: '3px',
              background: 'var(--warning)',
              color: '#000',
              fontSize: '0.65rem',
            }}
          >
            FEATURED
          </span>
        )}
      </div>
    </div>
  );
}

export default function LumaEventsPanel({ luma }: LumaEventsPanelProps) {
  if (!luma || (!luma.guest && luma.events.length === 0)) {
    return (
      <div className="panel" style={{ marginBottom: '1rem' }}>
        <div className="panel-header">
          <span>Luma Events</span>
        </div>
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          No Luma associations found
        </div>
      </div>
    );
  }

  return (
    <div className="panel" style={{ marginBottom: '1rem' }}>
      <div className="panel-header">
        <span>Luma Events</span>
        <span className="text-muted text-sm">{luma.events.length} events</span>
      </div>
      <div style={{ padding: '1rem' }}>
        {luma.guest && <GuestProfile guest={luma.guest} />}

        {luma.events.length > 0 && (
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {luma.events.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
