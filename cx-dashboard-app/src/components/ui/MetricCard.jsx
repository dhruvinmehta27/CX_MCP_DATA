import Icon from './Icon';

/**
 * KPI card. `icon` is an Icon name (e.g. 'file-text'); `accent` tints the
 * icon tile and value ('primary' default, or 'danger'/'warning'/'success').
 */
const ACCENTS = {
  primary: { bg: 'var(--primary-tint)', fg: 'var(--primary)' },
  danger: { bg: 'var(--danger-bg)', fg: 'var(--danger)' },
  warning: { bg: 'var(--warning-bg)', fg: 'var(--warning)' },
  success: { bg: 'var(--success-bg)', fg: 'var(--success)' },
};

export default function MetricCard({
  title, value, subtitle, trend, trendDirection, accent = 'primary',
  colorValue = false, icon, onClick, loading, exact = true,
}) {
  if (loading) {
    return (
      <div className="card metric-card">
        <div className="metric-head">
          <div className="skeleton" style={{ height: 12, width: '55%' }} />
          <div className="skeleton" style={{ height: 36, width: 36, borderRadius: 9 }} />
        </div>
        <div className="skeleton" style={{ height: 28, width: '45%' }} />
        <div className="skeleton" style={{ height: 12, width: '65%' }} />
      </div>
    );
  }
  const a = ACCENTS[accent] || ACCENTS.primary;

  // Fail-closed guardrail: when a figure can't be guaranteed exact we never show
  // a (possibly wrong) number — we show a dash and ask the user to narrow range.
  if (!exact) {
    return (
      <div className="card metric-card metric-inexact" title="This date range exceeds the live record limit, so an exact figure can't be guaranteed. Narrow the date range for an exact value.">
        <div className="metric-head">
          <div className="metric-title">{title}</div>
          {icon && (
            <div className="metric-icon" style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}>
              <Icon name="alert-triangle" size={18} />
            </div>
          )}
        </div>
        <div className="metric-value metric-value-muted">—</div>
        <div className="metric-sub">Narrow the date range for an exact figure</div>
      </div>
    );
  }

  return (
    <div
      className={`card metric-card${onClick ? ' clickable' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="metric-head">
        <div className="metric-title">{title}</div>
        {icon && (
          <div className="metric-icon" style={{ background: a.bg, color: a.fg }}>
            <Icon name={icon} size={18} />
          </div>
        )}
      </div>
      <div className="metric-value" style={colorValue ? { color: a.fg } : undefined}>
        {value}
      </div>
      {(subtitle || trend != null) && (
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
