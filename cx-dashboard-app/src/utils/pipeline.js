/**
 * Client-side pipeline aggregation — mirrors the server's pipelineOverview so
 * every board filter (stage, status, value, probability, search) updates the
 * KPI header, Funnel, Forecast and Flow views instantly from a single fetch,
 * with no extra C4C round trips. Operates on the normalized rows returned by
 * GET /api/analytics/opportunities/list.
 */

const WON_RE = /won/i;
const LOST_RE = /lost|cancel|reject|stopped/i;
const CLOSED_RE = /won|lost|completed|cancel|closed|rejected|finished/i;

export function statusBucket(statusText) {
  const s = statusText || '';
  if (WON_RE.test(s)) return 'Won';
  if (LOST_RE.test(s) || CLOSED_RE.test(s)) return 'Lost';
  return 'Open';
}

export const STATUS_BUCKETS = ['Open', 'Won', 'Lost'];

function quarterOf(d) {
  return { year: d.getUTCFullYear(), q: Math.floor(d.getUTCMonth() / 3) + 1 };
}
const qKey = ({ year, q }) => `${year}-Q${q}`;
function shiftQuarter({ year, q }, by) {
  const idx = year * 4 + (q - 1) + by;
  return { year: Math.floor(idx / 4), q: (idx % 4) + 1 };
}
const monthKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** Ordered, unique stage list with a stable order from the data's stageCode. */
export function orderedStages(rows) {
  const map = new Map();
  for (const r of rows) {
    const stage = r.stage || 'Unknown';
    const cur = map.get(stage);
    if (!cur || String(r.stageCode || '') < String(cur)) map.set(stage, r.stageCode || cur || '');
  }
  return [...map.entries()]
    .sort((a, b) => String(a[1]).localeCompare(String(b[1]), undefined, { numeric: true }))
    .map(([stage]) => stage);
}

export function computeOverview(rows, now = new Date()) {
  const open = rows.filter((r) => statusBucket(r.status) === 'Open');
  const won = rows.filter((r) => statusBucket(r.status) === 'Won');
  const lost = rows.filter((r) => statusBucket(r.status) === 'Lost');

  const sumVal = (rs) => rs.reduce((a, r) => a + (r.expectedValue || 0), 0);
  const sumW = (rs) => rs.reduce((a, r) => a + (r.weightedValue || 0), 0);

  const totalPipelineValue = sumVal(open);
  const weightedPipelineValue = sumW(open);

  // Stage order + per-stage aggregates (open deals)
  const order = orderedStages(open);
  const stageMap = new Map(order.map((s) => [s, { stage: s, count: 0, totalValue: 0, weightedValue: 0, probSum: 0 }]));
  for (const r of open) {
    const s = stageMap.get(r.stage || 'Unknown');
    if (!s) continue;
    s.count += 1;
    s.totalValue += r.expectedValue || 0;
    s.weightedValue += r.weightedValue || 0;
    s.probSum += r.probability || 0;
  }
  const stages = order.map((name) => {
    const s = stageMap.get(name);
    return {
      stage: name,
      count: s.count,
      totalValue: s.totalValue,
      weightedValue: s.weightedValue,
      avgValue: s.count ? s.totalValue / s.count : 0,
      avgProbability: s.count ? Math.round(s.probSum / s.count) : 0,
    };
  });

  // Funnel: conversion + drop-off
  const funnelStages = stages.map((s, i) => {
    const next = stages[i + 1];
    const conv = next && s.count ? (next.count / s.count) * 100 : null;
    return {
      stage: s.stage,
      count: s.count,
      totalValue: s.totalValue,
      weightedValue: s.weightedValue,
      conversionToNext: conv == null ? null : Math.round(conv),
      dropOff: conv == null ? null : Math.round(100 - conv),
    };
  });
  const maxDrop = Math.max(...funnelStages.map((s) => (s.dropOff == null ? -1 : s.dropOff)), -1);
  for (const s of funnelStages) s.highDropOff = s.dropOff != null && s.dropOff === maxDrop && s.dropOff >= 50;
  const overallWinRate = won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null;

  // Sales cycle (created → close-ish). We only have created + expectedClose here.
  let cycleSum = 0;
  let cycleN = 0;
  for (const r of [...won, ...lost]) {
    const c = r.created ? new Date(r.created) : null;
    const e = r.expectedClose ? new Date(r.expectedClose) : null;
    if (c && e && e > c) {
      cycleSum += (e - c) / 86_400_000;
      cycleN += 1;
    }
  }

  // Forecast quarters (current + next 3), driven by expected close of open deals
  const curQ = quarterOf(now);
  const curKey = qKey(curQ);
  const nextKey = qKey(shiftQuarter(curQ, 1));
  const quarterMap = new Map();
  for (let i = 0; i < 4; i++) {
    const k = qKey(shiftQuarter(curQ, i));
    quarterMap.set(k, { quarter: k, openValue: 0, weightedValue: 0, count: 0 });
  }
  let forecastThisQuarter = 0;
  let forecastNextQuarter = 0;
  for (const r of open) {
    if (!r.expectedClose) continue;
    const d = new Date(r.expectedClose);
    const k = qKey(quarterOf(d));
    const b = quarterMap.get(k);
    if (b) {
      b.openValue += r.expectedValue || 0;
      b.weightedValue += r.weightedValue || 0;
      b.count += 1;
    }
    if (k === curKey) forecastThisQuarter += r.weightedValue || 0;
    else if (k === nextKey) forecastNextQuarter += r.weightedValue || 0;
  }
  const quarters = [...quarterMap.values()].map((q) => ({ ...q, isCurrent: q.quarter === curKey }));

  // Monthly forecast trend (next 6 months by expected close)
  const months = [];
  const mMap = new Map();
  for (let i = 0; i < 6; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    const k = monthKey(d);
    months.push(k);
    mMap.set(k, { month: k, openValue: 0, weightedValue: 0 });
  }
  for (const r of open) {
    if (!r.expectedClose) continue;
    const b = mMap.get(monthKey(new Date(r.expectedClose)));
    if (b) {
      b.openValue += r.expectedValue || 0;
      b.weightedValue += r.weightedValue || 0;
    }
  }
  const monthly = months.map((k) => mMap.get(k));

  // Snapshot-derived flow (Sankey)
  const nodeNames = [...stages.map((s) => s.stage), 'Won', 'Lost'];
  const nodeIdx = new Map(nodeNames.map((n, i) => [n, i]));
  const linkMap = new Map();
  const addLink = (source, target, value, amount, kind) => {
    if (source == null || target == null || value <= 0) return;
    const key = `${source}->${target}`;
    const m = linkMap.get(key);
    if (m) {
      m.value += value;
      m.amount += amount;
    } else linkMap.set(key, { source, target, value, amount, kind });
  };
  for (let i = 0; i < stages.length - 1; i++) {
    addLink(i, i + 1, stages[i + 1].count, stages[i + 1].totalValue, 'progress');
  }
  const lastStageIdx = stages.length - 1;
  const terminal = (rs, targetName) => {
    const target = nodeIdx.get(targetName);
    const byPhase = new Map();
    for (const r of rs) {
      const k = nodeIdx.has(r.stage) ? nodeIdx.get(r.stage) : lastStageIdx;
      const acc = byPhase.get(k) || { value: 0, amount: 0 };
      acc.value += 1;
      acc.amount += r.expectedValue || 0;
      byPhase.set(k, acc);
    }
    for (const [from, acc] of byPhase) if (from >= 0) addLink(from, target, acc.value, acc.amount, targetName.toLowerCase());
  };
  if (stages.length) {
    terminal(won, 'Won');
    terminal(lost, 'Lost');
  }
  const usedNodes = new Set();
  for (const l of linkMap.values()) {
    usedNodes.add(l.source);
    usedNodes.add(l.target);
  }
  const flow = {
    nodes: nodeNames.map((name) => ({ name })),
    links: [...linkMap.values()],
    usedNodes,
  };

  return {
    kpis: {
      totalPipelineValue,
      weightedPipelineValue,
      openOpportunities: open.length,
      avgDealSize: open.length ? totalPipelineValue / open.length : 0,
      winRate: overallWinRate,
      avgSalesCycleDays: cycleN ? Math.round(cycleSum / cycleN) : null,
      forecastThisQuarter,
      forecastNextQuarter,
      closedWonValue: sumVal(won),
      closedLostValue: sumVal(lost),
    },
    stages,
    funnel: { stages: funnelStages, overallWinRate },
    forecast: {
      byStage: stages.map((s) => ({ stage: s.stage, totalValue: s.totalValue, weightedValue: s.weightedValue })),
      monthly,
      quarters,
      currentQuarter: curKey,
      nextQuarter: nextKey,
    },
    flow,
    meta: {
      total: rows.length,
      openCount: open.length,
      wonCount: won.length,
      lostCount: lost.length,
    },
  };
}

// Categorical dimensions wired from confirmed C4C fields. Each maps a board
// filter key to the row property it constrains.
export const DIMENSIONS = [
  { key: 'sources', field: 'source', label: 'Source' },
  { key: 'types', field: 'oppType', label: 'Type' },
  { key: 'territories', field: 'territory', label: 'Region / Team' },
  { key: 'segments', field: 'segment', label: 'Segment' },
  { key: 'subSegments', field: 'subSegment', label: 'Sub-segment' },
];

/** Canonical empty board-filter state (shared by the page, filters and URL sync). */
export function emptyBoardFilters() {
  return {
    search: '',
    stages: [],
    // Default to OPEN so the board (Kanban + counts) shows the live pipeline and
    // matches the KPI header / Pipeline Health. Users can add Won/Lost.
    statuses: ['Open'],
    valueRange: [null, null],
    probRange: [0, 100],
    sources: [],
    types: [],
    territories: [],
    segments: [],
    subSegments: [],
  };
}

/** Distinct, sorted values for a row field (drops blanks). */
export function distinctValues(rows, field) {
  const set = new Set();
  for (const r of rows) if (r[field]) set.add(r[field]);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Apply board-level filters to the row set (client-side, instant). */
export function applyBoardFilters(rows, f) {
  const q = (f.search || '').trim().toLowerCase();
  const stageSet = f.stages && f.stages.length ? new Set(f.stages) : null;
  const statusSet = f.statuses && f.statuses.length ? new Set(f.statuses) : null;
  const [vMin, vMax] = f.valueRange || [null, null];
  const [pMin, pMax] = f.probRange || [0, 100];
  const dimSets = DIMENSIONS.map((d) => ({
    field: d.field,
    set: f[d.key] && f[d.key].length ? new Set(f[d.key]) : null,
  })).filter((d) => d.set);
  return rows.filter((r) => {
    if (stageSet && !stageSet.has(r.stage)) return false;
    if (statusSet && !statusSet.has(statusBucket(r.status))) return false;
    for (const d of dimSets) if (!d.set.has(r[d.field])) return false;
    const v = r.expectedValue || 0;
    if (vMin != null && v < vMin) return false;
    if (vMax != null && v > vMax) return false;
    const p = r.probability || 0;
    if (p < (pMin ?? 0) || p > (pMax ?? 100)) return false;
    if (q) {
      const hay = `${r.name || ''} ${r.account || ''} ${r.owner || ''} ${r.id || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
