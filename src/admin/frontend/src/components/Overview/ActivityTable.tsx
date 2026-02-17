import { useActivities } from '../../hooks/useActivities';
import { ActivityStatusBadge } from '../Badge';
import { formatTime } from '../../utils/format';

export default function ActivityTable() {
  const { activities } = useActivities(20);

  return (
    <>
      <div className="panel-header">Agent Activity (last 20)</div>
      <div className="panel-body">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Agent</th>
              <th>Action</th>
              <th>Duration</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {activities.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-muted">
                  No activity
                </td>
              </tr>
            ) : (
              activities.map((a) => (
                <tr key={a.id}>
                  <td className="text-muted">{formatTime(a.startedAt)}</td>
                  <td>{a.agentType}</td>
                  <td>{a.action}</td>
                  <td className="text-muted">{a.durationMs ? `${a.durationMs}ms` : '-'}</td>
                  <td>
                    <ActivityStatusBadge status={a.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
