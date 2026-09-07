import { useState, useEffect } from 'react';
import useAuth from '../../auth/useAuth';
import { clearCache } from '../../api/analytics';
import Icon from '../ui/Icon';

export default function Header({ title, subtitle }) {
  const { user, logout } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [systemLabel, setSystemLabel] = useState(null);

  useEffect(() => {
    const apiRoot = (window.__APP_CONFIG__?.DASHBOARD_API_URL || '').replace(/\/+$/, '');
    fetch(`${apiRoot}/api/info`)
      .then((r) => r.json())
      .then((d) => setSystemLabel(d.system))
      .catch(() => {});
  }, []);

  const initials = (user?.name || user?.username || '?')
    .split(/[\s.@]+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await clearCache();
      window.location.reload();
    } catch (err) {
      console.error('Cache clear failed', err);
      setRefreshing(false);
    }
  };

  return (
    <header className="header">
      <div className="header-title">
        {title}
        {subtitle && <span>{subtitle}</span>}
      </div>
      <div className="header-actions">
        {systemLabel && (
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.07em',
            padding: '3px 8px', borderRadius: 6,
            background: systemLabel === 'PROD' ? 'rgba(54,164,29,0.12)' : 'rgba(231,101,0,0.12)',
            color: systemLabel === 'PROD' ? '#1e7a0f' : '#b84f00',
          }}>
            {systemLabel}
          </span>
        )}
        <button
          className="btn btn-ghost"
          onClick={onRefresh}
          disabled={refreshing}
          title="Clear cache and reload data"
        >
          <Icon name="refresh" size={15} className={refreshing ? 'spinning' : undefined} />
          {refreshing ? 'Refreshing…' : 'Refresh data'}
        </button>
        <div className="header-divider" />
        <div className="user-chip">
          <div className="user-avatar">{initials}</div>
          {user?.name || user?.username}
        </div>
        <button className="btn-icon" onClick={logout} title="Sign out">
          <Icon name="logout" size={17} />
        </button>
      </div>
    </header>
  );
}
