export function formatTime(isoString: string): string {
  if (!isoString) return '-';
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-US', { hour12: false });
}

export function formatDate(isoString: string): string {
  if (!isoString) return '-';
  const d = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  return d.toLocaleDateString();
}

export function truncate(str: string, len = 80): string {
  if (!str) return '-';
  const cleaned = str.replace(/\n/g, ' ');
  return cleaned.length > len ? cleaned.substring(0, len) + '...' : cleaned;
}
