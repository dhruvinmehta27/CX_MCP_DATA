import { useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ComposedChart, Line, Cell,
} from 'recharts';
import { tooltipStyle, axisStyle, gridStroke } from '../charts/chartTheme';
import { fmtCurrency } from '../../utils/formatters';
import { CHART_COLORS, COLORS } from '../../utils/colors';

const TARGET_KEY = 'pipelineForecastTarget';
const qLabel = (q) => q.replace('-Q', ' Q');

export default function ForecastView({ forecast, kpis }) {
  const [target, setTarget] = useState(() => Number(localStorage.getItem(TARGET_KEY)) || 0);
  const saveTarget = (v) => {
    setTarget(v);
    localStorage.setItem(TARGET_KEY, String(v));
  };

  const f = forecast || {};
  const byStage = (f.byStage || []).map((s) => ({
    stage: s.stage,
    weighted: Math.round(s.weightedValue),
    unweighted: Math.round(Math.max(s.totalValue - s.weightedValue, 0)),
  }));
  const monthly = (f.monthly || []).map((m) => ({
    month: m.month.slice(2).replace('-', "/"),
    weighted: Math.round(m.weightedValue),
    open: Math.round(m.openValue),
  }));
  const quarters = f.quarters || [];
  const thisQ = kpis?.forecastThisQuarter ?? 0;
  const attainment = target > 0 ? Math.round((thisQ / target) * 100) : null;

  return (
    <div className="forecast-view">
      <div className="forecast-cards">
        {quarters.slice(0, 4).map((q) => (
          <div key={q.quarter} className={`forecast-q-card${q.isCurrent ? ' current' : ''}`}>
            <div className="forecast-q-label">
              {qLabel(q.quarter)} {q.isCurrent && <span className="badge">This Q</span>}
            </div>
            <div className="forecast-q-value">{fmtCurrency(q.weightedValue)}</div>
            <div className="forecast-q-sub">
              {fmtCurrency(q.openValue)} gross · {q.count} deals
            </div>
          </div>
        ))}
      </div>

      <div className="forecast-attainment card">
        <div className="attainment-row">
          <div>
            <div className="attainment-label">Forecast attainment — this quarter</div>
            <div className="attainment-sub">Weighted forecast {fmtCurrency(thisQ)} against your target</div>
          </div>
          <div className="attainment-target">
            <label>Quarter target €</label>
            <input
              type="number"
              className="input input-sm"
              placeholder="set target…"
              value={target || ''}
              onChange={(e) => saveTarget(Number(e.target.value))}
            />
          </div>
          <div className={`attainment-figure ${attainment == null ? '' : attainment >= 100 ? 'good' : attainment >= 70 ? 'mid' : 'low'}`}>
            {attainment == null ? '—' : `${attainment}%`}
          </div>
        </div>
        {attainment != null && (
          <div className="attainment-bar">
            <div className="attainment-fill" style={{ width: `${Math.min(attainment, 100)}%` }} />
            <div className="attainment-target-mark" />
          </div>
        )}
      </div>

      <div className="forecast-charts">
        <div className="card chart-card">
          <div className="chart-card-header">
            <div>
              <div className="chart-card-title">Pipeline value by stage</div>
              <div className="chart-card-subtitle">Weighted (likely) vs unweighted remainder</div>
            </div>
          </div>
          <div className="chart-card-body" style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%" minHeight={240}>
              <BarChart data={byStage} margin={{ left: 0, right: 8 }}>
                <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="stage" {...axisStyle} interval={0} angle={-12} textAnchor="end" height={50} />
                <YAxis {...axisStyle} tickFormatter={(v) => fmtCurrency(v)} />
                <Tooltip {...tooltipStyle} formatter={(v) => fmtCurrency(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="weighted" stackId="v" name="Weighted" fill={CHART_COLORS[0]} radius={[0, 0, 0, 0]} maxBarSize={54} />
                <Bar dataKey="unweighted" stackId="v" name="Unweighted remainder" fill="#C8D6E5" radius={[4, 4, 0, 0]} maxBarSize={54} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card chart-card">
          <div className="chart-card-header">
            <div>
              <div className="chart-card-title">Monthly forecast trend</div>
              <div className="chart-card-subtitle">Next 6 months by expected close</div>
            </div>
          </div>
          <div className="chart-card-body" style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%" minHeight={240}>
              <ComposedChart data={monthly} margin={{ left: 0, right: 8 }}>
                <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" {...axisStyle} />
                <YAxis {...axisStyle} tickFormatter={(v) => fmtCurrency(v)} />
                <Tooltip {...tooltipStyle} formatter={(v) => fmtCurrency(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="weighted" name="Weighted forecast" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} maxBarSize={40}>
                  {monthly.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[1]} />
                  ))}
                </Bar>
                <Line dataKey="open" name="Gross pipeline" stroke={COLORS.warning} strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
