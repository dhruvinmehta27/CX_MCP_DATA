import Icon from './Icon';

export default function EmptyState({ icon = 'inbox', title = 'Nothing here yet', message, error }) {
  return (
    <div className={`empty-state${error ? ' error-state' : ''}`}>
      <div className="empty-icon">
        <Icon name={error ? 'alert-triangle' : icon} size={26} />
      </div>
      <div className="empty-title">{title}</div>
      {message && <div className="empty-message">{message}</div>}
    </div>
  );
}
