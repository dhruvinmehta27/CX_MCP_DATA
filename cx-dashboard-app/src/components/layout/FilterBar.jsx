import { useEffect, useMemo, useRef, useState } from 'react';
import { subMonths, startOfWeek, startOfMonth, startOfYear } from 'date-fns';
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

const DAY_MS = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// All slider math is done in UTC so it round-trips exactly with isoDate()
// (which formats via toISOString); using local Dates would drift by a day in
// timezones ahead of UTC.
function parseDay(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}
function formatDay(date) {
  return date.toISOString().slice(0, 10); // matches isoDate()
}
function labelDay(date) {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
function clampDate(d, lo, hi) {
  const t = Math.min(Math.max(d.getTime(), lo.getTime()), hi.getTime());
  return new Date(t);
}

/**
 * Dual-handle date-range slider over a year-ticked timeline. Day-snapped,
 * keyboard-operable, and driven by the same { from, to } ISO strings the rest
 * of the filter bar uses.
 */
function DateRangeSlider({ value, onChange, domainMin, domainMax }) {
  const trackRef = useRef(null);
  const draggingRef = useRef(null);

  const span = Math.max(domainMax.getTime() - domainMin.getTime(), DAY_MS);
  const fromDate = clampDate(parseDay(value.from) || domainMin, domainMin, domainMax);
  const toDate = clampDate(parseDay(value.to) || domainMax, domainMin, domainMax);

  const toPct = (d) => ((d.getTime() - domainMin.getTime()) / span) * 100;
  const totalDays = Math.round(span / DAY_MS);
  const dayIndex = (d) => Math.round((d.getTime() - domainMin.getTime()) / DAY_MS);

  const dateAt = (clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    const days = Math.round((ratio * span) / DAY_MS);
    return new Date(domainMin.getTime() + days * DAY_MS);
  };

  // Move one handle, keeping start <= end and inside the domain.
  const moveHandle = (which, date) => {
    if (which === 'from') {
      onChange(formatDay(clampDate(date, domainMin, toDate)), value.to);
    } else {
      onChange(value.from, formatDay(clampDate(date, fromDate, domainMax)));
    }
  };

  const onTrackPointerDown = (e) => {
    if (!trackRef.current) return;
    const handleEl = e.target.closest('[data-handle]');
    const date = dateAt(e.clientX);
    // Clicking the track (not a handle) grabs whichever handle is nearer.
    const which = handleEl
      ? handleEl.dataset.handle
      : Math.abs(date - fromDate) <= Math.abs(date - toDate)
        ? 'from'
        : 'to';
    draggingRef.current = which;
    trackRef.current.setPointerCapture(e.pointerId);
    moveHandle(which, date);
  };
  const onTrackPointerMove = (e) => {
    if (draggingRef.current) moveHandle(draggingRef.current, dateAt(e.clientX));
  };
  const endDrag = (e) => {
    if (draggingRef.current && trackRef.current?.hasPointerCapture?.(e.pointerId)) {
      trackRef.current.releasePointerCapture(e.pointerId);
    }
    draggingRef.current = null;
  };

  const onHandleKeyDown = (which, e) => {
    const base = which === 'from' ? fromDate : toDate;
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        moveHandle(which, new Date(base.getTime() - DAY_MS));
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        moveHandle(which, new Date(base.getTime() + DAY_MS));
        break;
      case 'PageDown':
        moveHandle(which, new Date(base.getTime() - 30 * DAY_MS));
        break;
      case 'PageUp':
        moveHandle(which, new Date(base.getTime() + 30 * DAY_MS));
        break;
      case 'Home':
        moveHandle(which, which === 'from' ? domainMin : fromDate);
        break;
      case 'End':
        moveHandle(which, which === 'from' ? toDate : domainMax);
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  };

  const ticks = useMemo(() => {
    const years = [];
    for (let y = domainMin.getUTCFullYear(); y <= domainMax.getUTCFullYear(); y += 1) {
      years.push(new Date(Date.UTC(y, 0, 1)));
    }
    return years
      .map((d) => ({ year: d.getUTCFullYear(), pct: toPct(clampDate(d, domainMin, domainMax)) }))
      .filter((t) => t.pct >= 0 && t.pct <= 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domainMin, domainMax, span]);

  const handle = (which, date) => (
    <button
      type="button"
      className="dr-handle"
      data-handle={which}
      style={{ left: `${toPct(date)}%` }}
      role="slider"
      aria-label={which === 'from' ? 'Start date' : 'End date'}
      aria-valuemin={0}
      aria-valuemax={totalDays}
      aria-valuenow={dayIndex(date)}
      aria-valuetext={labelDay(date)}
      tabIndex={0}
      onKeyDown={(e) => onHandleKeyDown(which, e)}
    >
      <span className="dr-bubble">{labelDay(date)}</span>
    </button>
  );

  return (
    <div className="dr-slider">
      <div
        ref={trackRef}
        className="dr-track"
        onPointerDown={onTrackPointerDown}
        onPointerMove={onTrackPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          className="dr-range"
          style={{ left: `${toPct(fromDate)}%`, right: `${100 - toPct(toDate)}%` }}
        />
        {ticks.map((t) => (
          <span key={t.year} className="dr-tick" style={{ left: `${t.pct}%` }}>
            <i />
            <em>{t.year}</em>
          </span>
        ))}
        {handle('from', fromDate)}
        {handle('to', toDate)}
      </div>
    </div>
  );
}

export default function FilterBar() {
  const { filters, apply, reset } = useFilters();
  const [draft, setDraft] = useState(filters);
  const [orgSearch, setOrgSearch] = useState(filters.salesOrgName || '');
  const [orgOptions, setOrgOptions] = useState([]);
  const [orgOpen, setOrgOpen] = useState(false);
  const orgBoxRef = useRef(null);
  const searchTimer = useRef(null);

  // Anchored once so the timeline domain and preset matching stay stable for
  // the session.
  const now = useMemo(() => new Date(), []);

  // Timeline spans ~5 years back to today, widened if the active filter
  // reaches beyond that (e.g. a restored/older range).
  const domain = useMemo(() => {
    const today = parseDay(isoDate(now));
    let min = new Date(Date.UTC(today.getUTCFullYear() - 5, 0, 1));
    let max = today;
    const f = parseDay(filters.dateFrom);
    const t = parseDay(filters.dateTo);
    if (f && f < min) min = new Date(Date.UTC(f.getUTCFullYear(), 0, 1));
    if (t && t > max) max = t;
    return { min, max };
  }, [now, filters.dateFrom, filters.dateTo]);

  const presetRanges = useMemo(
    () =>
      PRESETS.map((p) => {
        const [f, t] = p.range(now);
        return { label: p.label, from: isoDate(f), to: isoDate(t) };
      }),
    [now]
  );
  const activePreset = presetRanges.find(
    (p) => p.from === draft.dateFrom && p.to === draft.dateTo
  )?.label;

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
    setDraft((d) => ({ ...d, dateFrom: preset.from, dateTo: preset.to }));
  };

  return (
    <div className="filter-bar">
      <div className="filter-group dr-group">
        <label>Date range</label>
        <DateRangeSlider
          value={{ from: draft.dateFrom, to: draft.dateTo }}
          onChange={(from, to) => setDraft((d) => ({ ...d, dateFrom: from, dateTo: to }))}
          domainMin={domain.min}
          domainMax={domain.max}
        />
      </div>

      <div className="filter-group">
        <label>Presets</label>
        <div className="preset-chips">
          {presetRanges.map((p) => (
            <button
              key={p.label}
              className={`chip${activePreset === p.label ? ' chip-on' : ''}`}
              onClick={() => applyPreset(p)}
            >
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
