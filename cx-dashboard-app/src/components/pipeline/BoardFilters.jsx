import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../ui/Icon';
import MultiSelect from './MultiSelect';
import { STATUS_BUCKETS, distinctValues, emptyBoardFilters } from '../../utils/pipeline';

const PRESET_KEY = 'pipelineBoardPresets';

// Geographic Country/State live only on the account; deferred until the
// account join is added (see hand-off notes).
const PENDING_FILTERS = ['Country', 'Geographic region'];

function loadPresets() {
  try {
    return JSON.parse(localStorage.getItem(PRESET_KEY) || '{}');
  } catch {
    return {};
  }
}

export default function BoardFilters({ value, onChange, stageOptions, rows, onShare }) {
  const [presets, setPresets] = useState(loadPresets);
  const [presetOpen, setPresetOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setPresetOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const toggle = (key, item) => {
    const set = new Set(value[key]);
    set.has(item) ? set.delete(item) : set.add(item);
    onChange({ ...value, [key]: [...set] });
  };

  const setRange = (key, idx, raw) => {
    const next = [...value[key]];
    next[idx] = raw === '' ? (key === 'probRange' ? (idx === 0 ? 0 : 100) : null) : Number(raw);
    onChange({ ...value, [key]: next });
  };

  const savePreset = () => {
    const name = window.prompt('Save current filters as preset — name:');
    if (!name) return;
    const next = { ...presets, [name]: value };
    setPresets(next);
    localStorage.setItem(PRESET_KEY, JSON.stringify(next));
  };
  const applyPreset = (name) => {
    onChange({ ...emptyBoardFilters(), ...presets[name] });
    setPresetOpen(false);
  };
  const deletePreset = (name, e) => {
    e.stopPropagation();
    const next = { ...presets };
    delete next[name];
    setPresets(next);
    localStorage.setItem(PRESET_KEY, JSON.stringify(next));
  };

  const reset = () => onChange(emptyBoardFilters());

  const presetNames = Object.keys(presets);

  // Sub-segment options are constrained by the chosen business segment(s)
  const dimOptions = useMemo(() => {
    const segSet = value.segments.length ? new Set(value.segments) : null;
    const subRows = segSet ? rows.filter((r) => segSet.has(r.segment)) : rows;
    return {
      sources: distinctValues(rows, 'source'),
      types: distinctValues(rows, 'oppType'),
      territories: distinctValues(rows, 'territory'),
      segments: distinctValues(rows, 'segment'),
      subSegments: distinctValues(subRows, 'subSegment'),
    };
  }, [rows, value.segments]);

  const setDim = (key, vals) => onChange({ ...value, [key]: vals });

  return (
    <div className="board-filters">
      <div className="board-filters-row">
        <div className="board-search">
          <Icon name="search" size={15} />
          <input
            className="board-search-input"
            placeholder="Quick search name, account, owner…"
            value={value.search}
            onChange={(e) => onChange({ ...value, search: e.target.value })}
          />
          {value.search && (
            <button className="board-search-clear" onClick={() => onChange({ ...value, search: '' })} title="Clear">
              <Icon name="close" size={13} />
            </button>
          )}
        </div>

        <div className="board-filters-actions" ref={boxRef}>
          <div className="dropdown">
            <button className="btn btn-ghost btn-sm" onClick={() => setPresetOpen((o) => !o)}>
              <Icon name="bulb" size={14} /> Presets
            </button>
            {presetOpen && (
              <div className="dropdown-list" style={{ right: 0, left: 'auto', minWidth: 200 }}>
                <div className="dropdown-item" onClick={savePreset}>
                  <Icon name="download" size={13} /> Save current…
                </div>
                {presetNames.length === 0 && <div className="dropdown-empty">No saved presets</div>}
                {presetNames.map((name) => (
                  <div key={name} className="dropdown-item" onClick={() => applyPreset(name)}>
                    <span>{name}</span>
                    <button className="dropdown-item-del" onClick={(e) => deletePreset(name, e)} title="Delete">
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onShare} title="Copy a shareable link to this filtered view">
            <Icon name="external" size={14} /> Share
          </button>
          <button className="btn btn-ghost btn-sm" onClick={reset}>
            <Icon name="refresh" size={14} /> Reset
          </button>
        </div>
      </div>

      <div className="board-filters-row board-chips-row">
        <div className="chip-group">
          <span className="chip-group-label">Status</span>
          {STATUS_BUCKETS.map((s) => (
            <button
              key={s}
              className={`chip${value.statuses.includes(s) ? ' chip-on' : ''}`}
              onClick={() => toggle('statuses', s)}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="chip-group">
          <span className="chip-group-label">Stage</span>
          {stageOptions.map((s) => (
            <button
              key={s}
              className={`chip${value.stages.includes(s) ? ' chip-on' : ''}`}
              onClick={() => toggle('stages', s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="board-filters-row board-dims-row">
        <MultiSelect label="Source" options={dimOptions.sources} selected={value.sources} onChange={(v) => setDim('sources', v)} />
        <MultiSelect label="Type" options={dimOptions.types} selected={value.types} onChange={(v) => setDim('types', v)} />
        <MultiSelect label="Region / Team" options={dimOptions.territories} selected={value.territories} onChange={(v) => setDim('territories', v)} />
        <MultiSelect label="Segment" options={dimOptions.segments} selected={value.segments} onChange={(v) => setDim('segments', v)} />
        <MultiSelect label="Sub-segment" options={dimOptions.subSegments} selected={value.subSegments} onChange={(v) => setDim('subSegments', v)} />
      </div>

      <div className="board-filters-row board-ranges-row">
        <div className="range-field">
          <label>Value €</label>
          <input
            type="number"
            className="input input-sm"
            placeholder="min"
            value={value.valueRange[0] ?? ''}
            onChange={(e) => setRange('valueRange', 0, e.target.value)}
          />
          <span>–</span>
          <input
            type="number"
            className="input input-sm"
            placeholder="max"
            value={value.valueRange[1] ?? ''}
            onChange={(e) => setRange('valueRange', 1, e.target.value)}
          />
        </div>
        <div className="range-field">
          <label>Probability %</label>
          <input
            type="number"
            min="0"
            max="100"
            className="input input-sm"
            value={value.probRange[0]}
            onChange={(e) => setRange('probRange', 0, e.target.value)}
          />
          <span>–</span>
          <input
            type="number"
            min="0"
            max="100"
            className="input input-sm"
            value={value.probRange[1]}
            onChange={(e) => setRange('probRange', 1, e.target.value)}
          />
        </div>

        <div className="chip-group pending-group" title="Awaiting C4C field-name confirmation on the Prod tenant before these can be wired">
          <span className="chip-group-label">Pending field mapping</span>
          {PENDING_FILTERS.map((f) => (
            <span key={f} className="chip chip-disabled">
              {f}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
