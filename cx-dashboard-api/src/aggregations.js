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

export function isOpenStatus(statusText) {
  if (!statusText) return true;
  return !CLOSED_STATUS_RE.test(statusText);
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
