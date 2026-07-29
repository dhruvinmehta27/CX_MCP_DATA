import { useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { subMonths, subYears } from 'date-fns';
import useFilters, { toApiFilters } from '../hooks/useFilters';
import { planReport, generateDashboard } from '../api/dashboard';
import { getSalesOrgs } from '../api/analytics';
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
  'opportunities/pipeline': 'Opportunity pipeline (by stage)',
  'opportunities/created-trend': 'Opportunities created over time',
  'opportunities/by-sales-org': 'Opportunities by sales org',
  'opportunities/items': 'Opportunity line items (products)',
  'quotes/raw': 'All quotes (raw detail)',
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
  if (!rawData) return { columns: [], rows: [], total: 0 };
  for (const value of Object.values(rawData)) {
    const arr = Array.isArray(value) ? value : value?.rows;
    const total = value?.total ?? arr?.length ?? 0;
    if (Array.isArray(arr) && arr.length > 0 && typeof arr[0] === 'object') {
      const columns = Object.keys(arr[0]).map((key) => ({
        key,
        label: key,
        type: typeof arr[0][key] === 'number' ? 'number' : 'text',
      }));
      return { columns, rows: arr, total };
    }
  }
  return { columns: [], rows: [], total: 0 };
}

function exportCsv(columns, rows, filename) {
  const header = columns.map((c) => `"${c.label}"`).join(',');
  const body = rows.map((row) =>
    columns.map((c) => {
      const v = row[c.key] ?? '';
      return typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(',')
  ).join('\n');
  const blob = new Blob([header + '\n' + body], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
  const [useRequestPeriod, setUseRequestPeriod] = useState(false);
  const [overrideDateFrom, setOverrideDateFrom] = useState(null);
  const [overrideDateTo, setOverrideDateTo] = useState(null);
  const [editedTitle, setEditedTitle] = useState('');
  const [orgMatches, setOrgMatches] = useState([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [selectedOrgName, setSelectedOrgName] = useState('');
  const chartRef = useRef(null);

  // Builder uses its own fixed date range, not the global FilterBar.
  // If user accepted the AI-detected period use exact dates (for quarters) or relative months.
  const effectiveMonths = (useRequestPeriod && intent?.detectedMonths) ? intent.detectedMonths : selectedMonths;
  const baseRange = builderDateRange(effectiveMonths);
  const filters = {
    ...globalFilters,
    dateFrom: (useRequestPeriod && overrideDateFrom) ? overrideDateFrom : baseRange.dateFrom,
    dateTo: (useRequestPeriod && overrideDateTo) ? overrideDateTo : baseRange.dateTo,
  };

  const plan = async (text) => {
    const userRequest = (text ?? request).trim();
    if (!userRequest || busy) return;
    setRequest(userRequest);
    setBusy(true);
    setError(null);
    setUseRequestPeriod(false);
    setOrgMatches([]);
    setSelectedOrgId('');
    setSelectedOrgName('');
    try {
      const res = await planReport(userRequest, toApiFilters(filters));
      setIntent(res.intent);
      setEditedTitle(res.intent.title || '');
      // Auto-search org when AI detected one.
      // If salesOrgId is comma-separated (multi-org), skip the C4C search — the IDs
      // are used directly by matchesOrg() and shown as read-only chips in the UI.
      const salesOrgId = res.intent.filters?.salesOrgId || '';
      const isMultiOrg = salesOrgId.includes(',');
      const orgKeyword = !isMultiOrg ? (res.intent.detectedOrgName || salesOrgId) : null;
      if (orgKeyword) {
        const orgs = await getSalesOrgs(orgKeyword);
        setOrgMatches(orgs || []);
      }
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
      // Use the C4C org ID from picker if user selected one, else fall back to AI-detected name
      const orgFilter = selectedOrgId
        ? { salesOrgId: selectedOrgId }
        : intent?.filters?.salesOrgId
          ? { salesOrgId: intent.filters.salesOrgId }
          : {};
      const buildFilters = { ...toApiFilters(filters), ...orgFilter };
      const buildIntent = { ...intent, title: editedTitle || intent?.title };
      const res = await generateDashboard(request, buildFilters, buildIntent);
      setResult({ ...res, title: res.title || buildIntent.title });
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
    setUseRequestPeriod(false);
    setOverrideDateFrom(null);
    setOverrideDateTo(null);
    setEditedTitle('');
    setOrgMatches([]);
    setSelectedOrgId('');
    setSelectedOrgName('');
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

            {intent.detectedPeriod && (
              <div className="date-conflict-banner">
                <Icon name="alert-triangle" size={15} />
                <span>
                  You asked for <strong>&ldquo;{intent.detectedPeriod}&rdquo;</strong> but your data range is set to <strong>Last {selectedMonths}M</strong>. Which should we use?
                </span>
                <div className="date-conflict-actions">
                  <button
                    className={`builder-range-chip${useRequestPeriod ? ' active' : ''}`}
                    onClick={() => {
                      setUseRequestPeriod(true);
                      if (intent.detectedDateFrom) setOverrideDateFrom(intent.detectedDateFrom);
                      if (intent.detectedDateTo) setOverrideDateTo(intent.detectedDateTo);
                    }}
                  >
                    Use &ldquo;{intent.detectedPeriod}&rdquo;
                    {intent.detectedDateFrom ? ` (${intent.detectedDateFrom} → ${intent.detectedDateTo})` : ''}
                  </button>
                  <button
                    className={`builder-range-chip${!useRequestPeriod ? ' active' : ''}`}
                    onClick={() => { setUseRequestPeriod(false); setOverrideDateFrom(null); setOverrideDateTo(null); }}
                  >
                    Keep Last {selectedMonths}M
                  </button>
                </div>
              </div>
            )}

            <div className="plan-grid">
              <div className="plan-item plan-item-full">
                <label>Report title <span className="plan-label-hint">(editable)</span></label>
                <input
                  className="plan-title-input"
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  placeholder="Report title"
                />
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
                <div>{filters.dateFrom} → {filters.dateTo}</div>
              </div>
            </div>

            {/* Org picker — auto-triggered when AI detects an org mention */}
            {(intent.detectedOrgName || intent.filters?.salesOrgId) && (
              <div className="plan-org-picker">
                <div className="plan-org-picker-label">
                  <Icon name="target" size={13} />
                  Sales org filter — AI detected: <strong>{intent.detectedOrgName || intent.filters.salesOrgId}</strong>
                </div>
                {/* If AI returned comma-separated org IDs, show them directly as chips without needing C4C lookup */}
                {orgMatches.length === 0 && intent.filters?.salesOrgId?.includes(',') ? (
                  <div>
                    <p className="plan-org-nomatch" style={{ marginBottom: 6 }}>
                      AI identified these org IDs — filter will apply all of them:
                    </p>
                    <div className="plan-org-chips">
                      {intent.filters.salesOrgId.split(',').map((id) => (
                        <span key={id} className="plan-chip">{id.trim()}</span>
                      ))}
                    </div>
                  </div>
                ) : orgMatches.length === 0 ? (
                  <p className="plan-org-nomatch">
                    No exact org match found in C4C — filter will use name matching.
                  </p>
                ) : (
                  <div className="plan-org-chips">
                    <button
                      className={`builder-range-chip${!selectedOrgId ? ' active' : ''}`}
                      onClick={() => { setSelectedOrgId(''); setSelectedOrgName(''); }}
                    >
                      All orgs
                    </button>
                    {orgMatches.map((org) => (
                      <button
                        key={org.id}
                        className={`builder-range-chip${selectedOrgId === org.id ? ' active' : ''}`}
                        onClick={() => { setSelectedOrgId(org.id); setSelectedOrgName(org.name); }}
                      >
                        {org.name}
                      </button>
                    ))}
                  </div>
                )}
                {selectedOrgId && (
                  <p className="plan-org-selected">
                    <Icon name="check-circle" size={13} /> Filtering to: <strong>{selectedOrgName}</strong>
                  </p>
                )}
              </div>
            )}

            {/* Clarification required */}
            {intent.clarificationNeeded && intent.clarificationQuestion && (
              <div className="date-conflict-banner">
                <Icon name="alert-triangle" size={15} />
                <span><strong>Clarification needed:</strong> {intent.clarificationQuestion}</span>
              </div>
            )}

            {error && <EmptyState title="Build failed" message={error.message} error />}
            <div className="plan-actions">
              <button className="btn btn-ghost" onClick={restart}>
                <Icon name="edit" size={15} />
                Refine request
              </button>
              <button className="btn" onClick={build} disabled={!!intent.clarificationNeeded}>
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
      {step === 3 && result && (() => {
        const isTable = intent?.chartType === 'table' || (!result.charts?.length && table.rows.length > 0);
        const PREVIEW_LIMIT = 50;
        const categorySuggestions = result.rawData?.['opportunities/items']?.categorySuggestions || [];

        const retryWithSuggestion = (keyword, suggestion) => {
          const corrected = request.replace(new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), suggestion);
          restart();
          setTimeout(() => plan(corrected), 0);
        };

        return (
          <>
            {categorySuggestions.length > 0 && (
              <div className="date-conflict-banner" style={{ marginBottom: 12 }}>
                <Icon name="alert-triangle" size={15} />
                <div>
                  <strong>0 records found.</strong> Did you mean one of these product categories?
                  {categorySuggestions.map(({ keyword, suggestions }) => (
                    <div key={keyword} style={{ marginTop: 6 }}>
                      <span style={{ opacity: 0.7, fontSize: 12 }}>&ldquo;{keyword}&rdquo; →</span>{' '}
                      {suggestions.map((s) => (
                        <button
                          key={s}
                          className="builder-range-chip"
                          style={{ marginLeft: 6 }}
                          onClick={() => retryWithSuggestion(keyword, s)}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="card chart-card">
              <div className="chart-card-header">
                <div>
                  <div className="chart-card-title">{result.title}</div>
                  {result.summary && <div className="chart-card-subtitle">{result.summary}</div>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {!isTable && table.rows.length > 0 && (
                    <button className="btn btn-ghost" onClick={() => setShowData((v) => !v)}>
                      <Icon name={showData ? 'eye-off' : 'eye'} size={15} />
                      {showData ? 'Hide data' : 'Show data'}
                    </button>
                  )}
                  {isTable && table.rows.length > 0 && (
                    <button className="btn btn-ghost" onClick={() => exportCsv(table.columns, table.rows, `${(result.title || 'quotes').replace(/\s+/g, '-').toLowerCase()}.csv`)}>
                      <Icon name="download" size={15} />
                      Export CSV ({table.total.toLocaleString()} records)
                    </button>
                  )}
                  {!isTable && (
                    <button className="btn btn-ghost" onClick={exportPng}>
                      <Icon name="download" size={15} />
                      Export PNG
                    </button>
                  )}
                  <button className="btn btn-ghost" onClick={restart}>
                    <Icon name="sparkles" size={15} />
                    New report
                  </button>
                </div>
              </div>

              {/* Table mode */}
              {isTable ? (
                <div>
                  {table.total > PREVIEW_LIMIT && (
                    <div className="date-conflict-banner" style={{ marginBottom: 12 }}>
                      <Icon name="alert-triangle" size={15} />
                      <span>
                        <strong>{table.total.toLocaleString()} records</strong> found — showing first {PREVIEW_LIMIT}. Use <strong>Export CSV</strong> to download all.
                      </span>
                    </div>
                  )}
                  <div style={{ overflowX: 'auto' }}>
                    <DataTable columns={table.columns} data={table.rows.slice(0, PREVIEW_LIMIT)} pageSize={PREVIEW_LIMIT} />
                  </div>
                </div>
              ) : (
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
              )}
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

            {!isTable && showData && table.rows.length > 0 && (
              <div className="card">
                <div className="chart-card-title" style={{ marginBottom: 10 }}>Data</div>
                <DataTable columns={table.columns} data={table.rows} pageSize={50} />
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}
