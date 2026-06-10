export default function EmptyState({ icon = '📭', title = 'Nothing here yet', message, error }) {
  return (
    <div className={`empty-state${error ? ' error-state' : ''}`}>
      <div className="icon">{icon}</div>
      <div style={{ fontWeight: 600 }}>{title}</div>
      {message && <div style={{ fontSize: 12 }}>{message}</div>}
    </div>
  );
}
