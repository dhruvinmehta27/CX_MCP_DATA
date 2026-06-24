import { useNavigate } from 'react-router-dom';
import Icon from '../components/ui/Icon';

const TILES = [
  {
    path: '/briefing',
    icon: 'calendar',
    title: 'Daily Briefing',
    description: "Today's snapshot across quotes, pipeline, RFQs and tasks",
    accent: 'primary',
  },
  {
    path: '/quotes',
    icon: 'file-text',
    title: 'Quote Analytics',
    description: 'Full quote analysis and trends',
    accent: 'primary',
  },
  {
    path: '/board',
    icon: 'target',
    title: 'Pipeline Command Center',
    description: 'Kanban, funnel, forecast and flow — one shared filter set',
    accent: 'primary',
  },
  {
    path: '/pipeline',
    icon: 'banknote',
    title: 'Pipeline Health',
    description: 'Opportunity pipeline analysis and stage breakdown',
    accent: 'primary',
  },
  {
    path: '/rfqs',
    icon: 'inbox',
    title: 'RFQ Tracker',
    description: 'Request-for-quote status and due dates',
    accent: 'primary',
  },
  {
    path: '/builder',
    icon: 'zap',
    title: 'AI Report Builder',
    description: 'Describe a report in plain English',
    accent: 'primary',
  },
  {
    path: '/brief',
    icon: 'clipboard',
    title: 'Sales Brief',
    description: 'Audience-tailored, print-ready briefing',
    accent: 'primary',
  },
];

export default function Dashboard() {
  const navigate = useNavigate();

  return (
    <div className="page">
      <div className="dashboard-tiles">
        {TILES.map((tile) => (
          <button
            key={tile.path}
            className="dashboard-tile"
            onClick={() => navigate(tile.path)}
          >
            <div className="dashboard-tile-icon">
              <Icon name={tile.icon} size={28} />
            </div>
            <div className="dashboard-tile-body">
              <span className="dashboard-tile-title">{tile.title}</span>
              <span className="dashboard-tile-desc">{tile.description}</span>
            </div>
            <Icon name="chevron-right" size={16} className="dashboard-tile-arrow" />
          </button>
        ))}
      </div>
    </div>
  );
}
