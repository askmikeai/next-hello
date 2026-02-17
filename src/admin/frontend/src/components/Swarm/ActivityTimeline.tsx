import { useState } from 'react';
import { useActivities } from '../../hooks/useActivities';
import { ActivityStatusBadge } from '../Badge';
import { formatTime } from '../../utils/format';

const COMPONENT_NAMES: Record<string, string> = {
  orchestrator: 'Orchestrator',
  conversation: 'Orchestrator',
  video: 'Video Worker',
  research: 'Research Worker',
  crm: 'CRM Worker',
  voice: 'Voice Worker',
  contact_lookup: 'Lookup',
  contact_update: 'Update',
  get_calendly_link: 'Calendly',
  send_video: 'Send Video',
  generate_video: 'Gen Video',
  research_contact: 'Research',
  delete_contact: 'Delete',
  video_worker: 'Video Worker',
  research_worker: 'Research Worker',
  crm_worker: 'CRM Worker',
  voice_worker: 'Voice Worker',
};

interface ActivityTimelineProps {
  initialFilter?: string;
}

export default function ActivityTimeline({ initialFilter }: ActivityTimelineProps) {
  const [filter, setFilter] = useState(initialFilter || '');
  const { activities } = useActivities(30, filter || undefined, 2000);

  return (
    <div className="panel">
      <div className="panel-header">
        <span>Activity Timeline</span>
        <select
          className="filter-select"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="">All</option>
          <option value="orchestrator">Orchestrator</option>
          <optgroup label="Tools">
            <option value="contact_lookup">Contact Lookup</option>
            <option value="contact_update">Contact Update</option>
            <option value="get_calendly_link">Get Calendly Link</option>
            <option value="send_video">Send Video</option>
            <option value="generate_video">Generate Video</option>
            <option value="research_contact">Research Contact</option>
            <option value="delete_contact">Delete Contact</option>
          </optgroup>
          <optgroup label="Workers">
            <option value="video_worker">Video Worker</option>
            <option value="research_worker">Research Worker</option>
            <option value="crm_worker">CRM Worker</option>
            <option value="voice_worker">Voice Worker</option>
          </optgroup>
        </select>
      </div>
      <div className="panel-body">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Component</th>
              <th>Action</th>
              <th>Duration</th>
              <th>Status</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {activities.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-muted">
                  No activity
                </td>
              </tr>
            ) : (
              activities.map((a) => (
                <tr key={a.id}>
                  <td className="text-muted">{formatTime(a.startedAt)}</td>
                  <td>
                    <span className="badge badge-status">
                      {COMPONENT_NAMES[a.agentType] || a.agentType}
                    </span>
                  </td>
                  <td>
                    {a.action}
                    {a.toolName && (
                      <span className="text-muted"> ({a.toolName})</span>
                    )}
                  </td>
                  <td className="text-muted">{a.durationMs ? `${a.durationMs}ms` : '-'}</td>
                  <td>
                    <ActivityStatusBadge status={a.status} />
                  </td>
                  <td className="text-muted">
                    {a.correlationId ? a.correlationId.slice(0, 8) : '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
