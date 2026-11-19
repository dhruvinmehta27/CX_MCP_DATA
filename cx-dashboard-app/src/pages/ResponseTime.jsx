import useFilters, { toApiFilters } from '../hooks/useFilters';
import useAnalytics from '../hooks/useAnalytics';
import { getResponseTime } from '../api/analytics';
import MetricCard from '../components/ui/MetricCard';
import ChartCard from '../components/ui/ChartCard';
import BarChart from '../components/charts/BarChart';
import LineChart from '../components/charts/LineChart';
import Icon from '../components/ui/Icon';
import { CHART_COLORS } from '../utils/colors';
import { fmtNumber, fmtMonth } from '../utils/formatters';

const fmtDays = (v) => (v == null ? '–' : `${fmtNumber(v)} d`);

/**
 * Quote Response Time — cycle/throughput view modelled on the SAP "Central
 * Analysis and Reporting System" screen. See the note banner: true per-phase
 * durations aren't in live C4C, so phase splits that need transition
 * timestamps are not shown; everything here is derived from creation and
 * close (≈ last-change) timestamps we can verify.
 */
export default function ResponseTime() {
  const { filters, version } = useFilters();
  const api = toApiFilters(filters);
  const rt = useAnalytics(() => getResponseTime({ ...api, months: 12 }), [version]);

  const d = rt.data;
  const truncated = Boolean(d?.truncated);
  const t = d?.tiles;

  return (
    <div className="page">
      <div className="page-note">
        <Icon name="bulb" size={16} />
        <span>
          Throughput is computed from the timestamps live C4C exposes — deal
          <strong> creation</strong> and <strong>close</strong> (≈ last change).
          Per-phase durations (Solution Phase, RFQ Processing, Quote Prep) need
          phase transition timestamps that C4C OData doesn’t return, so those
          splits aren’t shown here. The phase chart below is <em>age of open
          deals by their current phase</em>, not time-spent-in-phase.
        </span>
      </div>

      <div className="grid grid-3">
        <MetricCard
          title="Opportunity Cycle"
          icon="clock"
          loading={rt.loading}
          exact={!truncated}
          value={fmtDays(t?.opportunityCycle?.days)}
          subtitle={t ? `Creation → close · ${fmtNumber(t.opportunityCycle.n)} closed deals` : undefined}
          colorValue
        />
        <MetricCard
          title="Won Deals"
          icon="check-circle"
          accent="success"
          loading={rt.loading}
          exact={!truncated}
          value={fmtDays(t?.wonCycle?.days)}
          subtitle={t ? `Creation → win · ${fmtNumber(t.wonCycle.n)} won deals` : undefined}
          colorValue
        />
        <MetricCard
          title="Open Pipeline Age"
          icon="trending-up"
          accent="warning"
          loading={rt.loading}
          exact={!truncated}
          value={fmtDays(t?.openAge?.days)}
          subtitle={t ? `Days since creation · ${fmtNumber(t.openAge.n)} open deals` : undefined}
          colorValue
        />
      </div>

      <ChartCard
        title="Age of open deals by current phase"
        subtitle="Average days since creation for opportunities sitting in each sales-cycle phase"
        loading={rt.loading}
        error={rt.error}
        onRefresh={rt.refetch}
      >
        {d && (
          <BarChart
            data={d.byPhase}
            xKey="phase"
            bars={[{ key: 'avgAgeDays', color: CHART_COLORS[0], label: 'Avg age' }]}
            valueFormatter={fmtDays}
          />
        )}
      </ChartCard>

      <div className="grid grid-2">
        <ChartCard
          title="Monthly cycle trend"
          subtitle="Average creation-to-close days, by close month (last 12 months)"
          loading={rt.loading}
          error={rt.error}
          onRefresh={rt.refetch}
        >
          {d && (
            <LineChart
              data={d.monthly.map((m) => ({ ...m, month: fmtMonth(m.month) }))}
              xKey="month"
              lines={[{ key: 'avgCycleDays', color: CHART_COLORS[1], label: 'Avg cycle' }]}
              valueFormatter={fmtDays}
            />
          )}
        </ChartCard>
        <ChartCard
          title="Throughput by account category"
          subtitle="Average cycle days by opportunity level (Level 0–3)"
          loading={rt.loading}
          error={rt.error}
          onRefresh={rt.refetch}
        >
          {d && (
            <BarChart
              data={d.byCategory}
              xKey="category"
              bars={[{ key: 'avgCycleDays', label: 'Avg cycle' }]}
              layout="vertical"
              colorByEntry
              valueFormatter={fmtDays}
            />
          )}
        </ChartCard>
      </div>
    </div>
  );
}
