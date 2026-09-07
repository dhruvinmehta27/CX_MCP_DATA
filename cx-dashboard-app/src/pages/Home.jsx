import { useNavigate } from 'react-router-dom';
import Icon from '../components/ui/Icon';

const FEATURES = [
  {
    to: '/builder',
    icon: 'sparkles',
    title: 'AI Report Builder',
    desc: 'Describe what you want in plain English — the AI picks the right data, builds charts and tables, and explains the results.',
    cta: 'Build a report',
  },
  {
    to: '/brief',
    icon: 'briefcase',
    title: 'Sales Brief',
    desc: 'Generate a print-ready briefing tailored to your audience — executive, sales manager, or customer-facing — from live C4C data.',
    cta: 'Create a brief',
  },
];

const DATA_OBJECTS = [
  { icon: 'file-text', label: 'Quotes', detail: 'Status, value, trend, sales org, business type, top customers' },
  { icon: 'target', label: 'Opportunities', detail: 'Pipeline stages, created trend, by sales org, line items with products' },
  { icon: 'inbox', label: 'RFQs', detail: 'Request-for-quote status and breakdown' },
  { icon: 'check-square', label: 'Tasks', detail: 'Overdue and due-today tasks' },
  { icon: 'map-pin', label: 'Visits & Appointments', detail: 'Customer visit and meeting activity' },
  { icon: 'box', label: 'Opportunity Products', detail: 'Line-item detail — product ID, category, quantity, cost, price' },
];

export default function Home() {
  const navigate = useNavigate();
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 24px' }}>
      {/* Brand */}
      <img src="/Company_Logo.png" alt="Trelleborg" style={{ height: 36, marginBottom: 16, objectFit: 'contain' }} />
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>AI Intelligence</div>
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 40 }}>
        Ask questions about your SAP C4C data in plain English — get instant reports and briefings.
      </div>

      {/* Feature cards */}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 48, width: '100%', maxWidth: 760 }}>
        {FEATURES.map((f) => (
          <button
            key={f.to}
            onClick={() => navigate(f.to)}
            style={{
              flex: '1 1 320px', maxWidth: 360, textAlign: 'left', cursor: 'pointer',
              background: 'var(--card-bg)', border: '1px solid var(--border)',
              borderRadius: 14, padding: '28px 28px 24px', transition: 'box-shadow 0.15s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.10)'}
            onMouseLeave={(e) => e.currentTarget.style.boxShadow = 'none'}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ background: 'var(--accent)', borderRadius: 8, padding: '6px 8px', display: 'flex' }}>
                <Icon name={f.icon} size={18} style={{ color: '#fff' }} />
              </span>
              <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>{f.title}</span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 18px' }}>{f.desc}</p>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
              {f.cta} <Icon name="arrow-right" size={13} />
            </span>
          </button>
        ))}
      </div>

      {/* Data objects */}
      <div style={{ width: '100%', maxWidth: 760 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 14 }}>
          What you can explore
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
          {DATA_OBJECTS.map((d) => (
            <div key={d.label} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
              <Icon name={d.icon} size={15} style={{ color: 'var(--accent)', marginTop: 2, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{d.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{d.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
