import type { SwarmState } from '../../types';
import { formatDate } from '../../utils/format';

interface ConversationsListProps {
  states: SwarmState[];
}

export default function ConversationsList({ states }: ConversationsListProps) {
  return (
    <div className="panel">
      <div className="panel-header">Active Conversations</div>
      <div className="panel-body">
        {states.length === 0 ? (
          <div className="conversation-item text-muted">No active conversations</div>
        ) : (
          states.slice(0, 10).map((s) => (
            <div key={s.correlationId} className="conversation-item">
              <div className="conversation-info">
                <div className="conversation-phone">{s.phoneNumber}</div>
                <div className="conversation-meta">
                  <span className="badge badge-status">orchestrator</span>
                  {' '}{s.conversationTurns} turns
                  {s.taskQueueLength > 0 && (
                    <span className="handoff-indicator">
                      ({s.taskQueueLength} pending)
                    </span>
                  )}
                </div>
              </div>
              <div className="text-muted text-sm">{formatDate(s.lastActivityAt)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
