import { useNavigate } from 'react-router-dom';
import Icon from '../components/ui/Icon';

const FEATURES = [
  {
    to: '/builder',
    icon: 'sparkles',
    title: 'AI Report Builder',
    desc: 'Describe what you want in plain English. The AI selects the right data, builds charts or tables, and explains the results.',
    cta: 'Build a report',
    accent: '#0070F2',
    bg: 'rgba(0,112,242,0.06)',
  },
  {
    to: '/brief',
    icon: 'briefcase',
    title: 'Sales Brief',
    desc: 'Generate a print-ready briefing tailored to your audience — executive, sales manager, or customer-facing — from live C4C data.',
    cta: 'Create a brief',
    accent: '#36A41D',
    bg: 'rgba(54,164,29,0.06)',
  },
];

const DATA_OBJECTS = [
  { icon: 'file-text',    label: 'Quotes',                detail: 'Status, value, trend, by sales org & business type' },
  { icon: 'target',       label: 'Opportunities',         detail: 'Pipeline stages, created trend, by sales org' },
  { icon: 'box',          label: 'Opportunity Products',  detail: 'Line items — product, category, quantity, cost, price' },
  { icon: 'inbox',        label: 'RFQs',                  detail: 'Request-for-quote status and breakdown' },
  { icon: 'activity',     label: 'Activities',             detail: 'Tasks, visits & appointments — overdue and upcoming' },
];

export default function Home() {
  const navigate = useNavigate();

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '56px 24px 64px',
      animation: 'fadeInUp 0.4s var(--ease) both',
    }}>

      {/* Hero */}
      <img src="/Company_Logo.png" alt="Trelleborg" style={{ height: 40, marginBottom: 20, objectFit: 'contain' }} />
      <h1 style={{ margin: '0 0 8px', fontSize: 28, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.5px', textAlign: 'center' }}>
        AI Intelligence
      </h1>
      <p style={{ margin: '0 0 48px', fontSize: 15, color: 'var(--text-secondary)', textAlign: 'center', maxWidth: 480, lineHeight: 1.6 }}>
        Ask questions about your live SAP C4C data in plain English — get instant reports, charts, and briefings.
      </p>

      {/* Feature cards */}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center', width: '100%', maxWidth: 780, marginBottom: 52 }}>
        {FEATURES.map((f) => (
          <button
            key={f.to}
            onClick={() => navigate(f.to)}
            style={{
              flex: '1 1 340px', maxWidth: 375, textAlign: 'left', cursor: 'pointer',
              background: '#fff', border: '1px solid var(--border)',
              borderRadius: 16, padding: '28px 28px 26px',
              boxShadow: 'var(--shadow-sm)',
              transition: 'box-shadow 0.18s, transform 0.18s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; e.currentTarget.style.transform = 'none'; }}
          >
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 12, background: f.bg, marginBottom: 16 }}>
              <Icon name={f.icon} size={20} style={{ color: f.accent }} />
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{f.title}</div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.65, margin: '0 0 20px' }}>{f.desc}</p>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 600, color: f.accent }}>
              {f.cta} <Icon name="arrow-right" size={13} />
            </span>
          </button>
        ))}
      </div>

      {/* Data objects */}
      <div style={{ width: '100%', maxWidth: 780 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 14 }}>
          Data available from SAP C4C
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(228px, 1fr))', gap: 10 }}>
          {DATA_OBJECTS.map((d) => (
            <div key={d.label} style={{
              display: 'flex', gap: 12, alignItems: 'flex-start',
              background: '#fff', border: '1px solid var(--border)',
              borderRadius: 10, padding: '14px 16px',
              boxShadow: 'var(--shadow-sm)',
            }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--primary-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name={d.icon} size={15} style={{ color: 'var(--primary)' }} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>{d.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{d.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
