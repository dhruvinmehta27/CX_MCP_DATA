import Icon from '../ui/Icon';
import { fmtCurrency, fmtNumber } from '../../utils/formatters';

/**
 * Executive KPI strip shown above every pipeline view. Nine headline numbers
 * with a hover tooltip explaining each metric's definition.
 */
const fmtDays = (d) => (d == null ? '–' : `${fmtNumber(d)} d`);
const fmtPct = (p) => (p == null ? '–' : `${p}%`);

function Kpi({ label, value, hint, icon, accent = 'primary' }) {
  return (
    <div className={`kpi-tile kpi-${accent}`} title={hint}>
      <div className="kpi-tile-head">
        <span className="kpi-tile-label">{label}</span>
        <Icon name={icon} size={15} />
      </div>
      <div className="kpi-tile-value">{value}</div>
    </div>
  );
}

export default function KpiHeader({ kpis, loading }) {
  if (loading || !kpis) {
    return (
      <div className="kpi-header">
        {Array.from({ length: 9 }).map((_, i) => (
          <div className="kpi-tile" key={i}>
            <div className="skeleton" style={{ height: 11, width: '70%', marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 22, width: '55%' }} />
          </div>
        ))}
      </div>
    );
  }
  const k = kpis;
  return (
    <div className="kpi-header">
      <Kpi label="Total Pipeline" value={fmtCurrency(k.totalPipelineValue)} icon="banknote" hint="Sum of expected value across all open opportunities." />
      <Kpi label="Weighted Pipeline" value={fmtCurrency(k.weightedPipelineValue)} icon="target" accent="teal" hint="Open expected value × win probability." />
      <Kpi label="Open Opportunities" value={fmtNumber(k.openOpportunities)} icon="briefcase" hint="Count of opportunities not yet won or lost." />
      <Kpi label="Avg Deal Size" value={fmtCurrency(k.avgDealSize)} icon="trending-up" hint="Total open pipeline ÷ open opportunity count." />
      <Kpi label="Win Rate" value={fmtPct(k.winRate)} icon="check-circle" accent="success" hint="Won ÷ (Won + Lost) over the selected period." />
      <Kpi label="Avg Sales Cycle" value={fmtDays(k.avgSalesCycleDays)} icon="clock" hint="Average days from creation to close for closed deals." />
      <Kpi label="Forecast (This Q)" value={fmtCurrency(k.forecastThisQuarter)} icon="calendar" accent="warning" hint="Weighted value of open deals expected to close this quarter." />
      <Kpi label="Closed Won" value={fmtCurrency(k.closedWonValue)} icon="check-circle" accent="success" hint="Total value of won opportunities in the selected period." />
      <Kpi label="Closed Lost" value={fmtCurrency(k.closedLostValue)} icon="close" accent="danger" hint="Total value of lost opportunities in the selected period." />
    </div>
  );
}
