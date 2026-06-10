import { useState } from 'react';
import useAuth from '../../auth/useAuth';
import { clearCache } from '../../api/analytics';

export default function Header({ title, subtitle }) {
  const { user, logout } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

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
        <button className="btn btn-ghost" onClick={onRefresh} disabled={refreshing} title="Clear cache and reload data">
          {refreshing ? 'Refreshing…' : '⟳ Refresh data'}
        </button>
        <div className="user-chip">
          <div className="user-avatar">{initials}</div>
          {user?.name || user?.username}
        </div>
        <button className="btn-icon" onClick={logout} title="Sign out">⎋</button>
      </div>
    </header>
  );
}
