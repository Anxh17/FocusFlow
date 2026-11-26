import { Inbox } from 'lucide-react';

export default function EmptyState({ icon: Icon = Inbox, title, message, action }) {
  return (
    <div className="empty-state">
      <Icon />
      <h3>{title || 'Nothing here yet'}</h3>
      <p>{message || 'Get started by adding some content.'}</p>
      {action || null}
    </div>
  );
}
