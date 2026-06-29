import { useState } from 'react';
import { subMonths } from 'date-fns';
import useAuth from '../auth/useAuth';
import useFilters, { toApiFilters } from '../hooks/useFilters';
import useAnalytics from '../hooks/useAnalytics';
import { getBriefStats, planBrief, generateBrief } from '../api/dashboard';
import { getSalesOrgs } from '../api/analytics';
import EmptyState from '../components/ui/EmptyState';
import Icon from '../components/ui/Icon';
import { fmtNumber, fmtCurrency, fmtDate, isoDate } from '../utils/formatters';

const BRIEF_DATE_PRESETS = [
  { label: 'Last 1M', months: 1 },
  { label: 'Last 3M', months: 3 },
  { label: 'Last 6M', months: 6, default: true },
  { label: 'Last 1Y', months: 12 },
];

const AUDIENCES = [
  { id: 'board', icon: 'briefcase', label: 'Board / Executive', desc: 'Strategic overview, revenue focus' },
  { id: 'regional', icon: 'target', label: 'Regional Manager', desc: 'Operational detail, owner performance' },
  { id: 'customer', icon: 'users', label: 'Customer Meeting', desc: 'Value-oriented, opportunity focused' },
  { id: 'team', icon: 'check-circle', label: 'Sales Team', desc: 'Win rates, pipeline health, motivation' },
  { id: 'territory', icon: 'funnel', label: 'Territory Review', desc: 'Org breakdown, geographic performance' },
  { id: 'investor', icon: 'trending-up', label: 'Investor / Stakeholder', desc: 'Growth story, pipeline momentum' },
];

function StatTile({ value, label, exact = true }) {
  // Fail-closed: never show a figure we can't guarantee is exact.
  if (!exact) {
    return (
      <div className="brief-stat" title="This date range exceeds the live record limit — narrow it for an exact figure.">
        <div className="brief-stat-value" style={{ color: 'var(--text-muted)' }}>–</div>
        <div className="brief-stat-label">{label}</div>
      </div>
    );
  }
  return (
    <div className="brief-stat">
      <div className="brief-stat-value">{value}</div>
      <div className="brief-stat-label">{label}</div>
    </div>
  );
}

export default function SalesBrief() {
  const { user } = useAuth();
  const { filters: globalFilters } = useFilters();
  const [selectedMonths, setSelectedMonths] = useState(6);
  const [audience, setAudience] = useState('board');
  const [intent, setIntent] = useState('');
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState(null);
  const [orgMatches, setOrgMatches] = useState([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [selectedOrgName, setSelectedOrgName] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const now = new Date();
  const filters = {
    ...globalFilters,
    dateFrom: isoDate(subMonths(now, selectedMonths)),
    dateTo: isoDate(now),
  };

  const stats = useAnalytics(() => getBriefStats(toApiFilters(filters)), [selectedMonths]);
  const s = stats.data;
  // exactness defaults to true when the API doesn't supply a flag (older builds)
  const ex = (key) => s?.exact?.[key] !== false;

  const analyze = async () => {
    setPlanning(true);
    setError(null);
    setPlan(null);
    setOrgMatches([]);
    setSelectedOrgId('');
    setSelectedOrgName('');
    try {
      const res = await planBrief(audience, intent.trim() || undefined, toApiFilters(filters));
      setPlan(res.plan);
      // Search for orgs whenever AI detected a keyword OR raised a scope warning
      const keyword = res.plan.detectedOrgKeyword || (res.plan.scopeWarning ? intent.trim() : null);
      if (keyword) {
        const orgs = await getSalesOrgs(keyword);
        setOrgMatches(orgs || []);
      }
    } catch (err) {
      setError(err);
    } finally {
      setPlanning(false);
    }
  };

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const activeFilters = {
        ...toApiFilters(filters),
        ...(selectedOrgId ? { salesOrgId: selectedOrgId } : {}),
      };
      const res = await generateBrief(audience, intent.trim() || undefined, activeFilters);
      setResult(res);
    } catch (err) {
      setError(err);
    } finally {
      setGenerating(false);
    }
  };

  // ---------- Generated brief (print-ready document) ----------
  if (result) {
    const { brief } = result;
    const audienceLabel = AUDIENCES.find((a) => a.id === audience)?.label || audience;
    return (
      <div className="page">
        <div className="brief-toolbar no-print">
          <button className="btn btn-ghost" onClick={() => setResult(null)}>
            <Icon name="arrow-left" size={15} />
            New brief
          </button>
          <button className="btn" onClick={() => window.print()}>
            <Icon name="download" size={15} />
            Print / Save as PDF
          </button>
        </div>

        <div className="brief-doc" id="brief-doc">
          <div className="brief-doc-header">
            <div className="brand-logo">TSS</div>
            <div className="brief-doc-meta">
              <span>Trelleborg Sealing Solutions</span>
              <span>
                {audienceLabel} · Prepared by {user?.name || user?.username} · {fmtDate(new Date())}
              </span>
              <span>Period: {filters.dateFrom} → {filters.dateTo}</span>
            </div>
          </div>

          <h1 className="brief-title">{brief.title}</h1>
          {brief.subtitle && <p className="brief-subtitle">{brief.subtitle}</p>}

          {brief.keyMetrics?.length > 0 && (
            <div className="brief-metrics">
              {brief.keyMetrics.map((m, i) => (
                <StatTile key={i} value={m.value} label={m.label} />
              ))}
            </div>
          )}

          {(brief.sections || []).map((section, i) => (
            <div className="brief-section" key={i}>
              <h2>{section.heading}</h2>
              {section.body && <p>{section.body}</p>}
              {section.bullets?.length > 0 && (
                <ul>
                  {section.bullets.map((b, j) => (
                    <li key={j}>{b}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          {brief.keyTakeaways?.length > 0 && (
            <div className="brief-takeaways">
              <h2>Key Takeaways</h2>
              <ul>
                {brief.keyTakeaways.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="brief-footer">
            Generated from live C4C data ({fmtNumber(s?.totalOpportunities)} opportunities,{' '}
            {fmtNumber(s?.totalQuotes)} quotes) · {fmtDate(new Date())}
          </div>
        </div>
      </div>
    );
  }

  // ---------- Setup screen ----------
  return (
    <div className="page builder-page">
      <div className="builder-range-bar">
        <Icon name="calendar" size={14} style={{ color: 'var(--text-secondary)' }} />
        <span className="builder-range-label">Data range:</span>
        {BRIEF_DATE_PRESETS.map((p) => (
          <button
            key={p.months}
            className={`builder-range-chip${selectedMonths === p.months ? ' active' : ''}`}
            onClick={() => setSelectedMonths(p.months)}
            disabled={generating}
          >
            {p.label}
          </button>
        ))}
        <span className="builder-range-hint">
          {filters.dateFrom} → {filters.dateTo}
        </span>
      </div>
      <div className="builder-hero" style={{ paddingBottom: 0 }}>
        <div className="builder-badge">
          <Icon name="file-text" size={13} />
          AI SALES BRIEF GENERATOR
        </div>
        <h1>Who is this brief for?</h1>
        <p>
          Select your audience, describe your intent, and AI will generate a tailored,
          print-ready sales brief from live C4C data — scoped to what you are authorized to see.
        </p>
      </div>

      <div className="brief-setup card">
        <label className="brief-setup-label">Audience</label>
        <div className="audience-grid">
          {AUDIENCES.map((a) => (
            <button
              key={a.id}
              className={`audience-card${audience === a.id ? ' selected' : ''}`}
              onClick={() => { setAudience(a.id); setPlan(null); }}
            >
              <div className="audience-icon">
                <Icon name={a.icon} size={20} />
              </div>
              <div className="audience-label">{a.label}</div>
              <div className="audience-desc">{a.desc}</div>
            </button>
          ))}
        </div>

        <label className="brief-setup-label">
          What do you want to communicate? <span>(optional)</span>
        </label>
        <textarea
          className="builder-textarea"
          style={{ border: '1px solid var(--field-border)', borderRadius: 10, minHeight: 80 }}
          placeholder={'e.g. "Highlight our strong Q3 pipeline and address the stale deals risk" or leave blank for a full overview'}
          value={intent}
          onChange={(e) => { setIntent(e.target.value); setPlan(null); }}
        />

        <label className="brief-setup-label">Data included in this brief</label>
        {stats.loading ? (
          <div className="brief-stats">
            {Array.from({ length: 8 }).map((_, i) => (
              <div className="brief-stat" key={i}>
                <div className="skeleton" style={{ height: 24, width: '60%', margin: '0 auto 6px' }} />
                <div className="skeleton" style={{ height: 10, width: '80%', margin: '0 auto' }} />
              </div>
            ))}
          </div>
        ) : stats.error ? (
          <EmptyState title="Could not load data" message={stats.error.message} error />
        ) : (
          <div className="brief-stats">
            <StatTile value={fmtNumber(s?.totalOpportunities)} label="Total opportunities" exact={ex('totalOpportunities')} />
            <StatTile value={fmtCurrency(s?.openPipelineValue)} label="Open pipeline" exact={ex('openPipelineValue')} />
            <StatTile value={s?.winRate != null ? `${s.winRate}%` : '–'} label="Win rate" exact={ex('winRate')} />
            <StatTile value={fmtCurrency(s?.sopNext12MValue)} label="SOP next 12 months" exact={ex('sopNext12MValue')} />
            <StatTile value={fmtNumber(s?.openDeals)} label="Open deals" exact={ex('openDeals')} />
            <StatTile value={fmtNumber(s?.wonCount)} label="Won" exact={ex('wonCount')} />
            <StatTile value={fmtNumber(s?.staleCount)} label="Stale >90 days" exact={ex('staleCount')} />
            <StatTile value={`${fmtNumber(s?.orgCount)} orgs · ${fmtNumber(s?.ownerCount)} owners`} label="Coverage" exact={ex('orgCount') && ex('ownerCount')} />
          </div>
        )}

        {/* AI understanding panel — shown after Analyze */}
        {plan && (
          <div className="plan-explanation" style={{ marginTop: 16 }}>
            <div className="plan-explanation-label">
              <Icon name="sparkles" size={13} />
              AI understood this as
            </div>
            <p style={{ marginBottom: 8 }}>{plan.understanding}</p>

            {/* Org picker — shown when AI detected an org mention or raised a scope warning */}
            {(plan.detectedOrgKeyword || plan.scopeWarning) && (
              <div style={{ marginTop: 10, padding: '10px 14px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                  <Icon name="target" size={12} style={{ marginRight: 5 }} />
                  Select matching sales org to filter data
                </div>
                {orgMatches.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
                    No orgs found matching &ldquo;{plan.detectedOrgKeyword}&rdquo; — brief will cover all orgs.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
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
                  <p style={{ fontSize: 12, color: 'var(--success)', marginTop: 8, marginBottom: 0 }}>
                    Brief will be filtered to: <strong>{selectedOrgName}</strong>
                  </p>
                )}
              </div>
            )}

            {plan.clarificationNeeded && plan.clarificationQuestion && (
              <p style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(0,112,242,0.06)', border: '1px solid rgba(0,112,242,0.18)', borderRadius: 8, fontSize: 13, marginBottom: 0 }}>
                <strong>Clarification needed:</strong> {plan.clarificationQuestion}
              </p>
            )}
          </div>
        )}

        {error && <EmptyState title="Brief generation failed" message={error.message} error />}

        <div className="brief-setup-footer">
          <span className="builder-hint">
            {stats.loading ? 'Loading data…' : `${fmtNumber(s?.totalOpportunities)} records loaded from C4C`}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {plan && (
              <button className="btn btn-ghost" onClick={() => { setPlan(null); setOrgMatches([]); setSelectedOrgId(''); setSelectedOrgName(''); }} disabled={generating}>
                <Icon name="edit" size={15} />
                Refine
              </button>
            )}
            {!plan ? (
              <button className="btn" onClick={analyze} disabled={planning || stats.loading}>
                <Icon name="sparkles" size={15} className={planning ? 'spinning' : undefined} />
                {planning ? 'Analyzing…' : 'Analyze & Review'}
              </button>
            ) : (
              <button className="btn" onClick={generate} disabled={generating || plan.clarificationNeeded}>
                <Icon name="file-text" size={15} className={generating ? 'spinning' : undefined} />
                {generating ? 'Writing brief…' : 'Generate Brief'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
