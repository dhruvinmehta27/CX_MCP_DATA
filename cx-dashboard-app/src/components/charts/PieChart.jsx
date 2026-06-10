import {
  ResponsiveContainer, PieChart as RPieChart, Pie, Cell, Tooltip, Legend,
} from 'recharts';
import { chartColor } from '../../utils/colors';
import { tooltipStyle } from './chartTheme';

export default function PieChart({ data, nameKey, valueKey, height = '100%', valueFormatter }) {
  return (
    <ResponsiveContainer width="100%" height={height} minHeight={220}>
      <RPieChart>
        <Pie
          data={data}
          dataKey={valueKey}
          nameKey={nameKey}
          innerRadius="50%"
          outerRadius="78%"
          paddingAngle={2}
          stroke="#FFFFFF"
        >
          {data.map((entry, i) => (
            <Cell key={i} fill={chartColor(i)} />
          ))}
        </Pie>
        <Tooltip {...tooltipStyle} formatter={valueFormatter ? (v) => valueFormatter(v) : undefined} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </RPieChart>
    </ResponsiveContainer>
  );
}
