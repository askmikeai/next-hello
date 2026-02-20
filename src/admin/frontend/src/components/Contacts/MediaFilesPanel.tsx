import type { MediaFile } from '../../types';

interface MediaFilesPanelProps {
  media: MediaFile[];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function MediaTypeIcon({ type }: { type: string }) {
  const icons: Record<string, string> = {
    voice: '🎙️',
    video: '🎬',
    image: '📷',
    document: '📄',
    avatar: '👤',
  };

  return <span style={{ fontSize: '1.25rem' }}>{icons[type] || '📁'}</span>;
}

function MediaRow({ file }: { file: MediaFile }) {
  const filename = file.storageKey.split('/').pop() || 'file';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.75rem',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <MediaTypeIcon type={file.mediaType} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'monospace',
            fontSize: '0.875rem',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {filename}
        </div>
        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            fontSize: '0.7rem',
            color: 'var(--text-muted)',
            marginTop: '0.125rem',
          }}
        >
          <span>{file.mediaType}</span>
          <span>|</span>
          <span>{formatSize(file.sizeBytes)}</span>
          <span>|</span>
          <span>{file.source}</span>
          <span>|</span>
          <span>{formatDate(file.createdAt)}</span>
        </div>
      </div>

      <a
        href={file.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          padding: '0.375rem 0.75rem',
          borderRadius: '4px',
          background: 'var(--bg-tertiary)',
          color: 'var(--accent)',
          textDecoration: 'none',
          fontSize: '0.75rem',
        }}
      >
        View
      </a>
    </div>
  );
}

export default function MediaFilesPanel({ media }: MediaFilesPanelProps) {
  // Group by media type
  const byType = media.reduce(
    (acc, file) => {
      const type = file.mediaType;
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const typesSummary = Object.entries(byType)
    .map(([type, count]) => `${count} ${type}`)
    .join(', ');

  return (
    <div className="panel" style={{ marginBottom: '1rem' }}>
      <div className="panel-header">
        <span>Media Files</span>
        <span className="text-muted text-sm">{typesSummary || 'None'}</span>
      </div>
      <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
        {media.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            No media files
          </div>
        ) : (
          media.map((file) => <MediaRow key={file.id} file={file} />)
        )}
      </div>
    </div>
  );
}
