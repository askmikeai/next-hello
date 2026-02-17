import type { AgentStats } from '../../types';
import clsx from 'clsx';

interface PerformanceTableProps {
  stats: AgentStats[];
}

const COMPONENT_NAMES: Record<string, string> = {
  orchestrator: 'Orchestrator',
  conversation: 'Orchestrator',
  video: 'Video Worker',
  research: 'Research Worker',
  crm: 'CRM Worker',
  voice: 'Voice Worker',
};

export default function PerformanceTable({ stats }: PerformanceTableProps) {
  return (
    <div className="panel">
      <div className="panel-header">Tool & Worker Performance (24h)</div>
      <div className="panel-body">
        <table>
          <thead>
            <tr>
              <th>Component</th>
              <th>Calls</th>
              <th>Success</th>
              <th>Avg Time</th>
            </tr>
          </thead>
          <tbody>
            {stats.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-muted">
                  No data
                </td>
              </tr>
            ) : (
              stats.map((s) => (
                <tr key={s.agentType}>
                  <td>{COMPONENT_NAMES[s.agentType] || s.agentType}</td>
                  <td>{s.executions}</td>
                  <td
                    className={clsx({
                      'health-ok': s.successRate >= 95,
                      'health-fail': s.successRate < 80,
                    })}
                  >
                    {s.successRate.toFixed(0)}%
                  </td>
                  <td className="text-muted">{s.avgDurationMs}ms</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
