import { useMemo } from 'react';
import useFilters, { toApiFilters } from '../hooks/useFilters';
import useAnalytics from '../hooks/useAnalytics';
import {
  getQuotesByStatus, getQuotesTrend, getTopCustomers,
  getQuotesByBizType, getQuotesBySalesOrg, getQuotesList,
} from '../api/analytics';
import MetricCard from '../components/ui/MetricCard';
import ChartCard from '../components/ui/ChartCard';
import DataTable from '../components/ui/DataTable';
import PieChart from '../components/charts/PieChart';
import LineChart from '../components/charts/LineChart';
import BarChart from '../components/charts/BarChart';
import { fmtNumber, fmtCurrency, fmtCurrencyFull, fmtPercent, fmtDate, fmtMonth } from '../utils/formatters';

export default function QuoteAnalytics() {
  const { filters, version } = useFilters();
  const api = toApiFilters(filters);

  const byStatus = useAnalytics(() => getQuotesByStatus(api), [version]);
  const trend = useAnalytics(() => getQuotesTrend({ ...api, months: 6 }), [version]);
  const topCustomers = useAnalytics(() => getTopCustomers({ ...api, limit: 10 }), [version]);
  const byBizType = useAnalytics(() => getQuotesByBizType(api), [version]);
  const bySalesOrg = useAnalytics(() => getQuotesBySalesOrg({ ...api, limit: 15 }), [version]);
  const list = useAnalytics(() => getQuotesList({ ...api, limit: 1000 }), [version]);

  const kpis = useMemo(() => {
    const rows = byStatus.data || [];
    const totalQuotes = rows.reduce((a, r) => a + r.count, 0);
    const totalValue = rows.reduce((a, r) => a + r.totalAmount, 0);
    const won = rows.filter((r) => /won|accept/i.test(r.status)).reduce((a, r) => a + r.count, 0);
    const lost = rows.filter((r) => /lost|reject/i.test(r.status)).reduce((a, r) => a + r.count, 0);
    const closed = won + lost;
    return {
      totalQuotes,
      totalValue,
      avgValue: totalQuotes ? totalValue / totalQuotes : 0,
      winRate: closed ? (won / closed) * 100 : null,
    };
  }, [byStatus.data]);

  return (
    <div className="page">
      <div className="grid grid-4">
        <MetricCard title="Total Quotes" icon="📄" loading={byStatus.loading} value={fmtNumber(kpis.totalQuotes)} />
        <MetricCard title="Total Quote Value" icon="💶" loading={byStatus.loading} value={fmtCurrency(kpis.totalValue)} />
        <MetricCard title="Average Quote Value" icon="⌀" loading={byStatus.loading} value={fmtCurrency(kpis.avgValue)} />
        <MetricCard
          title="Win Rate"
          icon="🏆"
          loading={byStatus.loading}
          value={kpis.winRate == null ? '–' : fmtPercent(kpis.winRate)}
          subtitle="Won / total closed"
        />
      </div>

      <div className="grid grid-2">
        <ChartCard title="Quotes by Status" loading={byStatus.loading} error={byStatus.error} onRefresh={byStatus.refetch}>
          {byStatus.data && <PieChart data={byStatus.data} nameKey="status" valueKey="count" />}
        </ChartCard>
        <ChartCard title="Quote Trend" subtitle="Last 6 months" loading={trend.loading} error={trend.error} onRefresh={trend.refetch}>
          {trend.data && (
            <LineChart
              data={trend.data.map((d) => ({ ...d, month: fmtMonth(d.month) }))}
              xKey="month"
              lines={[
                { key: 'count', color: '#E4002B', label: 'Quotes' },
              ]}
            />
          )}
        </ChartCard>
      </div>

      <div className="grid grid-2">
        <ChartCard title="Top 10 Customers" subtitle="By quote value" loading={topCustomers.loading} error={topCustomers.error} onRefresh={topCustomers.refetch}>
          {topCustomers.data && (
            <BarChart
              data={topCustomers.data}
              xKey="customer"
              bars={[{ key: 'totalAmount', color: '#45B7D1', label: 'Value' }]}
              layout="vertical"
              valueFormatter={(v) => fmtCurrency(v)}
            />
          )}
        </ChartCard>
        <ChartCard title="Quotes by Business Type" subtitle="New / Follow-up / Replacement" loading={byBizType.loading} error={byBizType.error} onRefresh={byBizType.refetch}>
          {byBizType.data && (
            <BarChart
              data={byBizType.data}
              xKey="bizType"
              bars={[{ key: 'count', label: 'Quotes' }]}
              colorByEntry
            />
          )}
        </ChartCard>
      </div>

      <ChartCard title="Quotes by Sales Org" subtitle="Top 15 by value" loading={bySalesOrg.loading} error={bySalesOrg.error} onRefresh={bySalesOrg.refetch}>
        {bySalesOrg.data && (
          <BarChart
            data={bySalesOrg.data}
            xKey="salesOrg"
            bars={[{ key: 'totalAmount', color: '#E4002B', label: 'Value' }]}
            valueFormatter={(v) => fmtCurrency(v)}
          />
        )}
      </ChartCard>

      <ChartCard
        title="All Quotes"
        subtitle={list.data ? `${fmtNumber(list.data.total)} total · showing latest ${fmtNumber(list.data.rows.length)}` : undefined}
        loading={list.loading}
        error={list.error}
        onRefresh={list.refetch}
      >
        <DataTable
          pageSize={50}
          columns={[
            { key: 'id', label: 'ID' },
            { key: 'customer', label: 'Customer' },
            { key: 'salesOrg', label: 'Sales Org' },
            { key: 'status', label: 'Status', type: 'status' },
            { key: 'amount', label: 'Value', type: 'currency', render: (v, r) => fmtCurrencyFull(v, r.currency) },
            { key: 'created', label: 'Date', type: 'date', render: (v) => fmtDate(v) },
            { key: 'owner', label: 'Owner' },
          ]}
          data={list.data?.rows || []}
        />
      </ChartCard>
    </div>
  );
}
