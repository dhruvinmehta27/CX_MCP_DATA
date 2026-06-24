import { useMemo, useState } from 'react';
import Icon from '../ui/Icon';
import { fmtCurrency, fmtCurrencyFull, fmtDate } from '../../utils/formatters';
import { CHART_COLORS } from '../../utils/colors';

const SORTS = {
  value: { label: 'Value', cmp: (a, b) => (b.expectedValue || 0) - (a.expectedValue || 0) },
  close: { label: 'Close date', cmp: (a, b) => new Date(a.expectedClose || 8.64e15) - new Date(b.expectedClose || 8.64e15) },
  probability: { label: 'Probability', cmp: (a, b) => (b.probability || 0) - (a.probability || 0) },
};

const CARDS_PER_COLUMN = 60; // virtual cap — keeps the board fast on 10k+ pipelines

function dueClass(iso) {
  if (!iso) return '';
  const days = (new Date(iso) - Date.now()) / 86_400_000;
  if (days < 0) return 'due-overdue';
  if (days < 14) return 'due-soon';
  return '';
}

function Card({ opp, color, onClick, onDragStart }) {
  return (
    <div
      className="kanban-card"
      draggable
      onDragStart={(e) => onDragStart(e, opp)}
      onClick={() => onClick(opp)}
      style={{ borderLeftColor: color }}
    >
      <div className="kanban-card-title">{opp.name || `Opportunity ${opp.id}`}</div>
      <div className="kanban-card-account">
        <Icon name="briefcase" size={12} /> {opp.account || '—'}
      </div>
      <div className="kanban-card-value">{fmtCurrencyFull(opp.expectedValue)}</div>
      <div className="kanban-card-meta">
        <span className="prob-pill" title="Win probability">{opp.probability ?? 0}%</span>
        <span className={`kanban-card-due ${dueClass(opp.expectedClose)}`}>
          <Icon name="calendar" size={11} /> {fmtDate(opp.expectedClose)}
        </span>
      </div>
      <div className="kanban-card-owner">
        <span className="owner-avatar">{(opp.owner || '?').slice(0, 1)}</span>
        {opp.owner || 'Unassigned'}
      </div>
    </div>
  );
}

/**
 * Day-to-day opportunity board. Drag-and-drop is VISUAL ONLY — moving a card
 * updates the board locally but does not write back to C4C (write-back is a
 * planned follow-up). The override is kept in local state and resets on filter
 * change so the board always reflects live data after a refetch.
 */
export default function KanbanBoard({ rows, stages, onSelect }) {
  const [sort, setSort] = useState('value');
  const [overrides, setOverrides] = useState({}); // oppId -> stage (visual only)
  const [dragOverStage, setDragOverStage] = useState(null);

  const stageOf = (r) => overrides[r.id] || r.stage || 'Unknown';

  const columns = useMemo(() => {
    const names = stages.length ? stages : [...new Set(rows.map((r) => r.stage || 'Unknown'))];
    const map = new Map(names.map((n) => [n, []]));
    for (const r of rows) {
      const s = stageOf(r);
      if (!map.has(s)) map.set(s, []);
      map.get(s).push(r);
    }
    return [...map.entries()].map(([stage, items]) => {
      items.sort(SORTS[sort].cmp);
      return {
        stage,
        items,
        count: items.length,
        total: items.reduce((a, r) => a + (r.expectedValue || 0), 0),
      };
    });
  }, [rows, stages, overrides, sort]);

  const onDragStart = (e, opp) => {
    e.dataTransfer.setData('text/plain', opp.id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDrop = (e, stage) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    setOverrides((o) => ({ ...o, [id]: stage }));
    setDragOverStage(null);
  };

  return (
    <div className="kanban-wrap">
      <div className="kanban-toolbar">
        <div className="kanban-sort">
          <span>Sort by</span>
          {Object.entries(SORTS).map(([key, s]) => (
            <button key={key} className={`chip${sort === key ? ' chip-on' : ''}`} onClick={() => setSort(key)}>
              {s.label}
            </button>
          ))}
        </div>
        {Object.keys(overrides).length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => setOverrides({})}>
            <Icon name="refresh" size={13} /> Reset moves (visual only)
          </button>
        )}
      </div>

      <div className="kanban-columns">
        {columns.map((col, i) => {
          const color = CHART_COLORS[i % CHART_COLORS.length];
          return (
            <div
              key={col.stage}
              className={`kanban-column${dragOverStage === col.stage ? ' drag-over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverStage(col.stage);
              }}
              onDragLeave={() => setDragOverStage((s) => (s === col.stage ? null : s))}
              onDrop={(e) => onDrop(e, col.stage)}
            >
              <div className="kanban-column-head" style={{ borderTopColor: color }}>
                <div className="kanban-column-title">
                  <span className="stage-dot" style={{ background: color }} />
                  {col.stage}
                </div>
                <div className="kanban-column-stats">
                  <span className="kanban-count">{col.count}</span>
                  <span className="kanban-total">{fmtCurrency(col.total)}</span>
                </div>
              </div>
              <div className="kanban-column-body">
                {col.items.slice(0, CARDS_PER_COLUMN).map((opp) => (
                  <Card key={opp.id} opp={opp} color={color} onClick={onSelect} onDragStart={onDragStart} />
                ))}
                {col.count > CARDS_PER_COLUMN && (
                  <div className="kanban-more">+{col.count - CARDS_PER_COLUMN} more — refine filters to view</div>
                )}
                {col.count === 0 && <div className="kanban-empty">No opportunities</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
