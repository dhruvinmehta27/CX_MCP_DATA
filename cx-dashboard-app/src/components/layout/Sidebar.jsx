import { NavLink } from 'react-router-dom';
import Icon from '../ui/Icon';

const NAV = [
  { to: '/', icon: 'grid', label: 'Dashboard', end: true },
  { to: '/briefing', icon: 'sun', label: 'Daily Briefing' },
  { to: '/quotes', icon: 'file-text', label: 'Quote Analytics' },
  { to: '/board', icon: 'target', label: 'Pipeline Command' },
  { to: '/pipeline', icon: 'trending-up', label: 'Pipeline Health' },
  { to: '/rfqs', icon: 'inbox', label: 'RFQ Tracker' },
  { to: '/builder', icon: 'sparkles', label: 'AI Report Builder' },
  { to: '/brief', icon: 'briefcase', label: 'Sales Brief' },
];

export default function Sidebar({ collapsed, onToggle }) {
  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-brand">
        <div className="brand-logo">TSS</div>
        {!collapsed && (
          <div className="brand-name">
            Trelleborg
            <span>Dashboard &amp; Analytics</span>
          </div>
        )}
      </div>
      <nav className="sidebar-nav">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            title={item.label}
          >
            <span className="nav-icon">
              <Icon name={item.icon} size={19} />
            </span>
            {!collapsed && item.label}
          </NavLink>
        ))}
      </nav>
      <button className="sidebar-toggle" onClick={onToggle} title="Toggle sidebar">
        <Icon name={collapsed ? 'chevrons-right' : 'chevrons-left'} size={16} />
        {!collapsed && 'Collapse'}
      </button>
    </aside>
  );
}
