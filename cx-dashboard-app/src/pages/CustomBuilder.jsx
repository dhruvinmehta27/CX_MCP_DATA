import { useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { subMonths, subYears } from 'date-fns';
import useFilters, { toApiFilters } from '../hooks/useFilters';
import { planReport, generateDashboard } from '../api/dashboard';
import { isoDate } from '../utils/formatters';
import DynamicChart from '../components/charts/DynamicChart';
import DataTable from '../components/ui/DataTable';
import EmptyState from '../components/ui/EmptyState';
import Icon from '../components/ui/Icon';

const DATE_PRESETS = [
  { label: 'Last 1M', months: 1 },
  { label: 'Last 3M', months: 3 },
  { label: 'Last 6M', months: 6, default: true },
  { label: 'Last 1Y', months: 12 },
];

function builderDateRange(months) {
  const now = new Date();
  return { dateFrom: isoDate(subMonths(now, months)), dateTo: isoDate(now) };
}

const STEPS = ['Define', 'Confirm', 'Build', 'Report'];

const SUGGESTIONS = [
  // Management
  'Executive pipeline summary across all sales orgs',
  'Compare this month vs last month across all metrics',
  'Pipeline value by stage and sales org',
  'Win rate and lost deal analysis by sales org',
  'Revenue breakdown by business type',
  'Top 10 customers by quote value',
  'Opportunity pipeline health and conversion funnel',
  'Sales forecast based on current pipeline stages',
  // Sales
  'My open quotes and RFQs status',
  'Quote volume trend by month',
  'RFQ status breakdown and overdue items',
  'Daily operations summary',
  'Quotes by sales org',
  'New opportunities created this period',
  'Stale opportunities with no recent activity',
  'Quotes pending customer response',
];

const ENDPOINT_LABELS = {
  'quotes/by-status': 'Quotes by status',
  'quotes/by-sales-org': 'Quotes by sales org',
  'quotes/trend': 'Quote trend over time',
  'quotes/by-biz-type': 'Quotes by business type',
  'quotes/top-customers': 'Top customers',
  'opportunities/pipeline': 'Opportunity pipeline',
  'rfqs/by-status': 'RFQs by status',
  'daily-summary': 'Daily operations summary',
};

function Stepper({ current }) {
  return (
    <div className="stepper">
      {STEPS.map((label, i) => (
        <div key={label} className="stepper-item">
          <div
            className={`step ${i === current ? 'active' : ''} ${i < current ? 'done' : ''}`}
          >
            <span className="step-num">{i < current ? '✓' : i + 1}</span>
            <span className="step-label">{label}</span>
          </div>
          {i < STEPS.length - 1 && <div className={`step-line ${i < current ? 'done' : ''}`} />}
        </div>
      ))}
    </div>
  );
}

function flattenForTable(rawData) {
  if (!rawData) return { columns: [], rows: [] };
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
  const { filters: globalFilters } = useFilters();
  const [selectedMonths, setSelectedMonths] = useState(6);
  const [step, setStep] = useState(0);
  const [request, setRequest] = useState('');
  const [intent, setIntent] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showData, setShowData] = useState(false);
  const chartRef = useRef(null);

  // Builder uses its own fixed date range, not the global FilterBar
  const filters = { ...globalFilters, ...builderDateRange(selectedMonths) };

  const plan = async (text) => {
    const userRequest = (text ?? request).trim();
    if (!userRequest || busy) return;
    setRequest(userRequest);
    setBusy(true);
    setError(null);
    try {
      const res = await planReport(userRequest, toApiFilters(filters));
      setIntent(res.intent);
      setStep(1);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const build = async () => {
    setStep(2);
    setError(null);
    try {
      const res = await generateDashboard(request, toApiFilters(filters), intent);
      setResult(res);
      setStep(3);
    } catch (err) {
      setError(err);
      setStep(1);
    }
  };

  const restart = () => {
    setStep(0);
    setIntent(null);
    setResult(null);
    setError(null);
  };

  const exportPng = async () => {
    if (!chartRef.current) return;
    const canvas = await html2canvas(chartRef.current, { backgroundColor: '#FFFFFF' });
    const link = document.createElement('a');
    link.download = `${(result?.title || 'report').replace(/\s+/g, '-').toLowerCase()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const table = useMemo(() => flattenForTable(result?.rawData), [result]);
  const onKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) plan();
  };

  return (
    <div className="page builder-page">
      <div className="builder-range-bar">
        <Icon name="calendar" size={14} style={{ color: 'var(--text-secondary)' }} />
        <span className="builder-range-label">Data range:</span>
        {DATE_PRESETS.map((p) => (
          <button
            key={p.months}
            className={`builder-range-chip${selectedMonths === p.months ? ' active' : ''}`}
            onClick={() => setSelectedMonths(p.months)}
            disabled={step > 0}
          >
            {p.label}
          </button>
        ))}
        <span className="builder-range-hint">
          {filters.dateFrom} → {filters.dateTo}
        </span>
      </div>
      <Stepper current={step} />

      {/* ---------- Step 1: DEFINE ---------- */}
      {step === 0 && (
        <div className="builder-hero">
          <div className="builder-badge">
            <Icon name="sparkles" size={13} />
            AI REPORT BUILDER
          </div>
          <h1>What do you want to know?</h1>
          <p>
            Describe your report in plain English. AI reads your question, selects the right
            data and charts, then builds a full report from live C4C data.
          </p>
          <div className="builder-card">
            <textarea
              className="builder-textarea"
              rows={3}
              placeholder='"Show me an executive summary of our pipeline performance across all sales orgs"'
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <div className="builder-card-footer">
              <span className="builder-hint">Ctrl + Enter to continue</span>
              <button className="btn" onClick={() => plan()} disabled={busy || !request.trim()}>
                {busy ? 'Analyzing…' : 'Continue'}
                <Icon name="arrow-right" size={15} className={busy ? 'spinning' : undefined} />
              </button>
            </div>
          </div>
          <div className="chip-cloud">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="chip" onClick={() => plan(s)} disabled={busy}>
                {s}
              </button>
            ))}
          </div>
          {error && (
            <div className="card" style={{ width: '100%', maxWidth: 720 }}>
              <EmptyState title="Could not analyze the request" message={error.message} error />
            </div>
          )}
        </div>
      )}

      {/* ---------- Step 2: CONFIRM ---------- */}
      {step === 1 && intent && (
        <div className="confirm-wrap">
          <div className="card plan-card">
            <div className="plan-request">&ldquo;{request}&rdquo;</div>

            {intent.explanation && (
              <div className="plan-explanation">
                <div className="plan-explanation-label">
                  <Icon name="sparkles" size={13} />
                  AI understood this as
                </div>
                <p>{intent.explanation}</p>
              </div>
            )}

            <div className="plan-grid">
              <div className="plan-item">
                <label>Report title</label>
                <div>{intent.title || 'Untitled report'}</div>
              </div>
              <div className="plan-item">
                <label>Chart type</label>
                <div style={{ textTransform: 'capitalize' }}>{intent.chartType || 'bar'}</div>
              </div>
              <div className="plan-item">
                <label>Data sources</label>
                <div className="plan-chips">
                  {intent.endpoints.map((e) => (
                    <span key={e} className="plan-chip">{ENDPOINT_LABELS[e] || e}</span>
                  ))}
                </div>
              </div>
              <div className="plan-item">
                <label>Period</label>
                <div>
                  {(intent.filters?.dateFrom || filters.dateFrom)} → {(intent.filters?.dateTo || filters.dateTo)}
                  {filters.salesOrgName ? ` · ${filters.salesOrgName}` : ''}
                  {filters.ownerId ? ` · owner: ${filters.ownerId}` : ''}
                </div>
              </div>
            </div>
            {error && (
              <EmptyState title="Build failed" message={error.message} error />
            )}
            <div className="plan-actions">
              <button className="btn btn-ghost" onClick={restart}>
                <Icon name="edit" size={15} />
                Refine request
              </button>
              <button className="btn" onClick={build}>
                Build report
                <Icon name="arrow-right" size={15} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Step 3: BUILD ---------- */}
      {step === 2 && (
        <div className="build-progress">
          <div className="auth-spinner" style={{ width: 34, height: 34 }} />
          <h2>Building your report…</h2>
          <p>Fetching live C4C data, aggregating, and generating the chart. Wide date ranges can take a few minutes on first run.</p>
        </div>
      )}

      {/* ---------- Step 4: REPORT ---------- */}
      {step === 3 && result && (
        <>
          <div className="card chart-card">
            <div className="chart-card-header">
              <div>
                <div className="chart-card-title">{result.title}</div>
                {result.summary && <div className="chart-card-subtitle">{result.summary}</div>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {table.rows.length > 0 && (
                  <button className="btn btn-ghost" onClick={() => setShowData((v) => !v)}>
                    <Icon name={showData ? 'eye-off' : 'eye'} size={15} />
                    {showData ? 'Hide data' : 'Show data'}
                  </button>
                )}
                <button className="btn btn-ghost" onClick={exportPng}>
                  <Icon name="download" size={15} />
                  Export PNG
                </button>
                <button className="btn btn-ghost" onClick={restart}>
                  <Icon name="sparkles" size={15} />
                  New report
                </button>
              </div>
            </div>
            <div ref={chartRef} className="report-charts-grid" style={{ padding: 8 }}>
              {(result.charts || []).map((chart, i) => (
                <div key={i} className="card" style={{ margin: 0 }}>
                  {chart.title && (
                    <div className="chart-card-title" style={{ marginBottom: 8, fontSize: 13 }}>{chart.title}</div>
                  )}
                  <DynamicChart config={chart} height={280} />
                  {chart.summary && (
                    <div className="chart-card-subtitle" style={{ marginTop: 6 }}>{chart.summary}</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {result.insights?.length > 0 && (
            <div className="card">
              <div className="chart-card-title" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="bulb" size={17} style={{ color: 'var(--warning)' }} />
                AI Insights
              </div>
              <ul className="insights-list">
                {result.insights.map((insight, i) => (
                  <li key={i}>{insight}</li>
                ))}
              </ul>
            </div>
          )}

          {showData && table.rows.length > 0 && (
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
