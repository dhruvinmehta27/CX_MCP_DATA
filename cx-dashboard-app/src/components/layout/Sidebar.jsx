import { NavLink } from 'react-router-dom';

const NAV = [
  { to: '/', icon: '☀️', label: 'Daily Briefing', end: true },
  { to: '/quotes', icon: '📄', label: 'Quote Analytics' },
  { to: '/pipeline', icon: '📈', label: 'Pipeline Health' },
  { to: '/rfqs', icon: '📨', label: 'RFQ Tracker' },
  { to: '/builder', icon: '✨', label: 'Custom Builder' },
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
            <span className="nav-icon">{item.icon}</span>
            {!collapsed && item.label}
          </NavLink>
        ))}
      </nav>
      <button className="sidebar-toggle" onClick={onToggle} title="Toggle sidebar">
        {collapsed ? '»' : '« Collapse'}
      </button>
    </aside>
  );
}
