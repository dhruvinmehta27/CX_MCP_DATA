import { useState } from 'react';
import useAuth from '../../auth/useAuth';
import { clearCache } from '../../api/analytics';
import Icon from '../ui/Icon';

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
