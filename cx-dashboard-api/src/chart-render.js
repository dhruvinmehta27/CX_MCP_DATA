/**
 * Server-side chart → PNG for the Copilot inline-image endpoint.
 * ECharts SSR (renderer: 'svg', no browser/DOM) → resvg rasterises to PNG.
 * The option is built deterministically from the data (no LLM-generated JS),
 * so rendering is reliable and safe.
 */
import * as echarts from 'echarts';
import { Resvg } from '@resvg/resvg-js';

const BG = '#1D1D1B';
const ACCENT = '#E4002B';
const PALETTE = ['#E4002B', '#0070F2', '#36A41D', '#E76500', '#7858FF', '#0CA6CA', '#FA4F96'];

// Detect a category (label) key and a numeric (value) key from tabular rows.
function detectKeys(rows) {
  const sample = rows.find((r) => r && typeof r === 'object') || {};
  const keys = Object.keys(sample);
  const numKey = keys.find((k) => typeof sample[k] === 'number' || (!Number.isNaN(parseFloat(sample[k])) && typeof sample[k] !== 'boolean' && /amount|value|count|total|sum|revenue|qty|number/i.test(k)))
    || keys.find((k) => typeof sample[k] === 'number');
  const catKey = keys.find((k) => k !== numKey && typeof sample[k] === 'string') || keys.find((k) => k !== numKey);
  return { catKey, numKey };
}

/** Build a dark-themed ECharts option from arbitrary tabular data. */
export function buildEChartsOption(data, chartType, title) {
  const base = {
    backgroundColor: BG,
    color: PALETTE,
    textStyle: { color: '#FFFFFF', fontFamily: 'Segoe UI, Arial, sans-serif' },
    title: title ? { text: title, left: 'center', top: 14, textStyle: { color: '#FFFFFF', fontSize: 22, fontWeight: 'bold' } } : undefined,
    tooltip: {},
  };

  const rows = Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : [];
  if (!rows.length) {
    return { ...base, title: { text: title || 'No data to chart', left: 'center', top: '45%', textStyle: { color: '#FFFFFF', fontSize: 20 } } };
  }
  const { catKey, numKey } = detectKeys(rows);
  if (!numKey) {
    return { ...base, title: { text: title || 'No numeric series found', left: 'center', top: '45%', textStyle: { color: '#FFFFFF', fontSize: 18 } } };
  }
  const cats = rows.map((d) => String(d[catKey] ?? ''));
  const vals = rows.map((d) => Number(d[numKey]) || 0);

  if (chartType === 'pie' || chartType === 'donut') {
    return {
      ...base,
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      series: [{
        type: 'pie',
        radius: ['38%', '66%'],
        center: ['50%', '56%'],
        data: rows.map((d, i) => ({ name: String(d[catKey] ?? ''), value: Number(d[numKey]) || 0, itemStyle: { color: PALETTE[i % PALETTE.length] } })),
        label: { color: '#FFFFFF' },
      }],
    };
  }

  const type = chartType === 'line' || chartType === 'area' ? 'line' : 'bar';
  return {
    ...base,
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: '4%', right: '5%', top: title ? 70 : 30, bottom: 40, containLabel: true },
    xAxis: { type: 'category', data: cats, axisLabel: { color: '#FFFFFF', fontSize: 12 }, axisLine: { lineStyle: { color: '#555' } } },
    yAxis: { type: 'value', axisLabel: { color: '#CCCCCC' }, splitLine: { lineStyle: { color: '#333' } } },
    series: [{
      type,
      data: vals,
      barWidth: '50%',
      smooth: type === 'line',
      areaStyle: chartType === 'area' ? {} : undefined,
      itemStyle: { color: ACCENT, borderRadius: type === 'bar' ? [6, 6, 0, 0] : 0 },
      lineStyle: type === 'line' ? { color: ACCENT, width: 3 } : undefined,
    }],
  };
}

/** Render an ECharts option to a PNG Buffer (2× for crispness). */
export function renderChartPng(option, { width = 900, height = 520 } = {}) {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height });
  try {
    chart.setOption(option);
    const svg = chart.renderToSVGString();
    const resvg = new Resvg(svg, { background: BG, fitTo: { mode: 'width', value: width * 2 } });
    return resvg.render().asPng();
  } finally {
    chart.dispose();
  }
}
