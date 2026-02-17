import { useContacts } from '../../hooks/useContacts';
import { QualificationBadge, StatusBadge } from '../Badge';
import { sendVoice, sendVideo } from '../../api/client';
import { formatDate } from '../../utils/format';

interface ContactsTableProps {
  onPhoneClick?: (phone: string) => void;
}

export default function ContactsTable({ onPhoneClick }: ContactsTableProps) {
  const { contacts, refetch } = useContacts(15);

  const handleSendVoice = async (contactId: string) => {
    if (!confirm('Send voice message to this contact?')) return;
    try {
      const result = await sendVoice(contactId);
      alert(result.success ? 'Voice message queued!' : `Error: ${result.error}`);
      refetch();
    } catch (e) {
      alert(`Failed to send voice: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  };

  const handleSendVideo = async (contactId: string) => {
    if (!confirm('Generate video for this contact?')) return;
    try {
      const result = await sendVideo(contactId);
      alert(result.success ? 'Video generation queued!' : `Error: ${result.error}`);
      refetch();
    } catch (e) {
      alert(`Failed to send video: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  };

  return (
    <>
      <div className="panel-header">Recent Contacts</div>
      <div className="panel-body">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Status</th>
              <th>Qual</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {contacts.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-muted">
                  No contacts
                </td>
              </tr>
            ) : (
              contacts.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.first_name || ''} {c.last_name || ''}
                  </td>
                  <td>
                    {c.phone_number ? (
                      <span
                        className="phone-link"
                        onClick={() => onPhoneClick?.(c.phone_number!)}
                      >
                        {c.phone_number}
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td>
                    <StatusBadge status={c.status} />
                  </td>
                  <td>
                    <QualificationBadge tier={c.qualification_tier} />
                  </td>
                  <td className="text-muted text-sm">
                    {formatDate(c.updated_at || c.created_at)}
                  </td>
                  <td>
                    <button
                      className="action-btn"
                      onClick={() => handleSendVoice(c.id)}
                      title="Send Voice"
                    >
                      Voice
                    </button>
                    <button
                      className="action-btn"
                      onClick={() => handleSendVideo(c.id)}
                      title="Send Video"
                    >
                      Video
                    </button>
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
