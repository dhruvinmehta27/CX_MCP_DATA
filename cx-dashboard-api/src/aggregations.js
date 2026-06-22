/**
 * Pure aggregation functions — no C4C calls, no I/O.
 * All date fields tolerate both ISO strings and OData v2 "/Date(ms)/" format.
 */

export function parseODataDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const m = /\/Date\((-?\d+)/.exec(String(value));
  if (m) return new Date(parseInt(m[1], 10));
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toNumber(value) {
  const n = parseFloat(value);
  return Number.isNaN(n) ? 0 : n;
}

export function groupBy(records, field) {
  const groups = {};
  for (const r of records) {
    const key = r[field] == null || r[field] === '' ? 'Unknown' : String(r[field]);
    (groups[key] = groups[key] || []).push(r);
  }
  return groups;
}

export function countBy(records, field) {
  const groups = groupBy(records, field);
  return Object.entries(groups)
    .map(([label, recs]) => ({ label, count: recs.length }))
    .sort((a, b) => b.count - a.count);
}

export function sumBy(records, groupField, sumField) {
  const groups = groupBy(records, groupField);
  return Object.entries(groups)
    .map(([label, recs]) => ({
      label,
      count: recs.length,
      total: recs.reduce((acc, r) => acc + toNumber(r[sumField]), 0),
    }))
    .sort((a, b) => b.total - a.total);
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Last N months trend ending at the current month, gaps filled with 0.
 * Returns [{ month: "2026-01", count, total }]
 */
export function trendByMonth(records, dateField, valueField, months = 6, now = new Date()) {
  const buckets = new Map();
  const keys = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = monthKey(d);
    keys.push(key);
    buckets.set(key, { month: key, count: 0, total: 0 });
  }
  for (const r of records) {
    const d = parseODataDate(r[dateField]);
    if (!d) continue;
    const key = monthKey(d);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.count += 1;
    bucket.total += valueField ? toNumber(r[valueField]) : 0;
  }
  return keys.map((k) => buckets.get(k));
}

/**
 * Opportunity pipeline grouped by SalesCyclePhaseCodeText, ordered by the
 * phase code so stages appear in logical pipeline order. weightedValue uses
 * the real C4C ProbabilityPercent per opportunity.
 */
export function pipelineStages(opportunities) {
  const byStage = new Map();
  for (const o of opportunities) {
    const stage = o.SalesCyclePhaseCodeText || 'Unknown';
    if (!byStage.has(stage)) {
      byStage.set(stage, { stage, code: o.SalesCyclePhaseCode || '', count: 0, totalValue: 0, weightedValue: 0 });
    }
    const s = byStage.get(stage);
    s.count += 1;
    const value = toNumber(o.ExpectedRevenueAmount);
    s.totalValue += value;
    s.weightedValue += value * (toNumber(o.ProbabilityPercent) / 100);
    if (o.SalesCyclePhaseCode && (!s.code || String(o.SalesCyclePhaseCode) < String(s.code))) {
      s.code = o.SalesCyclePhaseCode;
    }
  }
  return [...byStage.values()]
    .sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }))
    .map(({ stage, count, totalValue, weightedValue }) => ({
      stage,
      count,
      totalValue,
      weightedValue,
      avgValue: count ? totalValue / count : 0,
    }));
}

const CLOSED_STATUS_RE = /won|lost|completed|cancel|closed|rejected|finished/i;
const WON_STATUS_RE = /won/i;
const LOST_STATUS_RE = /lost|cancel|reject|stopped/i;

export function isOpenStatus(statusText) {
  if (!statusText) return true;
  return !CLOSED_STATUS_RE.test(statusText);
}

export function isWonStatus(statusText) {
  return WON_STATUS_RE.test(statusText || '');
}

export function isLostStatus(statusText) {
  return !WON_STATUS_RE.test(statusText || '') && LOST_STATUS_RE.test(statusText || '');
}

function quarterOf(date) {
  return { year: date.getUTCFullYear(), q: Math.floor(date.getUTCMonth() / 3) + 1 };
}

function quarterKey({ year, q }) {
  return `${year}-Q${q}`;
}

function shiftQuarter({ year, q }, by) {
  const idx = year * 4 + (q - 1) + by;
  return { year: Math.floor(idx / 4), q: (idx % 4) + 1 };
}

/**
 * Single-pass pipeline analytics for the Pipeline Command Center.
 * Pure function over the opportunity snapshot — no transition history exists
 * in the OData feed, so the Sankey flow is DERIVED from the current stage
 * distribution and final phase of closed deals (clearly labelled in the UI).
 *
 * @param {object[]} records  opportunity rows (already filtered)
 * @param {Date}     now
 * @returns aggregate package consumed by /opportunities/pipeline-overview
 */
export function pipelineOverview(records, now = new Date()) {
  const open = records.filter((o) => isOpenStatus(o.LifeCycleStatusCodeText));
  const won = records.filter((o) => isWonStatus(o.LifeCycleStatusCodeText));
  const lost = records.filter(
    (o) => !isOpenStatus(o.LifeCycleStatusCodeText) && !isWonStatus(o.LifeCycleStatusCodeText)
  );

  const sumVal = (rows) => rows.reduce((a, o) => a + toNumber(o.ExpectedRevenueAmount), 0);
  const sumWeighted = (rows) =>
    rows.reduce((a, o) => a + toNumber(o.ExpectedRevenueAmount) * (toNumber(o.ProbabilityPercent) / 100), 0);

  const totalPipelineValue = sumVal(open);
  const weightedPipelineValue = sumWeighted(open);
  const closedWonValue = sumVal(won);
  const closedLostValue = sumVal(lost);

  // Average sales cycle: create → last change, for closed deals with both dates
  let cycleSum = 0;
  let cycleN = 0;
  for (const o of [...won, ...lost]) {
    const created = parseODataDate(o.CreationDateTime);
    const changed = parseODataDate(o.EntityLastChangedOn);
    if (created && changed && changed > created) {
      cycleSum += (changed - created) / 86_400_000;
      cycleN += 1;
    }
  }

  // Quarter buckets keyed off expected close date (open deals only)
  const curQ = quarterOf(now);
  const nextQ = shiftQuarter(curQ, 1);
  const curKey = quarterKey(curQ);
  const nextKey = quarterKey(nextQ);
  let forecastThisQuarter = 0;
  let forecastNextQuarter = 0;
  for (const o of open) {
    const d = parseODataDate(o.ExpectedProcessingEndDate);
    if (!d) continue;
    const k = quarterKey(quarterOf(d));
    const w = toNumber(o.ExpectedRevenueAmount) * (toNumber(o.ProbabilityPercent) / 100);
    if (k === curKey) forecastThisQuarter += w;
    else if (k === nextKey) forecastNextQuarter += w;
  }

  // Ordered open stages (reuse pipelineStages, plus avg probability)
  const stages = pipelineStages(open);
  const probByStage = new Map();
  for (const o of open) {
    const s = o.SalesCyclePhaseCodeText || 'Unknown';
    const acc = probByStage.get(s) || { sum: 0, n: 0 };
    acc.sum += toNumber(o.ProbabilityPercent);
    acc.n += 1;
    probByStage.set(s, acc);
  }
  const stagesWithProb = stages.map((s) => {
    const p = probByStage.get(s.stage);
    return { ...s, avgProbability: p && p.n ? Math.round(p.sum / p.n) : 0 };
  });

  // Funnel: conversion to next + drop-off, biggest drop flagged
  const funnelStages = stagesWithProb.map((s, i) => {
    const next = stagesWithProb[i + 1];
    const conversionToNext = next && s.count ? (next.count / s.count) * 100 : null;
    const dropOff = conversionToNext == null ? null : 100 - conversionToNext;
    return {
      stage: s.stage,
      count: s.count,
      totalValue: s.totalValue,
      weightedValue: s.weightedValue,
      conversionToNext: conversionToNext == null ? null : Math.round(conversionToNext),
      dropOff: dropOff == null ? null : Math.round(dropOff),
    };
  });
  const maxDrop = Math.max(...funnelStages.map((s) => (s.dropOff == null ? -1 : s.dropOff)), -1);
  for (const s of funnelStages) {
    s.highDropOff = s.dropOff != null && s.dropOff === maxDrop && s.dropOff >= 50;
  }
  const overallWinRate = won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null;

  // Monthly forecast trend (next 6 months by expected close, weighted + gross)
  const monthly = trendByMonth(
    open.filter((o) => {
      const d = parseODataDate(o.ExpectedProcessingEndDate);
      return d && d >= new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    }),
    'ExpectedProcessingEndDate',
    'ExpectedRevenueAmount',
    6,
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 5, 1))
  ).map((m) => {
    const inMonth = open.filter((o) => {
      const d = parseODataDate(o.ExpectedProcessingEndDate);
      return d && `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` === m.month;
    });
    return { month: m.month, openValue: m.total, weightedValue: sumWeighted(inMonth) };
  });

  // Forecast by quarter (open expected-close), current + next 3
  const quarterMap = new Map();
  for (let i = 0; i < 4; i++) {
    const qq = shiftQuarter(curQ, i);
    quarterMap.set(quarterKey(qq), { quarter: quarterKey(qq), openValue: 0, weightedValue: 0, count: 0 });
  }
  for (const o of open) {
    const d = parseODataDate(o.ExpectedProcessingEndDate);
    if (!d) continue;
    const bucket = quarterMap.get(quarterKey(quarterOf(d)));
    if (!bucket) continue;
    bucket.openValue += toNumber(o.ExpectedRevenueAmount);
    bucket.weightedValue += toNumber(o.ExpectedRevenueAmount) * (toNumber(o.ProbabilityPercent) / 100);
    bucket.count += 1;
  }
  const quarters = [...quarterMap.values()].map((q) => ({ ...q, isCurrent: q.quarter === curKey }));

  // ---- Snapshot-derived flow (Sankey) ----
  // Progression i→i+1 ≈ deals that reached stage i+1 (its current count).
  // Closed deals terminate from their recorded final phase into Won / Lost.
  const stageNames = stagesWithProb.map((s) => s.stage);
  const nodeNames = [...stageNames, 'Won', 'Lost'];
  const idx = new Map(nodeNames.map((n, i) => [n, i]));
  const links = [];
  for (let i = 0; i < stagesWithProb.length - 1; i++) {
    const next = stagesWithProb[i + 1];
    if (next.count > 0) {
      links.push({ source: i, target: i + 1, value: next.count, amount: next.totalValue, kind: 'progress' });
    }
  }
  const terminalFrom = (rows, targetName) => {
    const byPhase = groupBy(rows, 'SalesCyclePhaseCodeText');
    for (const [phase, recs] of Object.entries(byPhase)) {
      const from = idx.has(phase) ? idx.get(phase) : stageNames.length - 1; // fall back to last stage
      if (from < 0) continue;
      links.push({
        source: from,
        target: idx.get(targetName),
        value: recs.length,
        amount: sumVal(recs),
        kind: targetName.toLowerCase(),
      });
    }
  };
  if (stageNames.length) {
    terminalFrom(won, 'Won');
    terminalFrom(lost, 'Lost');
  }
  // Collapse duplicate (source,target) links produced by phase grouping
  const merged = new Map();
  for (const l of links) {
    const key = `${l.source}->${l.target}`;
    const m = merged.get(key);
    if (m) {
      m.value += l.value;
      m.amount += l.amount;
    } else {
      merged.set(key, { ...l });
    }
  }
  const flow = {
    nodes: nodeNames.map((name) => ({ name })),
    links: [...merged.values()].filter((l) => l.value > 0),
    derived: true,
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
      closedWonValue,
      closedLostValue,
    },
    stages: stagesWithProb,
    funnel: { stages: funnelStages, overallWinRate },
    forecast: {
      byStage: stagesWithProb.map((s) => ({ stage: s.stage, totalValue: s.totalValue, weightedValue: s.weightedValue })),
      monthly,
      quarters,
      currentQuarter: curKey,
      nextQuarter: nextKey,
      forecastThisQuarter,
      forecastNextQuarter,
      closedWonValue,
      closedLostValue,
    },
    flow,
    meta: {
      total: records.length,
      openCount: open.length,
      wonCount: won.length,
      lostCount: lost.length,
      currency: records.find((r) => r.CurrencyCode)?.CurrencyCode || 'EUR',
    },
  };
}

/** Compact funnel for the previous-period comparison overlay. */
export function funnelSnapshot(records) {
  const open = records.filter((o) => isOpenStatus(o.LifeCycleStatusCodeText));
  const won = records.filter((o) => isWonStatus(o.LifeCycleStatusCodeText));
  const lost = records.filter(
    (o) => !isOpenStatus(o.LifeCycleStatusCodeText) && !isWonStatus(o.LifeCycleStatusCodeText)
  );
  const stages = pipelineStages(open).map((s) => ({ stage: s.stage, count: s.count, totalValue: s.totalValue }));
  const overallWinRate = won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null;
  return { stages, overallWinRate };
}

function isSameDay(a, b) {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

const TASK_DONE_RE = /complete|finish|cancel/i;

/**
 * Cross-entity daily summary for the Daily Briefing page.
 */
export function dailySummary(quotes, opps, tasks, rfqs, visits, appointments, today = new Date()) {
  const openQuotes = quotes.filter((q) => isOpenStatus(q.LifeCycleStatusCodeText));
  const openOpps = opps.filter((o) => isOpenStatus(o.LifeCycleStatusCodeText));
  const openRFQs = rfqs.filter((r) => isOpenStatus(r.RFQStatusText));

  let overdueTasksCount = 0;
  let tasksToday = 0;
  for (const t of tasks) {
    if (TASK_DONE_RE.test(t.StatusText || '')) continue;
    const due = parseODataDate(t.DueDateTime);
    if (!due) continue;
    if (isSameDay(due, today)) tasksToday += 1;
    else if (due < today) overdueTasksCount += 1;
  }

  const visitsToday = visits.filter((v) => {
    const d = parseODataDate(v.StartDateTime);
    return d && isSameDay(d, today);
  }).length;

  const appointmentsToday = appointments.filter((a) => {
    const d = parseODataDate(a.StartDate);
    return d && isSameDay(d, today);
  }).length;

  const quotesCreatedToday = quotes.filter((q) => {
    const d = parseODataDate(q.CreationDateTime);
    return d && isSameDay(d, today);
  }).length;

  const totalPipelineValue = openOpps.reduce(
    (acc, o) => acc + toNumber(o.ExpectedRevenueAmount),
    0
  );

  return {
    openQuotes: openQuotes.length,
    openOpportunities: openOpps.length,
    overdueTasksCount,
    tasksToday,
    openRFQs: openRFQs.length,
    visitsToday,
    appointmentsToday,
    quotesCreatedToday,
    totalPipelineValue,
  };
}

/**
 * Quotes created per day for the last 7 days (Daily Briefing chart).
 */
export function quotesByDayThisWeek(quotes, today = new Date()) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    days.push({ date: d, key: d.toISOString().slice(0, 10), count: 0 });
  }
  for (const q of quotes) {
    const d = parseODataDate(q.CreationDateTime);
    if (!d) continue;
    const day = days.find((x) => isSameDay(x.date, d));
    if (day) day.count += 1;
  }
  return days.map(({ key, count }) => ({ day: key, count }));
}
