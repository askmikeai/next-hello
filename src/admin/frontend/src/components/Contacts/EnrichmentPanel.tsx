import type { PDLEnrichment } from '../../types';

interface EnrichmentPanelProps {
  enrichment: PDLEnrichment | null;
}

function InfoRow({ label, value, link }: { label: string; value: string | null; link?: boolean }) {
  if (!value) return null;

  return (
    <div style={{ marginBottom: '0.5rem' }}>
      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{label}: </span>
      {link ? (
        <a href={value} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
          {value}
        </a>
      ) : (
        <span>{value}</span>
      )}
    </div>
  );
}

function SocialLinks({ enrichment }: { enrichment: PDLEnrichment }) {
  const links = [
    { label: 'LinkedIn', url: enrichment.linkedinUrl, username: enrichment.linkedinUsername },
    { label: 'Twitter', url: enrichment.twitterUrl, username: enrichment.twitterUsername },
    { label: 'GitHub', url: enrichment.githubUrl, username: enrichment.githubUsername },
    { label: 'Facebook', url: enrichment.facebookUrl, username: null },
  ].filter((l) => l.url);

  if (links.length === 0) return null;

  return (
    <div style={{ marginTop: '1rem' }}>
      <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem' }}>Social Profiles</h4>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        {links.map((link) => (
          <a
            key={link.label}
            href={link.url!}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '0.25rem 0.5rem',
              borderRadius: '4px',
              background: 'var(--bg-tertiary)',
              color: 'var(--accent)',
              textDecoration: 'none',
              fontSize: '0.75rem',
            }}
          >
            {link.label}
            {link.username && ` (@${link.username})`}
          </a>
        ))}
      </div>
    </div>
  );
}

function SkillsTags({ skills }: { skills: string[] | null }) {
  if (!skills || skills.length === 0) return null;

  return (
    <div style={{ marginTop: '1rem' }}>
      <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem' }}>Skills</h4>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {skills.slice(0, 15).map((skill, i) => (
          <span
            key={i}
            style={{
              padding: '0.25rem 0.5rem',
              borderRadius: '4px',
              background: 'var(--bg-tertiary)',
              fontSize: '0.75rem',
            }}
          >
            {skill}
          </span>
        ))}
        {skills.length > 15 && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            +{skills.length - 15} more
          </span>
        )}
      </div>
    </div>
  );
}

export default function EnrichmentPanel({ enrichment }: EnrichmentPanelProps) {
  if (!enrichment) {
    return (
      <div className="panel" style={{ marginBottom: '1rem' }}>
        <div className="panel-header">
          <span>Enrichment Data</span>
          <span className="text-muted text-sm">PDL</span>
        </div>
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          No enrichment data available
        </div>
      </div>
    );
  }

  return (
    <div className="panel" style={{ marginBottom: '1rem' }}>
      <div className="panel-header">
        <span>Enrichment Data</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {enrichment.likelihood && (
            <span
              style={{
                padding: '0.125rem 0.375rem',
                borderRadius: '4px',
                fontSize: '0.7rem',
                background: enrichment.likelihood >= 7 ? 'var(--success)' : 'var(--warning)',
                color: '#fff',
              }}
            >
              Match: {enrichment.likelihood}/10
            </span>
          )}
          <span className="text-muted text-sm">PDL</span>
        </div>
      </div>
      <div style={{ padding: '1rem' }}>
        {/* Job Info */}
        <div style={{ marginBottom: '1rem' }}>
          <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem' }}>Current Position</h4>
          <InfoRow label="Title" value={enrichment.jobTitle} />
          <InfoRow label="Company" value={enrichment.jobCompanyName} />
          <InfoRow label="Industry" value={enrichment.jobCompanyIndustry} />
          <InfoRow label="Company Size" value={enrichment.jobCompanySize} />
          {enrichment.inferredSalary && (
            <InfoRow label="Est. Salary" value={enrichment.inferredSalary} />
          )}
          {enrichment.inferredYearsExperience && (
            <InfoRow label="Experience" value={`${enrichment.inferredYearsExperience} years`} />
          )}
        </div>

        {/* Location */}
        {(enrichment.locationLocality || enrichment.locationRegion || enrichment.locationCountry) && (
          <div style={{ marginBottom: '1rem' }}>
            <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem' }}>Location</h4>
            <div>
              {[enrichment.locationLocality, enrichment.locationRegion, enrichment.locationCountry]
                .filter(Boolean)
                .join(', ')}
            </div>
          </div>
        )}

        {/* Contact Info from PDL */}
        {(enrichment.workEmail || enrichment.mobilePhone) && (
          <div style={{ marginBottom: '1rem' }}>
            <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem' }}>Additional Contact</h4>
            <InfoRow label="Work Email" value={enrichment.workEmail} />
            <InfoRow label="Mobile" value={enrichment.mobilePhone} />
          </div>
        )}

        <SocialLinks enrichment={enrichment} />
        <SkillsTags skills={enrichment.skills} />

        {enrichment.enrichedAt && (
          <div
            style={{
              marginTop: '1rem',
              paddingTop: '0.75rem',
              borderTop: '1px solid var(--border)',
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
            }}
          >
            Last enriched: {new Date(enrichment.enrichedAt).toLocaleDateString()}
          </div>
        )}
      </div>
    </div>
  );
}
