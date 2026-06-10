import { fmtCurrency, fmtNumber } from '../../utils/formatters';
import { chartColor } from '../../utils/colors';

/**
 * Pipeline funnel — CSS-based so stage labels, counts and values stay legible.
 * stages: [{ stage, count, totalValue }]
 */
export default function FunnelChart({ stages }) {
  if (!stages || stages.length === 0) return null;
  const max = Math.max(...stages.map((s) => s.totalValue), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
      {stages.map((s, i) => {
        const width = Math.max((s.totalValue / max) * 100, 8);
        return (
          <div key={s.stage} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 150, fontSize: 12, color: '#9CA3AF', textAlign: 'right', flexShrink: 0 }}>
              {s.stage}
            </div>
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
              <div
                style={{
                  width: `${width}%`,
                  background: `linear-gradient(90deg, ${chartColor(i)}cc, ${chartColor(i)}66)`,
                  borderRadius: 6,
                  padding: '8px 12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  fontSize: 12,
                  color: '#fff',
                  whiteSpace: 'nowrap',
                  minWidth: 130,
                }}
              >
                <span style={{ fontWeight: 600 }}>{fmtNumber(s.count)}</span>
                <span>{fmtCurrency(s.totalValue)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
