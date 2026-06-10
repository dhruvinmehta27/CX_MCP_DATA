import { useNavigate } from 'react-router-dom';
import useFilters, { toApiFilters } from '../hooks/useFilters';
import useAnalytics from '../hooks/useAnalytics';
import { getDailySummary } from '../api/analytics';
import MetricCard from '../components/ui/MetricCard';
import ChartCard from '../components/ui/ChartCard';
import DataTable from '../components/ui/DataTable';
import EmptyState from '../components/ui/EmptyState';
import BarChart from '../components/charts/BarChart';
import { fmtNumber, fmtCurrency, fmtDate } from '../utils/formatters';
import { CHART_COLORS } from '../utils/colors';

export default function DailyBriefing() {
  const navigate = useNavigate();
  const { filters, version } = useFilters();
  const { data, loading, error, refetch } = useAnalytics(
    () => getDailySummary(toApiFilters(filters)),
    [version]
  );

  const metrics = [
    { title: 'Open Quotes', value: fmtNumber(data?.openQuotes), icon: 'file-text', onClick: () => navigate('/quotes') },
    { title: 'Pipeline Value', value: fmtCurrency(data?.totalPipelineValue), icon: 'banknote', onClick: () => navigate('/pipeline') },
    { title: 'Open Opportunities', value: fmtNumber(data?.openOpportunities), icon: 'target', onClick: () => navigate('/pipeline') },
    {
      title: 'Overdue Tasks',
      value: fmtNumber(data?.overdueTasksCount),
      icon: 'clock',
      accent: data?.overdueTasksCount > 0 ? 'danger' : 'primary',
      colorValue: data?.overdueTasksCount > 0,
    },
    { title: 'Open RFQs', value: fmtNumber(data?.openRFQs), icon: 'inbox', onClick: () => navigate('/rfqs') },
    {
      title: "Today's Meetings",
      value: fmtNumber((data?.visitsToday || 0) + (data?.appointmentsToday || 0)),
      icon: 'calendar',
      subtitle: data ? `${data.visitsToday} visits · ${data.appointmentsToday} appointments` : undefined,
    },
  ];

  return (
    <div className="page">
      <div className="grid grid-6">
        {metrics.map((m) => (
          <MetricCard key={m.title} loading={loading} {...m} />
        ))}
      </div>

      <div className="grid grid-2">
        <ChartCard title="Quotes Created This Week" subtitle="Per day, last 7 days" loading={loading} error={error} onRefresh={refetch}>
          {data?.quotesByDay && (
            <BarChart
              data={data.quotesByDay.map((d) => ({ ...d, day: d.day.slice(5) }))}
              xKey="day"
              bars={[{ key: 'count', color: CHART_COLORS[0], label: 'Quotes' }]}
            />
          )}
        </ChartCard>
        <ChartCard title="Pipeline by Stage" subtitle="Open opportunities" loading={loading} error={error} onRefresh={refetch}>
          {data?.pipeline?.length ? (
            <BarChart
              data={data.pipeline}
              xKey="stage"
              bars={[{ key: 'count', color: CHART_COLORS[1], label: 'Opportunities' }]}
              layout="vertical"
            />
          ) : (
            !loading && <EmptyState title="No open opportunities" />
          )}
        </ChartCard>
      </div>

      <div className="grid grid-2">
        <ChartCard title="My Open Quotes" subtitle="Latest 10" loading={loading} error={error} onRefresh={refetch}>
          <DataTable
            pageSize={10}
            columns={[
              { key: 'id', label: 'ID' },
              { key: 'customer', label: 'Customer' },
              { key: 'status', label: 'Status', type: 'status' },
              { key: 'amount', label: 'Value', type: 'currency', render: (v, r) => fmtCurrency(v, r.currency) },
              { key: 'created', label: 'Created', type: 'date', render: (v) => fmtDate(v) },
            ]}
            data={data?.recentOpenQuotes || []}
          />
        </ChartCard>
        <ChartCard title="Today's Tasks" loading={loading} error={error} onRefresh={refetch}>
          {data?.todaysTasks?.length ? (
            <div className="task-list">
              {data.todaysTasks.map((t) => (
                <div className="task-item" key={t.id}>
                  <span className="task-dot" />
                  <span className="subject">{t.subject}</span>
                  {t.priority && <span className="meta">{t.priority}</span>}
                  {t.status && <span className="meta">{t.status}</span>}
                </div>
              ))}
            </div>
          ) : (
            !loading && <EmptyState icon="check-circle" title="No tasks due today" message="Enjoy the clear schedule." />
          )}
        </ChartCard>
      </div>
    </div>
  );
}
