import {
  ResponsiveContainer, AreaChart as RAreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { chartColor } from '../../utils/colors';
import { tooltipStyle, axisStyle, gridStroke } from './chartTheme';

export default function AreaChart({ data, xKey, areas, height = '100%', valueFormatter }) {
  return (
    <ResponsiveContainer width="100%" height={height} minHeight={220}>
      <RAreaChart data={data} margin={{ right: 8 }}>
        <defs>
          {areas.map((area, i) => {
            const color = area.color || chartColor(i);
            return (
              <linearGradient key={area.key} id={`grad-${area.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.45} />
                <stop offset="95%" stopColor={color} stopOpacity={0.05} />
              </linearGradient>
            );
          })}
        </defs>
        <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} {...axisStyle} />
        <YAxis {...axisStyle} tickFormatter={valueFormatter} />
        <Tooltip {...tooltipStyle} formatter={valueFormatter ? (v) => valueFormatter(v) : undefined} />
        {areas.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {areas.map((area, i) => (
          <Area
            key={area.key}
            type="monotone"
            dataKey={area.key}
            name={area.label || area.key}
            stroke={area.color || chartColor(i)}
            strokeWidth={2}
            fill={`url(#grad-${area.key})`}
          />
        ))}
      </RAreaChart>
    </ResponsiveContainer>
  );
}
