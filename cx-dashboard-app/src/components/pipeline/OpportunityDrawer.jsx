import Icon from '../ui/Icon';
import { fmtCurrencyFull, fmtDate, fmtNumber } from '../../utils/formatters';
import { statusColor } from '../../utils/colors';
import { c4cObjectUrl } from '../../utils/c4cLinks';

function Field({ label, value }) {
  return (
    <div className="drawer-field">
      <span className="drawer-field-label">{label}</span>
      <span className="drawer-field-value">{value}</span>
    </div>
  );
}

/** Right slide-over with full opportunity detail — opened from any view. */
export default function OpportunityDrawer({ opp, onClose }) {
  if (!opp) return null;
  const url = c4cObjectUrl('opportunity', opp.objectId);
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title">{opp.name || `Opportunity ${opp.id}`}</div>
            <div className="drawer-sub">{opp.account || 'No account'}</div>
          </div>
          <button className="btn-icon" onClick={onClose} title="Close">
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="drawer-status">
          <span className="status-pill" style={{ background: `${statusColor(opp.stage)}1A`, color: statusColor(opp.stage) }}>
            {opp.stage || '—'}
          </span>
          <span className="status-pill" style={{ background: `${statusColor(opp.status)}1A`, color: statusColor(opp.status) }}>
            {opp.status || '—'}
          </span>
        </div>

        <div className="drawer-value">{fmtCurrencyFull(opp.expectedValue)}</div>
        <div className="drawer-weighted">
          Weighted {fmtCurrencyFull(opp.weightedValue)} at {opp.probability ?? 0}% probability
        </div>

        <div className="drawer-fields">
          <Field label="Opportunity ID" value={opp.id} />
          <Field label="Owner" value={opp.owner || 'Unassigned'} />
          <Field label="Expected close" value={fmtDate(opp.expectedClose)} />
          <Field label="Created" value={fmtDate(opp.created)} />
          <Field label="Probability" value={`${opp.probability ?? 0}%`} />
          <Field label="Weighted value" value={fmtCurrencyFull(opp.weightedValue)} />
          <Field label="Source" value={opp.source || '—'} />
          <Field label="Type" value={opp.oppType || '—'} />
          <Field label="Region / Team" value={opp.territory || '—'} />
          <Field label="Segment" value={opp.segment || '—'} />
          <Field label="Sub-segment" value={opp.subSegment || '—'} />
        </div>

        {url && (
          <a className="btn drawer-c4c" href={url} target="_blank" rel="noreferrer">
            <Icon name="external" size={15} /> Open in C4C
          </a>
        )}
      </aside>
    </div>
  );
}
