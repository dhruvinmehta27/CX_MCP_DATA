import { useNavigate } from 'react-router-dom';
import Icon from '../components/ui/Icon';
import useAuth from '../auth/useAuth';

/**
 * Full-screen welcome / launchpad — the app's landing page. No sidebar or
 * filter bar here; those appear only after the user picks a section.
 */
const TILES = [
  { path: '/briefing', icon: 'sun', title: 'Daily Briefing', desc: "Today's snapshot across quotes, pipeline, RFQs and tasks", accent: 'blue' },
  { path: '/board', icon: 'target', title: 'Pipeline Command Center', desc: 'Kanban, funnel, forecast, flow and bubble matrix — one shared filter set', accent: 'indigo' },
  { path: '/pipeline', icon: 'trending-up', title: 'Pipeline Health', desc: 'Opportunity pipeline analysis and stage breakdown', accent: 'green' },
  { path: '/quotes', icon: 'file-text', title: 'Quote Analytics', desc: 'Full quote analysis, trends and top customers', accent: 'teal' },
  { path: '/rfqs', icon: 'inbox', title: 'RFQ Tracker', desc: 'Request-for-quote status, open vs closed and due dates', accent: 'orange' },
  { path: '/builder', icon: 'sparkles', title: 'AI Report Builder', desc: 'Describe a report in plain English and let AI build it', accent: 'purple' },
  { path: '/brief', icon: 'briefcase', title: 'Sales Brief', desc: 'Audience-tailored, print-ready briefing from live C4C data', accent: 'pink' },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const name = user?.name || user?.username || '';
  const firstName = name.split(' ')[0] || 'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="welcome">
      <div className="welcome-aurora" aria-hidden="true" />

      <header className="welcome-topbar">
        <div className="welcome-brand">
          <div className="brand-logo">TSS</div>
          <span className="welcome-brand-name">
            Trelleborg <b>Sales Intelligence</b>
          </span>
        </div>
        {name && (
          <div className="welcome-user">
            <span className="welcome-user-name">{name}</span>
            <button className="btn-icon" title="Sign out" onClick={logout}>
              <Icon name="logout" size={18} />
            </button>
          </div>
        )}
      </header>

      <main className="welcome-main">
        <div className="welcome-hero">
          <span className="welcome-eyebrow">Sales Dashboard &amp; Analytics</span>
          <h1>
            {greeting}, <span className="welcome-name">{firstName}</span>.
          </h1>
          <p>Where would you like to start?</p>
        </div>

        <div className="welcome-grid">
          {TILES.map((t) => (
            <button
              key={t.path}
              className={`welcome-tile accent-${t.accent}`}
              onClick={() => navigate(t.path)}
            >
              <div className="welcome-tile-icon">
                <Icon name={t.icon} size={26} />
              </div>
              <div className="welcome-tile-text">
                <span className="welcome-tile-title">{t.title}</span>
                <span className="welcome-tile-desc">{t.desc}</span>
              </div>
              <Icon name="arrow-right" size={18} className="welcome-tile-arrow" />
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
