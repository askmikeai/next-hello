import type { ConversationMessage } from '../../types';

interface ConversationHistoryProps {
  messages: ConversationMessage[];
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function MessageBubble({ message }: { message: ConversationMessage }) {
  const isOutbound = message.direction === 'outbound';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isOutbound ? 'flex-end' : 'flex-start',
        marginBottom: '0.75rem',
      }}
    >
      <div
        style={{
          maxWidth: '80%',
          padding: '0.75rem 1rem',
          borderRadius: isOutbound ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
          background: isOutbound ? 'var(--accent)' : 'var(--bg-tertiary)',
          color: isOutbound ? '#fff' : 'var(--text)',
        }}
      >
        <div style={{ wordBreak: 'break-word' }}>
          {message.content || `[${message.messageType}]`}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          marginTop: '0.25rem',
          fontSize: '0.7rem',
          color: 'var(--text-muted)',
        }}
      >
        <span>{formatTime(message.createdAt)}</span>
        <span>{message.channel}</span>
        {message.agentId && <span>via {message.agentId}</span>}
      </div>
    </div>
  );
}

export default function ConversationHistory({ messages }: ConversationHistoryProps) {
  // Reverse to show oldest first
  const sortedMessages = [...messages].reverse();

  return (
    <div className="panel" style={{ marginBottom: '1rem' }}>
      <div className="panel-header">
        <span>Conversation History</span>
        <span className="text-muted text-sm">{messages.length} messages</span>
      </div>
      <div
        style={{
          padding: '1rem',
          maxHeight: '400px',
          overflowY: 'auto',
        }}
      >
        {sortedMessages.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
            No messages yet
          </div>
        ) : (
          sortedMessages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
        )}
      </div>
    </div>
  );
}
