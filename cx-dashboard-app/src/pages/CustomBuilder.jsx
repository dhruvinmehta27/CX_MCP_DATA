import { useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import useFilters, { toApiFilters } from '../hooks/useFilters';
import { generateDashboard } from '../api/dashboard';
import DynamicChart from '../components/charts/DynamicChart';
import DataTable from '../components/ui/DataTable';
import SkeletonCard from '../components/ui/SkeletonCard';
import EmptyState from '../components/ui/EmptyState';

const SUGGESTIONS = [
  'Quotes by sales org last quarter',
  'Pipeline health for my team',
  'Top 10 customers by revenue this year',
  'RFQ status breakdown',
  'Compare this month vs last month',
];

function flattenForTable(rawData) {
  if (!rawData) return { columns: [], rows: [] };
  // Use the first endpoint payload that is an array of flat objects
  for (const value of Object.values(rawData)) {
    const arr = Array.isArray(value) ? value : value?.rows;
    if (Array.isArray(arr) && arr.length > 0 && typeof arr[0] === 'object') {
      const columns = Object.keys(arr[0]).map((key) => ({
        key,
        label: key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
        type: typeof arr[0][key] === 'number' ? 'number' : 'text',
      }));
      return { columns, rows: arr };
    }
  }
  return { columns: [], rows: [] };
}

export default function CustomBuilder() {
  const { filters } = useFilters();
  const [request, setRequest] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const chartRef = useRef(null);

  const run = async (text) => {
    const userRequest = (text ?? request).trim();
    if (!userRequest || loading) return;
    setRequest(userRequest);
    setLoading(true);
    setError(null);
    try {
      const res = await generateDashboard(userRequest, toApiFilters(filters));
      setResult(res);
    } catch (err) {
      setError(err);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const exportPng = async () => {
    if (!chartRef.current) return;
    const canvas = await html2canvas(chartRef.current, { backgroundColor: '#1D1D1B' });
    const link = document.createElement('a');
    link.download = `${(result?.title || 'chart').replace(/\s+/g, '-').toLowerCase()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const table = useMemo(() => flattenForTable(result?.rawData), [result]);

  return (
    <div className="page">
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="builder-input-row">
          <input
            className="builder-input"
            placeholder="Describe the analysis you want…"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run()}
          />
          <button className="btn" onClick={() => run()} disabled={loading || !request.trim()}>
            {loading ? 'Generating…' : '✨ Generate Dashboard'}
          </button>
        </div>
        <div className="suggest-row">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="chip" onClick={() => run(s)} disabled={loading}>
              {s}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Uses the global filters above ({filters.dateFrom} → {filters.dateTo}
          {filters.salesOrgName ? ` · ${filters.salesOrgName}` : ''}
          {filters.ownerId ? ` · owner: ${filters.ownerId}` : ''})
        </div>
      </div>

      {loading && (
        <div className="card">
          <SkeletonCard height={360} />
        </div>
      )}

      {error && (
        <div className="card">
          <EmptyState icon="⚠️" title="Generation failed" message={error.message} error />
        </div>
      )}

      {result && !loading && (
        <>
          <div className="card chart-card">
            <div className="chart-card-header">
              <div>
                <div className="chart-card-title">{result.title}</div>
                {result.summary && <div className="chart-card-subtitle">{result.summary}</div>}
              </div>
              <button className="btn btn-ghost" onClick={exportPng}>⬇ Export PNG</button>
            </div>
            <div ref={chartRef} style={{ padding: 8 }}>
              <DynamicChart config={result.chartConfig} height={400} />
            </div>
          </div>

          {result.insights?.length > 0 && (
            <div className="card">
              <div className="chart-card-title" style={{ marginBottom: 10 }}>💡 AI Insights</div>
              <ul className="insights-list">
                {result.insights.map((insight, i) => (
                  <li key={i}>{insight}</li>
                ))}
              </ul>
            </div>
          )}

          {table.rows.length > 0 && (
            <div className="card">
              <div className="chart-card-title" style={{ marginBottom: 10 }}>Data</div>
              <DataTable columns={table.columns} data={table.rows} pageSize={50} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
