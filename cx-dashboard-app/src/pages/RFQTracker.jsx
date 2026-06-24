import { useMemo, useState } from 'react';
import { addDays } from 'date-fns';
import useFilters, { toApiFilters } from '../hooks/useFilters';
import useAnalytics from '../hooks/useAnalytics';
import { getRFQsByStatus, getRFQsTrend, getRFQsList } from '../api/analytics';
import MetricCard from '../components/ui/MetricCard';
import ChartCard from '../components/ui/ChartCard';
import DataTable from '../components/ui/DataTable';
import PieChart from '../components/charts/PieChart';
import LineChart from '../components/charts/LineChart';
import Icon from '../components/ui/Icon';
import { CHART_COLORS } from '../utils/colors';
import { fmtNumber, fmtDate, fmtMonth } from '../utils/formatters';

const SCOPES = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Closed' },
];

export default function RFQTracker() {
  const { filters, version } = useFilters();
  const api = toApiFilters(filters);
  const [scope, setScope] = useState('open');
  const [query, setQuery] = useState('');

  const byStatus = useAnalytics(() => getRFQsByStatus(api), [version]);
  const trend = useAnalytics(() => getRFQsTrend({ ...api, months: 6 }), [version]);
  // Scope is filtered server-side so the table reflects the true Open/Closed set
  // (not whatever fell into a capped sample); refetch when the scope changes.
  const list = useAnalytics(() => getRFQsList({ ...api, limit: 20000, scope }), [version, scope]);

  const d = list.data;
  const rows = useMemo(() => {
    const all = d?.rows || [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) =>
      `${r.id || ''} ${r.name || ''} ${r.account || ''} ${r.owner || ''} ${r.status || ''}`.toLowerCase().includes(q)
    );
  }, [d, query]);

  const rowClassName = (row) => {
    if (!row.open || !row.dueDate) return undefined;
    const due = new Date(row.dueDate);
    const now = new Date();
    if (due < now) return 'row-overdue';
    if (due <= addDays(now, 7)) return 'row-due-soon';
    return undefined;
  };

  return (
    <div className="page">
      <div className="grid grid-4">
        <MetricCard title="Open RFQs" icon="inbox" loading={list.loading} value={fmtNumber(d?.openCount)} subtitle="Not yet Confirmed or Rejected" />
        <MetricCard title="Closed RFQs" icon="check-circle" accent="success" loading={list.loading} value={fmtNumber(d?.closedCount)} subtitle="Confirmed or Rejected" />
        <MetricCard
          title="Overdue (open)"
          icon="alert-triangle"
          loading={list.loading}
          value={fmtNumber(d?.overdueCount)}
          accent={d?.overdueCount > 0 ? 'danger' : 'primary'}
          colorValue={d?.overdueCount > 0}
        />
        <MetricCard title="Due This Week" icon="calendar" accent="warning" loading={list.loading} value={fmtNumber(d?.dueThisWeekCount)} />
      </div>

      <div className="grid grid-2">
        <ChartCard title="RFQs by Status" subtitle="Closed = Confirmed or Rejected" loading={byStatus.loading} error={byStatus.error} onRefresh={byStatus.refetch}>
          {byStatus.data && <PieChart data={byStatus.data} nameKey="status" valueKey="count" />}
        </ChartCard>
        <ChartCard title="RFQ Volume Trend" subtitle="Created per month" loading={trend.loading} error={trend.error} onRefresh={trend.refetch}>
          {trend.data && (
            <LineChart
              data={trend.data.map((dd) => ({ ...dd, month: fmtMonth(dd.month) }))}
              xKey="month"
              lines={[{ key: 'count', color: CHART_COLORS[0], label: 'RFQs' }]}
            />
          )}
        </ChartCard>
      </div>

      <div className="rfq-scope">
        <Icon name="funnel" size={14} />
        <span className="rfq-scope-label">Show</span>
        {SCOPES.map((s) => {
          const n = s.id === 'open' ? d?.openCount : s.id === 'closed' ? d?.closedCount : d?.total;
          return (
            <button key={s.id} className={`chip${scope === s.id ? ' chip-on' : ''}`} onClick={() => setScope(s.id)}>
              {s.label}
              {d && n != null && <span className="rfq-scope-count">{fmtNumber(n)}</span>}
            </button>
          );
        })}
        <div className="board-search rfq-search">
          <Icon name="search" size={15} />
          <input
            className="board-search-input"
            placeholder="Search ID, name, account, owner…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="board-search-clear" onClick={() => setQuery('')} title="Clear">
              <Icon name="close" size={13} />
            </button>
          )}
        </div>
      </div>

      <ChartCard
        title={`${SCOPES.find((s) => s.id === scope).label} RFQs`}
        subtitle={
          d
            ? `${fmtNumber(rows.length)}${query ? ' matching' : ' shown'} of ${fmtNumber(d.matching ?? d.total)} ${scope === 'all' ? 'total' : scope} · red = overdue, yellow = due within 7 days`
            : undefined
        }
        loading={list.loading}
        error={list.error}
        onRefresh={list.refetch}
      >
        <DataTable
          pageSize={50}
          rowClassName={rowClassName}
          columns={[
            { key: 'id', label: 'ID' },
            { key: 'name', label: 'Name' },
            { key: 'account', label: 'Account' },
            { key: 'status', label: 'Status', type: 'status' },
            { key: 'open', label: 'State', render: (v) => (v ? 'Open' : 'Closed') },
            { key: 'dueDate', label: 'Due Date', type: 'date', render: (v) => fmtDate(v) },
            { key: 'owner', label: 'Owner' },
            { key: 'created', label: 'Created', type: 'date', render: (v) => fmtDate(v) },
          ]}
          data={rows}
        />
      </ChartCard>
    </div>
  );
}
