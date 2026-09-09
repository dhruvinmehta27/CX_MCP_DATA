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
  {
    icon: 'file-text',
    label: 'Quotes',
    can: ['Status breakdown & counts', 'Value by sales org', 'Monthly trend', 'By business type', 'Top customers by quote volume', 'Top reps by quote count', 'Raw quote list with filters'],
    cannot: ['Quote line items / products', 'Quote approval history'],
  },
  {
    icon: 'target',
    label: 'Opportunities',
    can: ['Pipeline by stage', 'Created trend over time', 'By sales org', 'Open vs won vs lost'],
    cannot: ['Opportunity owner ranking', 'Forecast accuracy'],
  },
  {
    icon: 'box',
    label: 'Opportunity Products',
    can: ['Line items by product category', 'Quantity, cost & price per item', 'Filter by org + product type', 'Customer & owner per line item'],
    cannot: ['RFQ product detail', 'Product master data'],
  },
  {
    icon: 'inbox',
    label: 'RFQs',
    can: ['Status breakdown', 'By supplier / account', 'Monthly trend', 'Open & overdue RFQ list', 'Filter by supplier name & date'],
    cannot: ['RFQ line items / product category', 'RFQ value / amount'],
  },
  {
    icon: 'activity',
    label: 'Activities',
    can: ['Overdue tasks', 'Upcoming visits & appointments', 'Daily summary'],
    cannot: ['Activity history older than data range', 'Call logs'],
  },
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
          What you can ask — by data source
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
          {DATA_OBJECTS.map((d) => (
            <div key={d.label} style={{
              background: '#fff', border: '1px solid var(--border)',
              borderRadius: 12, padding: '16px 18px',
              boxShadow: 'var(--shadow-sm)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--primary-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon name={d.icon} size={15} style={{ color: 'var(--primary)' }} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{d.label}</div>
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1e7a0f', marginBottom: 5 }}>✓ Can ask</div>
              <ul style={{ margin: '0 0 10px', paddingLeft: 16, listStyle: 'none' }}>
                {d.can.map((item) => (
                  <li key={item} style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ color: '#36A41D', fontWeight: 700, flexShrink: 0 }}>·</span>{item}
                  </li>
                ))}
              </ul>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#b84f00', marginBottom: 5 }}>✗ Not yet available</div>
              <ul style={{ margin: 0, paddingLeft: 16, listStyle: 'none' }}>
                {d.cannot.map((item) => (
                  <li key={item} style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7, display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ color: '#e76500', fontWeight: 700, flexShrink: 0 }}>·</span>{item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
