import {
  ResponsiveContainer, BarChart as RBarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell, Legend,
} from 'recharts';
import { chartColor } from '../../utils/colors';
import { tooltipStyle, axisStyle, gridStroke } from './chartTheme';

/**
 * bars: [{ key, color, label }]; layout 'horizontal' (default) or 'vertical'
 * colorByEntry: one color per bar entry (single-series categorical charts)
 */
export default function BarChart({
  data, xKey, bars, layout = 'horizontal', colorByEntry = false,
  height = '100%', valueFormatter,
}) {
  const vertical = layout === 'vertical';
  return (
    <ResponsiveContainer width="100%" height={height} minHeight={220}>
      <RBarChart data={data} layout={vertical ? 'vertical' : 'horizontal'} margin={{ left: vertical ? 30 : 0, right: 8 }}>
        <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" horizontal={!vertical} vertical={vertical} />
        {vertical ? (
          <>
            <XAxis type="number" {...axisStyle} tickFormatter={valueFormatter} />
            <YAxis type="category" dataKey={xKey} {...axisStyle} width={140} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} {...axisStyle} />
            <YAxis {...axisStyle} tickFormatter={valueFormatter} />
          </>
        )}
        <Tooltip {...tooltipStyle} formatter={valueFormatter ? (v) => valueFormatter(v) : undefined} />
        {bars.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {bars.map((bar, bi) => (
          <Bar
            key={bar.key}
            dataKey={bar.key}
            name={bar.label || bar.key}
            fill={bar.color || chartColor(bi)}
            radius={vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            maxBarSize={42}
          >
            {colorByEntry &&
              data.map((entry, i) => <Cell key={i} fill={chartColor(i)} />)}
          </Bar>
        ))}
      </RBarChart>
    </ResponsiveContainer>
  );
}
