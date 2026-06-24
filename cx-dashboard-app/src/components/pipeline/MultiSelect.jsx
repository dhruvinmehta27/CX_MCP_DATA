import { useEffect, useRef, useState } from 'react';
import Icon from '../ui/Icon';

/**
 * Compact multi-select dropdown with search. Used for the categorical board
 * dimensions (Source, Type, Region/Team, Segment, Sub-segment).
 */
export default function MultiSelect({ label, options, selected, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const toggle = (opt) => {
    const set = new Set(selected);
    set.has(opt) ? set.delete(opt) : set.add(opt);
    onChange([...set]);
  };

  const shown = query ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase())) : options;
  const count = selected.length;
  const isDisabled = disabled || options.length === 0;

  return (
    <div className="multiselect dropdown" ref={ref}>
      <button
        className={`multiselect-trigger${count ? ' has-value' : ''}`}
        onClick={() => !isDisabled && setOpen((o) => !o)}
        disabled={isDisabled}
        title={isDisabled ? 'No values available for the current data' : undefined}
      >
        <span>{label}{count > 0 && <span className="multiselect-badge">{count}</span>}</span>
        <Icon name="chevron-right" size={13} className="multiselect-caret" />
      </button>
      {open && (
        <div className="dropdown-list multiselect-list">
          <div className="multiselect-search">
            <Icon name="search" size={13} />
            <input
              autoFocus
              placeholder={`Search ${label.toLowerCase()}…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {count > 0 && (
            <div className="multiselect-clear" onClick={() => onChange([])}>
              Clear {count} selected
            </div>
          )}
          {shown.length === 0 && <div className="dropdown-empty">No matches</div>}
          {shown.map((opt) => (
            <label key={opt} className="multiselect-option">
              <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} />
              <span>{opt}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
