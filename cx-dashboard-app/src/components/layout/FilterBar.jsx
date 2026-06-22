import { useEffect, useRef, useState } from 'react';
import { subDays, subMonths, startOfWeek, startOfMonth, startOfYear } from 'date-fns';
import useFilters from '../../hooks/useFilters';
import { getSalesOrgs } from '../../api/analytics';
import { isoDate } from '../../utils/formatters';

const PRESETS = [
  { label: 'Today', range: (now) => [now, now] },
  { label: 'This Week', range: (now) => [startOfWeek(now, { weekStartsOn: 1 }), now] },
  { label: 'This Month', range: (now) => [startOfMonth(now), now] },
  { label: 'Last 3M', range: (now) => [subMonths(now, 3), now] },
  { label: 'Last 6M', range: (now) => [subMonths(now, 6), now] },
  { label: 'This Year', range: (now) => [startOfYear(now), now] },
  { label: 'Last 2Y', range: (now) => [subMonths(now, 24), now] },
  // Bounded instead of a true full-history fetch: an unbounded range pulls
  // hundreds of thousands of records and overwhelms the API. The server also
  // caps records as a safety net.
  { label: 'Last 5Y', range: (now) => [subMonths(now, 60), now] },
];

export default function FilterBar() {
  const { filters, apply, reset } = useFilters();
  const [draft, setDraft] = useState(filters);
  const [orgSearch, setOrgSearch] = useState(filters.salesOrgName || '');
  const [orgOptions, setOrgOptions] = useState([]);
  const [orgOpen, setOrgOpen] = useState(false);
  const orgBoxRef = useRef(null);
  const searchTimer = useRef(null);

  useEffect(() => {
    setDraft(filters);
    setOrgSearch(filters.salesOrgName || '');
  }, [filters]);

  // close the sales-org dropdown on outside click
  useEffect(() => {
    const onClick = (e) => {
      if (orgBoxRef.current && !orgBoxRef.current.contains(e.target)) setOrgOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const searchOrgs = (value) => {
    setOrgSearch(value);
    setDraft((d) => ({ ...d, salesOrgId: '', salesOrgName: '' }));
    clearTimeout(searchTimer.current);
    if (!value) {
      setOrgOptions([]);
      setOrgOpen(false);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const orgs = await getSalesOrgs(value);
        setOrgOptions(orgs.slice(0, 30));
        setOrgOpen(true);
      } catch (err) {
        console.error('Sales org search failed', err);
      }
    }, 300);
  };

  const pickOrg = (org) => {
    setDraft((d) => ({ ...d, salesOrgId: org.id, salesOrgName: org.name }));
    setOrgSearch(org.name);
    setOrgOpen(false);
  };

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

      <div className="filter-group" ref={orgBoxRef}>
        <label>Sales org</label>
        <div className="dropdown">
          <input
            className="input"
            placeholder="Search sales orgs…"
            value={orgSearch}
            onChange={(e) => searchOrgs(e.target.value)}
            onFocus={() => orgOptions.length > 0 && setOrgOpen(true)}
          />
          {orgOpen && orgOptions.length > 0 && (
            <div className="dropdown-list">
              {orgOptions.map((org) => (
                <div key={org.id} className="dropdown-item" onClick={() => pickOrg(org)}>
                  {org.name} <span style={{ color: 'var(--text-muted)' }}>({org.id})</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="filter-group">
        <label>Owner</label>
        <input
          className="input"
          placeholder="Owner name…"
          value={draft.ownerId}
          onChange={(e) => setDraft((d) => ({ ...d, ownerId: e.target.value, ownerName: e.target.value }))}
        />
      </div>

      <div className="filter-row" style={{ gap: 8 }}>
        <button className="btn" onClick={() => apply(draft)}>Apply</button>
        <button className="btn btn-ghost" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
