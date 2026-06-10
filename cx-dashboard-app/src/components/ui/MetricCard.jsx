export default function MetricCard({
  title, value, subtitle, trend, trendDirection, color, icon, onClick, loading,
}) {
  if (loading) {
    return (
      <div className="card metric-card">
        <div className="skeleton" style={{ height: 12, width: '60%' }} />
        <div className="skeleton" style={{ height: 30, width: '45%' }} />
        <div className="skeleton" style={{ height: 12, width: '70%' }} />
      </div>
    );
  }
  return (
    <div
      className={`card metric-card${onClick ? ' clickable' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="metric-title">
        {icon && <span>{icon}</span>}
        {title}
      </div>
      <div className="metric-value" style={color ? { color } : undefined}>{value}</div>
      {(subtitle || trend) && (
        <div className="metric-sub">
          {trend != null && (
            <span className={`trend ${trendDirection === 'down' ? 'down' : 'up'}`}>
              {trendDirection === 'down' ? '↓' : '↑'} {trend}
            </span>
          )}
          {subtitle && <span>{subtitle}</span>}
        </div>
      )}
    </div>
  );
}
