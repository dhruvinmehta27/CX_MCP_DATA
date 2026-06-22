import { useMemo, useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import useFilters, { toApiFilters } from '../hooks/useFilters';
import useAnalytics from '../hooks/useAnalytics';
import { getOpportunitiesList, getPipelineOverview } from '../api/analytics';
import { computeOverview, applyBoardFilters, orderedStages, emptyBoardFilters } from '../utils/pipeline';
import { downloadCSV, downloadExcel, exportPDF } from '../utils/exporters';
import { fmtCurrencyFull, fmtNumber, fmtDate } from '../utils/formatters';
import Icon from '../components/ui/Icon';
import EmptyState from '../components/ui/EmptyState';
import SkeletonCard from '../components/ui/SkeletonCard';
import KpiHeader from '../components/pipeline/KpiHeader';
import BoardFilters from '../components/pipeline/BoardFilters';
import KanbanBoard from '../components/pipeline/KanbanBoard';
import FunnelView from '../components/pipeline/FunnelView';
import ForecastView from '../components/pipeline/ForecastView';
import FlowView from '../components/pipeline/FlowView';
import OpportunityDrawer from '../components/pipeline/OpportunityDrawer';

// ECharts is heavy — load the bubble matrix (and echarts) only when opened
const BubbleView = lazy(() => import('../components/pipeline/BubbleView'));

const VIEWS = [
  { id: 'board', label: 'Kanban Board', icon: 'briefcase' },
  { id: 'funnel', label: 'Funnel', icon: 'funnel' },
  { id: 'forecast', label: 'Forecast', icon: 'trending-up' },
  { id: 'flow', label: 'Flow', icon: 'target' },
  { id: 'bubble', label: 'Bubble Matrix', icon: 'bubble' },
];

const EXPORT_COLUMNS = [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Opportunity' },
  { key: 'account', label: 'Account' },
  { key: 'stage', label: 'Stage' },
  { key: 'status', label: 'Status' },
  { key: 'expectedValue', label: 'Value' },
  { key: 'probability', label: 'Probability %' },
  { key: 'weightedValue', label: 'Weighted', render: (v) => Math.round(v || 0) },
  { key: 'expectedClose', label: 'Expected Close', render: (v) => (v ? v.slice(0, 10) : '') },
  { key: 'owner', label: 'Owner' },
  { key: 'source', label: 'Source' },
  { key: 'oppType', label: 'Type' },
  { key: 'territory', label: 'Region / Team' },
  { key: 'segment', label: 'Segment' },
  { key: 'subSegment', label: 'Sub-segment' },
];

function decodeBoardFilters(raw) {
  try {
    return { ...emptyBoardFilters(), ...JSON.parse(raw) };
  } catch {
    return emptyBoardFilters();
  }
}

export default function PipelineBoard() {
  const { filters, version } = useFilters();
  const api = toApiFilters(filters);
  const [searchParams, setSearchParams] = useSearchParams();

  const [view, setView] = useState(searchParams.get('view') || 'board');
  const [board, setBoard] = useState(() =>
    searchParams.get('bf') ? decodeBoardFilters(searchParams.get('bf')) : emptyBoardFilters()
  );
  const [selected, setSelected] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);

  // Previous-period comparison for the funnel (server-computed, on demand)
  const [comparing, setComparing] = useState(false);
  const [prevFunnel, setPrevFunnel] = useState(null);
  const [loadingCompare, setLoadingCompare] = useState(false);

  const list = useAnalytics(() => getOpportunitiesList({ ...api, limit: 10000 }), [version]);
  const rows = list.data?.rows || [];

  // Keep view + filters in the URL so a filtered view is bookmarkable/shareable
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set('view', view);
    const isEmpty = JSON.stringify(board) === JSON.stringify(emptyBoardFilters());
    if (isEmpty) next.delete('bf');
    else next.set('bf', JSON.stringify(board));
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, board]);

  const stageOptions = useMemo(() => orderedStages(rows), [rows]);
  const filteredRows = useMemo(() => applyBoardFilters(rows, board), [rows, board]);
  const overview = useMemo(() => computeOverview(filteredRows), [filteredRows]);

  const toggleCompare = useCallback(async () => {
    if (comparing) {
      setComparing(false);
      return;
    }
    setComparing(true);
    if (!prevFunnel) {
      setLoadingCompare(true);
      try {
        const data = await getPipelineOverview({ ...api, compare: 1 });
        setPrevFunnel(data?.funnel?.previous || null);
      } catch {
        setPrevFunnel(null);
      } finally {
        setLoadingCompare(false);
      }
    }
  }, [comparing, prevFunnel, api]);

  // Reset comparison cache when the global period changes
  useEffect(() => {
    setPrevFunnel(null);
    setComparing(false);
  }, [version]);

  const share = () => {
    const url = `${window.location.origin}${window.location.pathname}?${searchParams.toString()}`;
    navigator.clipboard?.writeText(url);
  };

  const doExport = (kind) => {
    setExportOpen(false);
    const base = 'pipeline-opportunities';
    if (kind === 'csv') downloadCSV(base, filteredRows, EXPORT_COLUMNS);
    else if (kind === 'excel') downloadExcel(base, filteredRows, EXPORT_COLUMNS);
    else exportPDF();
  };

  if (list.error) {
    return (
      <div className="page">
        <EmptyState title="Could not load pipeline" message={list.error.message} error />
      </div>
    );
  }

  return (
    <div className="page pipeline-board">
      <KpiHeader kpis={overview.kpis} loading={list.loading} />

      <div className="board-toolbar no-print">
        <div className="view-tabs">
          {VIEWS.map((v) => (
            <button key={v.id} className={`view-tab${view === v.id ? ' active' : ''}`} onClick={() => setView(v.id)}>
              <Icon name={v.icon} size={15} />
              {v.label}
            </button>
          ))}
        </div>
        <div className="board-toolbar-right">
          <span className="board-count">
            {list.loading ? 'Loading…' : `${fmtNumber(filteredRows.length)} of ${fmtNumber(rows.length)} shown`}
          </span>
          <div className="dropdown">
            <button className="btn btn-ghost btn-sm" onClick={() => setExportOpen((o) => !o)}>
              <Icon name="download" size={14} /> Export
            </button>
            {exportOpen && (
              <div className="dropdown-list" style={{ right: 0, left: 'auto', minWidth: 160 }}>
                <div className="dropdown-item" onClick={() => doExport('excel')}>Excel (.xls)</div>
                <div className="dropdown-item" onClick={() => doExport('csv')}>CSV</div>
                <div className="dropdown-item" onClick={() => doExport('pdf')}>PDF (print)</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <BoardFilters value={board} onChange={setBoard} stageOptions={stageOptions} rows={rows} onShare={share} />

      {list.loading ? (
        <SkeletonCard />
      ) : rows.length === 0 ? (
        <EmptyState title="No opportunities" message="No opportunities match the global date and org filters." />
      ) : (
        <div className="board-stage">
          {view === 'board' && <KanbanBoard rows={filteredRows} stages={stageOptions} onSelect={setSelected} />}
          {view === 'funnel' && (
            <div className="card view-card">
              <FunnelView
                funnel={overview.funnel}
                comparing={comparing}
                previous={prevFunnel}
                loadingCompare={loadingCompare}
                onToggleCompare={toggleCompare}
              />
            </div>
          )}
          {view === 'forecast' && <ForecastView forecast={overview.forecast} kpis={overview.kpis} />}
          {view === 'flow' && (
            <div className="card view-card">
              <FlowView flow={overview.flow} />
            </div>
          )}
          {view === 'bubble' && (
            <div className="card view-card">
              <Suspense fallback={<SkeletonCard />}>
                <BubbleView rows={filteredRows} onSelect={setSelected} />
              </Suspense>
            </div>
          )}
        </div>
      )}

      <OpportunityDrawer opp={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
