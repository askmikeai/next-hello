import { useState } from 'react';
import { useMessages } from '../../hooks/useMessages';
import { DirectionBadge } from '../Badge';
import { formatDate, truncate } from '../../utils/format';

export default function MessagesTable() {
  const [phoneFilter, setPhoneFilter] = useState<string | undefined>();
  const { messages } = useMessages(50, phoneFilter);

  const handlePhoneClick = (phone: string) => {
    setPhoneFilter(phone);
  };

  const clearFilter = () => {
    setPhoneFilter(undefined);
  };

  return (
    <>
      <div className="panel-header">
        <span>
          Messages{' '}
          <span className="text-muted text-sm">
            {phoneFilter ? `- ${phoneFilter}` : '(last 30)'}
          </span>
        </span>
        {phoneFilter && (
          <button className="action-btn" onClick={clearFilter}>
            Show All
          </button>
        )}
      </div>
      <div className="panel-body">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Phone</th>
              <th>Dir</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {messages.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-muted">
                  No messages
                </td>
              </tr>
            ) : (
              messages.map((m) => (
                <tr key={m.id}>
                  <td className="text-muted text-sm">{formatDate(m.createdAt)}</td>
                  <td>
                    <span className="phone-link" onClick={() => handlePhoneClick(m.phoneNumber)}>
                      {m.phoneNumber}
                    </span>
                  </td>
                  <td>
                    <DirectionBadge direction={m.direction} />
                  </td>
                  <td className="msg-content" title={m.content || ''}>
                    {truncate(m.content || '')}
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
