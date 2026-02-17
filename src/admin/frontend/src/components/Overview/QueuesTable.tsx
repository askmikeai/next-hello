import { useQueues } from '../../hooks/useQueues';
import clsx from 'clsx';

export default function QueuesTable() {
  const { queues } = useQueues();

  return (
    <div className="panel">
      <div className="panel-header">Queue Status</div>
      <div className="panel-body">
        <table>
          <thead>
            <tr>
              <th>Queue</th>
              <th>Wait</th>
              <th>Active</th>
              <th>Done</th>
              <th>Fail</th>
            </tr>
          </thead>
          <tbody>
            {queues.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-muted">
                  No data
                </td>
              </tr>
            ) : (
              queues.map((q) => (
                <tr key={q.name}>
                  <td>{q.name}</td>
                  <td>{q.waiting}</td>
                  <td>{q.active}</td>
                  <td className="text-muted">{q.completed}</td>
                  <td className={clsx({ 'health-fail': q.failed > 0, 'text-muted': q.failed === 0 })}>
                    {q.failed}
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
