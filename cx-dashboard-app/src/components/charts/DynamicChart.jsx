import {
  ResponsiveContainer, ComposedChart, Bar, Line, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts';
import BarChart from './BarChart';
import LineChart from './LineChart';
import AreaChart from './AreaChart';
import PieChart from './PieChart';
import FunnelChart from './FunnelChart';
import EmptyState from '../ui/EmptyState';
import { chartColor } from '../../utils/colors';
import { tooltipStyle, axisStyle, gridStroke } from './chartTheme';

// Compact ticks for AI-generated charts where the value scale is unknown
const compact = (v) =>
  typeof v === 'number' && Math.abs(v) >= 1000
    ? Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
    : v;

/**
 * Renders a chartConfig produced by POST /api/dashboard/generate:
 * { chartType, data, xKey, yKeys: [{ key, color, label, type }], title }
 */
export default function DynamicChart({ config, height = 360 }) {
  if (!config || !Array.isArray(config.data) || config.data.length === 0) {
    return <EmptyState title="No chart data" message="The query returned no rows." />;
  }
  const { chartType, data, xKey } = config;
  const yKeys = (config.yKeys || []).map((y, i) =>
    typeof y === 'string' ? { key: y, color: chartColor(i) } : y
  );
  if (yKeys.length === 0 && chartType !== 'funnel') {
    return <EmptyState title="Invalid chart config" message="No yKeys provided." />;
  }

  switch (chartType) {
    case 'bar':
      return (
        <BarChart
          data={data}
          xKey={xKey}
          bars={yKeys}
          colorByEntry={yKeys.length === 1}
          height={height}
          valueFormatter={compact}
        />
      );
    case 'line':
      return <LineChart data={data} xKey={xKey} lines={yKeys} height={height} valueFormatter={compact} />;
    case 'area':
      return <AreaChart data={data} xKey={xKey} areas={yKeys} height={height} valueFormatter={compact} />;
    case 'pie':
      return (
        <PieChart data={data} nameKey={xKey} valueKey={yKeys[0].key} height={height} valueFormatter={compact} />
      );
    case 'funnel': {
      const stages = data.map((d) => ({
        stage: d[xKey] ?? d.stage,
        count: d.count ?? d[yKeys[0]?.key] ?? 0,
        totalValue: d.totalValue ?? d.total ?? d[yKeys[0]?.key] ?? 0,
      }));
      return <FunnelChart stages={stages} />;
    }
    case 'composed':
      return (
        <ResponsiveContainer width="100%" height={height} minHeight={220}>
          <ComposedChart data={data} margin={{ right: 8 }}>
            <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey={xKey} {...axisStyle} />
            <YAxis {...axisStyle} />
            <Tooltip {...tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {yKeys.map((y, i) => {
              const color = y.color || chartColor(i);
              if (y.type === 'line') {
                return <Line key={y.key} type="monotone" dataKey={y.key} name={y.label || y.key} stroke={color} strokeWidth={2} />;
              }
              if (y.type === 'area') {
                return <Area key={y.key} type="monotone" dataKey={y.key} name={y.label || y.key} stroke={color} fill={`${color}40`} />;
              }
              return <Bar key={y.key} dataKey={y.key} name={y.label || y.key} fill={color} radius={[4, 4, 0, 0]} maxBarSize={42} />;
            })}
          </ComposedChart>
        </ResponsiveContainer>
      );
    default:
      return <BarChart data={data} xKey={xKey} bars={yKeys} height={height} />;
  }
}
