import { useEffect, useRef, useState } from 'react';
import { subDays, subMonths, startOfWeek, startOfMonth, startOfYear } from 'date-fns';
import useFilters from '../../hooks/useFilters';
import { getOwners } from '../../api/analytics';
import { isoDate } from '../../utils/formatters';

const PRESETS = [
  { label: 'Today', range: (now) => [now, now] },
  { label: 'This Week', range: (now) => [startOfWeek(now, { weekStartsOn: 1 }), now] },
  { label: 'This Month', range: (now) => [startOfMonth(now), now] },
  { label: 'Last 3M', range: (now) => [subMonths(now, 3), now] },
  { label: 'Last 6M', range: (now) => [subMonths(now, 6), now] },
  { label: 'This Year', range: (now) => [startOfYear(now), now] },
  { label: 'Last 2Y', range: (now) => [subMonths(now, 24), now] },
  { label: 'Last 5Y', range: (now) => [subMonths(now, 60), now] },
];

export default function FilterBar() {
  const { filters, apply, reset } = useFilters();
  const [draft, setDraft] = useState(filters);
  const [owners, setOwners] = useState([]);

  useEffect(() => { setDraft(filters); }, [filters]);

  useEffect(() => {
    getOwners()
      .then((list) => setOwners(list))
      .catch(() => {});
  }, []);

  const applyPreset = (preset) => {
    const [from, to] = preset.range(new Date());
    setDraft((d) => ({ ...d, dateFrom: isoDate(from), dateTo: isoDate(to) }));
  };

  return (
    <div className="filter-bar">
      <div className="filter-group">
        <label>Date range</label>
        <div className="filter-row">
          <input
            type="date"
            className="input"
            value={draft.dateFrom}
            onChange={(e) => setDraft((d) => ({ ...d, dateFrom: e.target.value }))}
          />
          <span style={{ color: 'var(--text-muted)' }}>→</span>
          <input
            type="date"
            className="input"
            value={draft.dateTo}
            onChange={(e) => setDraft((d) => ({ ...d, dateTo: e.target.value }))}
          />
        </div>
      </div>

      <div className="filter-group">
        <label>Presets</label>
        <div className="preset-chips">
          {PRESETS.map((p) => (
            <button key={p.label} className="chip" onClick={() => applyPreset(p)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <label>Owner</label>
        <select
          className="input"
          value={draft.ownerId}
          onChange={(e) => setDraft((d) => ({ ...d, ownerId: e.target.value, ownerName: e.target.value }))}
        >
          <option value="">All owners</option>
          {owners.map((o) => (
            <option key={o.name} value={o.name}>{o.name}</option>
          ))}
        </select>
      </div>

      <div className="filter-row" style={{ gap: 8 }}>
        <button className="btn" onClick={() => apply(draft)}>Apply</button>
        <button className="btn btn-ghost" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
