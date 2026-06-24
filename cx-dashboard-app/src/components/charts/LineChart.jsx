import {
  ResponsiveContainer, LineChart as RLineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { chartColor } from '../../utils/colors';
import { tooltipStyle, axisStyle, gridStroke } from './chartTheme';

export default function LineChart({ data, xKey, lines, height = '100%', valueFormatter }) {
  return (
    <ResponsiveContainer width="100%" height={height} minHeight={220}>
      <RLineChart data={data} margin={{ right: 8 }}>
        <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} {...axisStyle} />
        <YAxis {...axisStyle} tickFormatter={valueFormatter} />
        <Tooltip {...tooltipStyle} formatter={valueFormatter ? (v) => valueFormatter(v) : undefined} />
        {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {lines.map((line, i) => (
          <Line
            key={line.key}
            type="monotone"
            dataKey={line.key}
            name={line.label || line.key}
            stroke={line.color || chartColor(i)}
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        ))}
      </RLineChart>
    </ResponsiveContainer>
  );
}
