import { useMemo } from 'react';
import useFilters, { toApiFilters } from '../hooks/useFilters';
import useAnalytics from '../hooks/useAnalytics';
import {
  getPipeline, getPipelineByOwner, getCloseTrend, getOpportunitiesList,
} from '../api/analytics';
import MetricCard from '../components/ui/MetricCard';
import ChartCard from '../components/ui/ChartCard';
import DataTable from '../components/ui/DataTable';
import FunnelChart from '../components/charts/FunnelChart';
import BarChart from '../components/charts/BarChart';
import AreaChart from '../components/charts/AreaChart';
import { CHART_COLORS } from '../utils/colors';
import { fmtNumber, fmtCurrency, fmtCurrencyFull, fmtDate, fmtMonth } from '../utils/formatters';

// Simple stage-position weighting: later stages → higher win probability
function stageWeight(index, total) {
  return total > 1 ? (index + 1) / total : 0.5;
}

export default function PipelineHealth() {
  const { filters, version } = useFilters();
  const api = toApiFilters(filters);

  const pipeline = useAnalytics(() => getPipeline(api), [version]);
  const byOwner = useAnalytics(() => getPipelineByOwner(api), [version]);
  const closeTrend = useAnalytics(() => getCloseTrend({ ...api, months: 6 }), [version]);
  const list = useAnalytics(() => getOpportunitiesList({ ...api, limit: 1000 }), [version]);

  const kpis = useMemo(() => {
    const stages = pipeline.data || [];
    const totalValue = stages.reduce((a, s) => a + s.totalValue, 0);
    const totalCount = stages.reduce((a, s) => a + s.count, 0);
    const weighted = stages.reduce(
      (a, s, i) => a + s.totalValue * stageWeight(i, stages.length),
      0
    );
    return {
      totalValue,
      weighted,
      avgDeal: totalCount ? totalValue / totalCount : 0,
    };
  }, [pipeline.data]);

  return (
    <div className="page">
      <div className="grid grid-3">
        <MetricCard title="Total Pipeline Value" icon="banknote" loading={pipeline.loading} value={fmtCurrency(kpis.totalValue)} />
        <MetricCard
          title="Weighted Pipeline"
          icon="target"
          loading={pipeline.loading}
          value={fmtCurrency(kpis.weighted)}
          subtitle="Value × stage probability"
        />
        <MetricCard title="Average Deal Size" icon="briefcase" loading={pipeline.loading} value={fmtCurrency(kpis.avgDeal)} />
      </div>

      <ChartCard title="Pipeline Funnel" subtitle="Count and value per stage" loading={pipeline.loading} error={pipeline.error} onRefresh={pipeline.refetch}>
        {pipeline.data && <FunnelChart stages={pipeline.data} />}
      </ChartCard>

      <div className="grid grid-2">
        <ChartCard title="Pipeline by Owner" subtitle="Top 20 by expected value" loading={byOwner.loading} error={byOwner.error} onRefresh={byOwner.refetch}>
          {byOwner.data && (
            <BarChart
              data={byOwner.data}
              xKey="owner"
              bars={[{ key: 'totalValue', color: CHART_COLORS[3], label: 'Expected value' }]}
              layout="vertical"
              valueFormatter={(v) => fmtCurrency(v)}
            />
          )}
        </ChartCard>
        <ChartCard title="Expected Close by Month" subtitle="Next 6 months" loading={closeTrend.loading} error={closeTrend.error} onRefresh={closeTrend.refetch}>
          {closeTrend.data && (
            <AreaChart
              data={closeTrend.data.map((d) => ({ ...d, month: fmtMonth(d.month) }))}
              xKey="month"
              areas={[{ key: 'totalValue', color: CHART_COLORS[1], label: 'Expected value' }]}
              valueFormatter={(v) => fmtCurrency(v)}
            />
          )}
        </ChartCard>
      </div>

      <ChartCard
        title="Opportunities"
        subtitle={list.data ? `${fmtNumber(list.data.total)} total · showing latest ${fmtNumber(list.data.rows.length)}` : undefined}
        loading={list.loading}
        error={list.error}
        onRefresh={list.refetch}
      >
        <DataTable
          pageSize={50}
          columns={[
            { key: 'id', label: 'ID' },
            { key: 'name', label: 'Name' },
            { key: 'account', label: 'Account' },
            { key: 'stage', label: 'Stage', type: 'status' },
            { key: 'expectedValue', label: 'Expected Value', type: 'currency', render: (v) => fmtCurrencyFull(v) },
            { key: 'expectedClose', label: 'Expected Close', type: 'date', render: (v) => fmtDate(v) },
            { key: 'owner', label: 'Owner' },
          ]}
          data={list.data?.rows || []}
        />
      </ChartCard>
    </div>
  );
}
