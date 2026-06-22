import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { statusBucket } from '../../utils/pipeline';
import { fmtCurrency, fmtCurrencyFull, fmtDate, fmtNumber } from '../../utils/formatters';
import { COLORS } from '../../utils/colors';
import { c4cObjectUrl } from '../../utils/c4cLinks';
import DataTable from '../ui/DataTable';
import Icon from '../ui/Icon';

const GREEN = COLORS.success;
const YELLOW = COLORS.warning;
const RED = COLORS.danger;
const GREY = '#9AA7B4';
const BLUE = COLORS.primary;

// "Strategic" is proxied from the Opportunity Level (Level 1 / Managed) until a
// true account strategic flag is wired via the account join.
const isStrategic = (r) => /managed|level\s*1/i.test(r.oppType || '');
const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null);

function bubbleColor(r, staleDays) {
  const dsa = daysSince(r.lastActivity);
  if (dsa != null && dsa > staleDays) return GREY;
  const p = r.probability || 0;
  if (p > 70) return GREEN;
  if (p >= 40) return YELLOW;
  return RED;
}

export default function BubbleView({ rows, onSelect }) {
  const elRef = useRef(null);
  const chartRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const [minValue, setMinValue] = useState(0);
  const [probThreshold, setProbThreshold] = useState(0);
  const [staleDays, setStaleDays] = useState(30);
  const [strategicOnly, setStrategicOnly] = useState(false);
  const [staleOnly, setStaleOnly] = useState(false);
  const [execOnly, setExecOnly] = useState(false);
  const [selected, setSelected] = useState([]); // opportunities lassoed/box-selected
  const dataRowsRef = useRef([]); // rows in current series order, for brush index lookup

  // All open opportunities (tiles summarise these, matching the KPI header)
  const allOpen = useMemo(() => rows.filter((r) => statusBucket(r.status) === 'Open'), [rows]);
  // Only deals with a close date + value can be placed on the time axis
  const plottable = useMemo(() => allOpen.filter((r) => r.expectedClose && (r.expectedValue || 0) > 0), [allOpen]);

  // "Large" deal = top quartile by value (data-adaptive)
  const largeThreshold = useMemo(() => {
    const vals = allOpen.map((r) => r.expectedValue || 0).sort((a, b) => a - b);
    return vals.length ? vals[Math.floor(vals.length * 0.75)] : Infinity;
  }, [allOpen]);

  const enrich = (r) => {
    const dsa = daysSince(r.lastActivity);
    const stale = dsa != null && dsa > staleDays;
    const pastDue = r.expectedClose ? new Date(r.expectedClose) < new Date() : false;
    const large = (r.expectedValue || 0) >= largeThreshold;
    const exec = large && ((r.probability || 0) < 40 || pastDue);
    return { dsa, stale, pastDue, large, exec, strat: isStrategic(r) };
  };

  const filtered = useMemo(
    () =>
      plottable.filter((r) => {
        if ((r.expectedValue || 0) < minValue) return false;
        if ((r.probability || 0) < probThreshold) return false;
        const e = enrich(r);
        if (strategicOnly && !e.strat) return false;
        if (staleOnly && !e.stale) return false;
        if (execOnly && !e.exec) return false;
        return true;
      }),
    [plottable, minValue, probThreshold, strategicOnly, staleOnly, execOnly, staleDays, largeThreshold]
  );

  const metrics = useMemo(() => {
    const now = new Date();
    let total = 0;
    let revThisMonth = 0;
    let atRisk = 0;
    let strategic = 0;
    let stale = 0;
    for (const r of allOpen) {
      const v = r.expectedValue || 0;
      total += v;
      const e = enrich(r);
      if (e.strat) strategic += 1;
      if (e.stale) stale += 1;
      if (r.expectedClose) {
        const cd = new Date(r.expectedClose);
        if (cd.getUTCFullYear() === now.getUTCFullYear() && cd.getUTCMonth() === now.getUTCMonth())
          revThisMonth += v * ((r.probability || 0) / 100);
      }
      if (e.exec || e.pastDue) atRisk += v;
    }
    const top10 = [...allOpen]
      .sort((a, b) => (b.expectedValue || 0) - (a.expectedValue || 0))
      .slice(0, 10)
      .reduce((s, r) => s + (r.expectedValue || 0), 0);
    return { total, top10, revThisMonth, atRisk, strategic, stale, count: allOpen.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allOpen, staleDays, largeThreshold]);

  // init once
  useEffect(() => {
    const chart = echarts.init(elRef.current);
    chartRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    chart.on('click', (p) => {
      if (p.data && p.data.raw) onSelectRef.current?.(p.data.raw);
    });
    chart.on('brushSelected', (p) => {
      const idx = p.batch?.[0]?.selected?.[0]?.dataIndex || [];
      setSelected(idx.map((i) => dataRowsRef.current[i]).filter(Boolean));
    });
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  // re-render on data/threshold change
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    dataRowsRef.current = filtered; // keep brush index → row lookup in sync
    const maxValue = filtered.reduce((m, r) => Math.max(m, r.expectedValue || 0), 1);
    const data = filtered.map((r) => ({
      value: [new Date(r.expectedClose).getTime(), r.probability || 0, r.expectedValue || 0],
      raw: r,
      itemStyle: {
        color: bubbleColor(r, staleDays),
        borderColor: isStrategic(r) ? BLUE : 'rgba(0,0,0,0.12)',
        borderWidth: isStrategic(r) ? 2.5 : 1,
        opacity: 0.82,
      },
    }));

    chart.setOption(
      {
        animation: false,
        grid: { left: 56, right: 24, top: 24, bottom: 70 },
        tooltip: {
          trigger: 'item',
          confine: true,
          backgroundColor: '#fff',
          borderColor: '#E5E9ED',
          textStyle: { color: '#1D2D3E', fontSize: 12 },
          formatter: (p) => {
            const r = p.data.raw;
            const e = enrich(r);
            const tag = e.exec
              ? '<span style="color:#D20A0A">Executive attention</span>'
              : (r.probability || 0) > 70
                ? '<span style="color:#36A41D">Likely to close</span>'
                : e.stale
                  ? '<span style="color:#8396A8">Stale</span>'
                  : '';
            return `
              <div style="font-weight:700;margin-bottom:4px;max-width:280px">${r.name || 'Opportunity'}</div>
              <div style="color:#556B82">${r.account || '—'} · ${r.owner || 'Unassigned'}</div>
              <div style="margin-top:6px"><b>${fmtCurrencyFull(r.expectedValue)}</b> · ${r.probability ?? 0}% probability</div>
              <div>Close: ${fmtDate(r.expectedClose)}${e.pastDue ? ' <span style="color:#D20A0A">(past due)</span>' : ''}</div>
              <div>Stage: ${r.stage || '—'}</div>
              <div>Last activity: ${e.dsa == null ? '—' : e.dsa + ' days ago'}</div>
              ${isStrategic(r) ? '<div style="color:#0070F2">Strategic deal</div>' : ''}
              ${tag ? `<div style="margin-top:4px">${tag}</div>` : ''}
              <div style="margin-top:4px;color:#8396A8;font-size:11px">Click to open details</div>`;
          },
        },
        toolbox: {
          right: 12,
          top: -4,
          feature: {
            brush: { type: ['rect', 'polygon', 'clear'], title: { rect: 'Box select', polygon: 'Lasso', clear: 'Clear' } },
            dataZoom: { yAxisIndex: 'none', title: { zoom: 'Zoom', back: 'Reset zoom' } },
          },
        },
        brush: { xAxisIndex: 0, yAxisIndex: 0, throttleType: 'debounce', throttleDelay: 200, brushStyle: { borderColor: BLUE } },
        xAxis: {
          type: 'time',
          name: 'Expected close',
          nameLocation: 'middle',
          nameGap: 34,
          axisLine: { lineStyle: { color: '#C2CCD8' } },
          axisLabel: { color: '#8396A8', fontSize: 11 },
          splitLine: { show: false },
        },
        yAxis: {
          type: 'value',
          name: 'Win probability %',
          min: 0,
          max: 100,
          axisLine: { lineStyle: { color: '#C2CCD8' } },
          axisLabel: { color: '#8396A8', fontSize: 11, formatter: '{value}%' },
          splitLine: { lineStyle: { color: '#EBEFF3' } },
        },
        dataZoom: [
          { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
          { type: 'inside', yAxisIndex: 0, filterMode: 'none' },
          { type: 'slider', xAxisIndex: 0, height: 18, bottom: 36 },
        ],
        series: [
          {
            type: 'scatter',
            // NOTE: do NOT enable `large` mode — it ignores per-point itemStyle
            // and a function symbolSize (our colour + size), rendering blank.
            large: false,
            symbolSize: (val) => 8 + 44 * Math.sqrt((val[2] || 0) / maxValue),
            data,
            markLine: {
              silent: true,
              symbol: 'none',
              label: { color: '#8396A8', fontSize: 10 },
              lineStyle: { color: '#C2CCD8', type: 'dashed' },
              data: [
                { xAxis: Date.now(), label: { formatter: 'Today' }, lineStyle: { color: '#556B82' } },
                { yAxis: 70, label: { formatter: '70%' } },
                { yAxis: 40, label: { formatter: '40%' } },
              ],
            },
          },
        ],
      },
      true
    );
  }, [filtered, staleDays]);

  // Selection becomes meaningless once the plotted set changes, so reset it
  useEffect(() => {
    setSelected([]);
  }, [filtered]);

  const tableRows = selected.length ? selected : filtered;
  const clearSelection = () => {
    setSelected([]);
    chartRef.current?.dispatchAction({ type: 'brush', command: 'clear', areas: [] });
  };

  const columns = [
    { key: 'id', label: 'ID' },
    { key: 'name', label: 'Opportunity' },
    { key: 'account', label: 'Account' },
    { key: 'stage', label: 'Stage', type: 'status' },
    { key: 'expectedValue', label: 'Value', type: 'currency', render: (v) => fmtCurrencyFull(v) },
    { key: 'probability', label: 'Prob', type: 'number', render: (v) => `${v ?? 0}%` },
    { key: 'expectedClose', label: 'Close', type: 'date', render: (v) => fmtDate(v) },
    { key: 'owner', label: 'Owner' },
    {
      key: 'objectId',
      label: 'C4C',
      sortable: false,
      render: (v) => {
        const url = c4cObjectUrl('opportunity', v);
        return url ? (
          <a className="c4c-link" href={url} target="_blank" rel="noreferrer">
            Open <Icon name="external" size={12} />
          </a>
        ) : (
          '–'
        );
      },
    },
    {
      key: '_view',
      label: '',
      sortable: false,
      render: (_, row) => (
        <button className="btn-icon" title="Details" onClick={() => onSelect?.(row)}>
          <Icon name="expand" size={14} />
        </button>
      ),
    },
  ];

  const Tile = ({ label, value, accent }) => (
    <div className={`bubble-metric${accent ? ` kpi-${accent}` : ''}`}>
      <span className="bubble-metric-label">{label}</span>
      <span className="bubble-metric-value">{value}</span>
    </div>
  );

  return (
    <div className="bubble-view">
      <div className="bubble-metrics">
        <Tile label="Total Pipeline" value={fmtCurrency(metrics.total)} />
        <Tile label="Top 10 Deals" value={fmtCurrency(metrics.top10)} accent="teal" />
        <Tile label="Expected This Month" value={fmtCurrency(metrics.revThisMonth)} accent="success" />
        <Tile label="Revenue at Risk" value={fmtCurrency(metrics.atRisk)} accent="danger" />
        <Tile label="Strategic Deals" value={fmtNumber(metrics.strategic)} />
        <Tile label="Stale Opportunities" value={fmtNumber(metrics.stale)} accent="warning" />
      </div>

      <div className="bubble-filters">
        <div className="range-field">
          <label>Min value €</label>
          <input type="number" className="input input-sm" placeholder="0" value={minValue || ''} onChange={(e) => setMinValue(Number(e.target.value) || 0)} />
        </div>
        <div className="range-field">
          <label>Probability ≥</label>
          <input type="number" min="0" max="100" className="input input-sm" value={probThreshold} onChange={(e) => setProbThreshold(Number(e.target.value) || 0)} />
        </div>
        <div className="range-field">
          <label>Stale &gt; days</label>
          <input type="number" min="1" className="input input-sm" value={staleDays} onChange={(e) => setStaleDays(Number(e.target.value) || 30)} />
        </div>
        <button className={`chip${strategicOnly ? ' chip-on' : ''}`} onClick={() => setStrategicOnly((v) => !v)}>Strategic only</button>
        <button className={`chip${staleOnly ? ' chip-on' : ''}`} onClick={() => setStaleOnly((v) => !v)}>Stale only</button>
        <button className={`chip${execOnly ? ' chip-on' : ''}`} onClick={() => setExecOnly((v) => !v)}>Executive attention only</button>
        <span className="bubble-count">
          {fmtNumber(filtered.length)} plotted · {fmtNumber(allOpen.length)} open
          {allOpen.length - plottable.length > 0 ? ` · ${fmtNumber(allOpen.length - plottable.length)} no close date` : ''}
          {selected.length > 0 ? ` · ${fmtNumber(selected.length)} selected` : ''}
        </span>
      </div>

      <div className="bubble-legend">
        <span><i style={{ background: GREEN }} /> &gt;70%</span>
        <span><i style={{ background: YELLOW }} /> 40–70%</span>
        <span><i style={{ background: RED }} /> &lt;40%</span>
        <span><i style={{ background: GREY }} /> Stale</span>
        <span><i style={{ border: `2px solid ${BLUE}`, background: 'transparent' }} /> Strategic</span>
        <span className="bubble-legend-hint"><Icon name="bubble" size={13} /> Size = value · scroll to zoom · lasso to multi-select</span>
      </div>

      <div ref={elRef} style={{ width: '100%', height: 560 }} />

      <div className="bubble-table">
        <div className="bubble-table-head">
          <div className="chart-card-title">
            {selected.length ? 'Selected opportunities' : 'All plotted opportunities'}
          </div>
          <div className="bubble-table-actions">
            <span className="chart-card-subtitle">{fmtNumber(tableRows.length)} rows</span>
            {selected.length > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={clearSelection}>
                <Icon name="close" size={13} /> Clear selection
              </button>
            )}
          </div>
        </div>
        <DataTable pageSize={25} columns={columns} data={tableRows} />
      </div>
    </div>
  );
}
