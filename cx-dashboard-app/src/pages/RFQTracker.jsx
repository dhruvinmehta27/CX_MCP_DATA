import { useMemo } from 'react';
import { addDays } from 'date-fns';
import useFilters, { toApiFilters } from '../hooks/useFilters';
import useAnalytics from '../hooks/useAnalytics';
import { getRFQsByStatus, getRFQsTrend, getRFQsList } from '../api/analytics';
import MetricCard from '../components/ui/MetricCard';
import ChartCard from '../components/ui/ChartCard';
import DataTable from '../components/ui/DataTable';
import PieChart from '../components/charts/PieChart';
import LineChart from '../components/charts/LineChart';
import { fmtNumber, fmtDate, fmtMonth } from '../utils/formatters';

export default function RFQTracker() {
  const { filters, version } = useFilters();
  const api = toApiFilters(filters);

  const byStatus = useAnalytics(() => getRFQsByStatus(api), [version]);
  const trend = useAnalytics(() => getRFQsTrend({ ...api, months: 6 }), [version]);
  const list = useAnalytics(() => getRFQsList({ ...api, limit: 1000 }), [version]);

  const kpis = useMemo(() => {
    const rows = list.data?.rows || [];
    const now = new Date();
    const weekEnd = addDays(now, 7);
    const open = rows.filter((r) => r.open);
    return {
      open: open.length,
      overdue: open.filter((r) => r.dueDate && new Date(r.dueDate) < now).length,
      dueThisWeek: open.filter((r) => {
        if (!r.dueDate) return false;
        const d = new Date(r.dueDate);
        return d >= now && d <= weekEnd;
      }).length,
    };
  }, [list.data]);

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
      <div className="grid grid-3">
        <MetricCard title="Total Open RFQs" icon="📨" loading={list.loading} value={fmtNumber(kpis.open)} />
        <MetricCard
          title="Overdue RFQs"
          icon="🚨"
          loading={list.loading}
          value={fmtNumber(kpis.overdue)}
          color={kpis.overdue > 0 ? 'var(--primary)' : undefined}
        />
        <MetricCard title="Due This Week" icon="📅" loading={list.loading} value={fmtNumber(kpis.dueThisWeek)} />
      </div>

      <div className="grid grid-2">
        <ChartCard title="RFQs by Status" loading={byStatus.loading} error={byStatus.error} onRefresh={byStatus.refetch}>
          {byStatus.data && <PieChart data={byStatus.data} nameKey="status" valueKey="count" />}
        </ChartCard>
        <ChartCard title="RFQ Volume Trend" subtitle="Created per month" loading={trend.loading} error={trend.error} onRefresh={trend.refetch}>
          {trend.data && (
            <LineChart
              data={trend.data.map((d) => ({ ...d, month: fmtMonth(d.month) }))}
              xKey="month"
              lines={[{ key: 'count', color: '#E4002B', label: 'RFQs' }]}
            />
          )}
        </ChartCard>
      </div>

      <ChartCard
        title="RFQs"
        subtitle="Red = overdue · yellow = due within 7 days"
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
            { key: 'dueDate', label: 'Due Date', type: 'date', render: (v) => fmtDate(v) },
            { key: 'owner', label: 'Owner' },
            { key: 'created', label: 'Created', type: 'date', render: (v) => fmtDate(v) },
          ]}
          data={list.data?.rows || []}
        />
      </ChartCard>
    </div>
  );
}
