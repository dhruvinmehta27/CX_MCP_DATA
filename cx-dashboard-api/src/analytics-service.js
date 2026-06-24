/**
 * Analytics service — one function per query type.
 * Each function: cache check → fetch all pages from C4C → aggregate → cache.
 * Shared by the REST routes and the Claude-powered dashboard generator.
 */
import {
  fetchQuotes, fetchOpportunities, fetchRFQs,
  fetchTasks, fetchVisits, fetchAppointments,
  countQuotes, countOpportunities, countRFQs,
} from './c4c-client.js';
import {
  countBy, sumBy, trendByMonth, pipelineStages, dailySummary,
  quotesByDayThisWeek, isOpenStatus, isRfqOpen, parseODataDate, toNumber,
  pipelineOverview, funnelSnapshot, oppValue,
} from './aggregations.js';
import { getOrSet } from './cache.js';

const BIZ_TYPE_LABELS = { 11: 'New', 12: 'Follow-up', 13: 'Replacement' };

/**
 * Raw-dataset cache shared by all endpoints of one entity. Keyed only on
 * the base filters, so the six quote endpoints (by-status, trend, list, …)
 * trigger ONE paginated C4C fetch instead of six — combined with in-flight
 * coalescing in getOrSet this prevents the parallel-fetch stampede that
 * exhausted memory on wide date ranges.
 */
function baseFilters(filters = {}) {
  const { salesOrgId, ownerId, dateFrom, dateTo } = filters;
  return { salesOrgId, ownerId, dateFrom, dateTo };
}

async function rawQuotes(filters, userJwt, userEmail) {
  const base = baseFilters(filters);
  const { data } = await getOrSet(userEmail, 'raw:quotes', base, () => fetchQuotes(base, userJwt));
  return data;
}

async function rawOpportunities(filters, userJwt, userEmail) {
  const base = baseFilters(filters);
  const { data } = await getOrSet(userEmail, 'raw:opportunities', base, () => fetchOpportunities(base, userJwt));
  return data;
}

async function rawRFQs(filters, userJwt, userEmail) {
  const base = baseFilters(filters);
  const { data } = await getOrSet(userEmail, 'raw:rfqs', base, () => fetchRFQs(base, userJwt));
  return data;
}

export async function quotesByStatus(filters, userJwt, userEmail) {
  return getOrSet(userEmail, 'quotes/by-status', filters, async () => {
    const { results } = await rawQuotes(filters, userJwt, userEmail);
    const sums = sumBy(results, 'LifeCycleStatusCodeText', 'NetAmount');
    const currency = results.find((r) => r.CurrencyCode)?.CurrencyCode || 'EUR';
    return sums.map(({ label, count, total }) => ({
      status: label, count, totalAmount: total, currency,
    }));
  });
}

export async function quotesBySalesOrg(filters, userJwt, userEmail) {
  const limit = parseInt(filters.limit || '20', 10);
  return getOrSet(userEmail, 'quotes/by-sales-org', { ...filters, limit }, async () => {
    const { results } = await rawQuotes(filters, userJwt, userEmail);
    return sumBy(results, 'SalesOrganisationName', 'NetAmount')
      .slice(0, limit)
      .map(({ label, count, total }) => ({ salesOrg: label, count, totalAmount: total }));
  });
}

export async function quotesTrend(filters, userJwt, userEmail) {
  const months = parseInt(filters.months || '6', 10);
  return getOrSet(userEmail, 'quotes/trend', { ...filters, months }, async () => {
    const from = new Date();
    from.setUTCMonth(from.getUTCMonth() - (months - 1), 1);
    const effective = { ...filters, dateFrom: filters.dateFrom || from.toISOString().slice(0, 10) };
    const { results } = await rawQuotes(effective, userJwt, userEmail);
    return trendByMonth(results, 'CreationDateTime', 'NetAmount', months)
      .map(({ month, count, total }) => ({ month, count, totalAmount: total }));
  });
}

export async function quotesByBizType(filters, userJwt, userEmail) {
  return getOrSet(userEmail, 'quotes/by-biz-type', filters, async () => {
    const { results } = await rawQuotes(filters, userJwt, userEmail);
    return sumBy(results, 'ZBIZTYPE', 'NetAmount').map(({ label, count, total }) => ({
      bizType: BIZ_TYPE_LABELS[label] || label,
      count,
      totalAmount: total,
    }));
  });
}

export async function quotesTopCustomers(filters, userJwt, userEmail) {
  const limit = parseInt(filters.limit || '10', 10);
  return getOrSet(userEmail, 'quotes/top-customers', { ...filters, limit }, async () => {
    const { results } = await rawQuotes(filters, userJwt, userEmail);
    return sumBy(results, 'BuyerPartyName', 'NetAmount')
      .slice(0, limit)
      .map(({ label, count, total }) => ({ customer: label, count, totalAmount: total }));
  });
}

export async function quotesList(filters, userJwt, userEmail) {
  const limit = Math.min(parseInt(filters.limit || '500', 10), 2000);
  return getOrSet(userEmail, 'quotes/list', { ...filters, limit }, async () => {
    const { total, results } = await rawQuotes(filters, userJwt, userEmail);
    const rows = [...results]
      .sort((a, b) => (parseODataDate(b.CreationDateTime) || 0) - (parseODataDate(a.CreationDateTime) || 0))
      .slice(0, limit)
      .map((q) => ({
        id: q.ID,
        objectId: q.ObjectID,
        customer: q.BuyerPartyName,
        salesOrg: q.SalesOrganisationName,
        status: q.LifeCycleStatusCodeText,
        amount: toNumber(q.NetAmount),
        currency: q.CurrencyCode,
        created: parseODataDate(q.CreationDateTime)?.toISOString() || null,
        owner: q.EmployeeResponsiblePartyName,
      }));
    return { total, rows };
  });
}

export async function opportunitiesPipeline(filters, userJwt, userEmail) {
  return getOrSet(userEmail, 'opportunities/pipeline', filters, async () => {
    const { results } = await rawOpportunities(filters, userJwt, userEmail);
    return pipelineStages(results);
  });
}

export async function opportunitiesByOwner(filters, userJwt, userEmail) {
  return getOrSet(userEmail, 'opportunities/by-owner', filters, async () => {
    const { results } = await rawOpportunities(filters, userJwt, userEmail);
    return sumBy(results, 'MainEmployeeResponsiblePartyName', oppValue)
      .slice(0, 20)
      .map(({ label, count, total }) => ({ owner: label, count, totalValue: total }));
  });
}

export async function ownersList(filters, userJwt, userEmail) {
  return getOrSet(userEmail, 'owners/list', {}, async () => {
    const { results } = await rawOpportunities({}, userJwt, userEmail);
    const seen = new Set();
    return results
      .map((r) => r.MainEmployeeResponsiblePartyName)
      .filter((n) => n && !seen.has(n) && seen.add(n))
      .sort()
      .map((name) => ({ name }));
  });
}

export async function opportunitiesCloseTrend(filters, userJwt, userEmail) {
  const months = parseInt(filters.months || '6', 10);
  return getOrSet(userEmail, 'opportunities/close-trend', { ...filters, months }, async () => {
    const { results } = await rawOpportunities(filters, userJwt, userEmail);
    const now = new Date();
    // Expected closes look forward, not back
    const future = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months - 1, 1));
    return trendByMonth(results, 'ExpectedProcessingEndDate', oppValue, months, future)
      .map(({ month, count, total }) => ({ month, count, totalValue: total }));
  });
}

export async function opportunitiesList(filters, userJwt, userEmail) {
  // Cap raised to 20k so the Pipeline Command Center can aggregate large
  // pipelines client-side; the Kanban virtualizes cards per column.
  const limit = Math.min(parseInt(filters.limit || '500', 10), 20000);
  return getOrSet(userEmail, 'opportunities/list', { ...filters, limit }, async () => {
    const { total, results, truncated } = await rawOpportunities(filters, userJwt, userEmail);
    const rows = [...results]
      .sort((a, b) => (parseODataDate(b.CreationDateTime) || 0) - (parseODataDate(a.CreationDateTime) || 0))
      .slice(0, limit)
      .map((o) => ({
        id: o.ID,
        objectId: o.ObjectID,
        name: o.Name,
        account: o.ProspectPartyName,
        stage: o.SalesCyclePhaseCodeText,
        stageCode: o.SalesCyclePhaseCode,
        status: o.LifeCycleStatusCodeText,
        expectedValue: oppValue(o),
        probability: toNumber(o.ProbabilityPercent),
        weightedValue: oppValue(o) * (toNumber(o.ProbabilityPercent) / 100),
        expectedClose: parseODataDate(o.ExpectedProcessingEndDate)?.toISOString() || null,
        created: parseODataDate(o.CreationDateTime)?.toISOString() || null,
        lastActivity: parseODataDate(o.EntityLastChangedOn)?.toISOString() || null,
        owner: o.MainEmployeeResponsiblePartyName,
        source: o.OriginTypeCodeText || null,
        oppType: o.OpportunityLevel_KUTText || null,
        territory: o.SalesTerritoryName || null,
        segment: o.BUS_SEG_CDE_KUTText || null,
        subSegment: o.MKT_SEG_CODEText || null,
      }));
    // truncated = the C4C set exceeded the safety cap; rows are a partial view
    return { total, rows, truncated: Boolean(truncated) || total > limit };
  });
}

/**
 * One-pass aggregate package for the Pipeline Command Center
 * (KPI header + Kanban totals + Funnel + Forecast + derived Flow).
 * When compare=true, also fetches the immediately-preceding period of equal
 * length for the funnel comparison overlay — reuses the shared raw cache.
 */
export async function pipelineOverviewSvc(filters, userJwt, userEmail) {
  const compare = filters.compare === '1' || filters.compare === 'true' || filters.compare === true;
  return getOrSet(userEmail, 'opportunities/pipeline-overview', { ...filters, compare }, async () => {
    const { results } = await rawOpportunities(filters, userJwt, userEmail);
    const overview = pipelineOverview(results, new Date());

    if (compare && filters.dateFrom && filters.dateTo) {
      const from = new Date(filters.dateFrom);
      const to = new Date(filters.dateTo);
      const spanMs = Math.max(to - from, 86_400_000);
      const prevTo = new Date(from.getTime() - 86_400_000);
      const prevFrom = new Date(prevTo.getTime() - spanMs);
      const prevFilters = {
        ...baseFilters(filters),
        dateFrom: prevFrom.toISOString().slice(0, 10),
        dateTo: prevTo.toISOString().slice(0, 10),
      };
      const prev = await rawOpportunities(prevFilters, userJwt, userEmail);
      overview.funnel.previous = funnelSnapshot(prev.results);
      overview.meta.prevPeriod = { from: prevFilters.dateFrom, to: prevFilters.dateTo };
    }
    return overview;
  });
}

export async function rfqsByStatus(filters, userJwt, userEmail) {
  return getOrSet(userEmail, 'rfqs/by-status', filters, async () => {
    const { results } = await rawRFQs(filters, userJwt, userEmail);
    return countBy(results, 'RFQStatusText').map(({ label, count }) => ({
      status: label,
      count,
      open: isRfqOpen(label),
    }));
  });
}

export async function rfqsTrend(filters, userJwt, userEmail) {
  const months = parseInt(filters.months || '6', 10);
  return getOrSet(userEmail, 'rfqs/trend', { ...filters, months }, async () => {
    const { results } = await rawRFQs(filters, userJwt, userEmail);
    return trendByMonth(results, 'CreationDateTime', null, months)
      .map(({ month, count }) => ({ month, count }));
  });
}

export async function rfqsList(filters, userJwt, userEmail) {
  // High cap so All/Closed scopes (which can run to tens of thousands) are fully
  // browsable client-side; the raw set is already fetched, this only slices it.
  const limit = Math.min(parseInt(filters.limit || '500', 10), 20000);
  const scope = filters.scope === 'open' || filters.scope === 'closed' ? filters.scope : 'all';
  return getOrSet(userEmail, 'rfqs/list', { ...filters, limit, scope }, async () => {
    const { results } = await rawRFQs(filters, userJwt, userEmail);

    // De-dupe by ObjectID — backstop against any pagination overlap so counts
    // and the table never double-count the same RFQ.
    const seen = new Set();
    const unique = [];
    for (const r of results) {
      const key = r.ObjectID || `${r.ID}|${r.RFQStatusText}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(r);
    }

    // Accurate open/closed + due counts over the FULL de-duped set so the KPIs
    // are correct regardless of the per-scope row cap.
    const now = new Date();
    const weekEnd = new Date(now.getTime() + 7 * 86_400_000);
    let openCount = 0;
    let closedCount = 0;
    let overdueCount = 0;
    let dueThisWeekCount = 0;
    for (const r of unique) {
      if (isRfqOpen(r.RFQStatusText)) {
        openCount += 1;
        const due = parseODataDate(r.RFQDueDate);
        if (due) {
          if (due < now) overdueCount += 1;
          else if (due <= weekEnd) dueThisWeekCount += 1;
        }
      } else {
        closedCount += 1;
      }
    }

    // Filter to the requested scope BEFORE capping, so "Open" returns open rows
    // (up to the cap) rather than whatever open rows fell into a mixed sample.
    const scoped =
      scope === 'open'
        ? unique.filter((r) => isRfqOpen(r.RFQStatusText))
        : scope === 'closed'
          ? unique.filter((r) => !isRfqOpen(r.RFQStatusText))
          : unique;

    const rows = [...scoped]
      .sort((a, b) => (parseODataDate(a.RFQDueDate) || Infinity) - (parseODataDate(b.RFQDueDate) || Infinity))
      .slice(0, limit)
      .map((r) => ({
        id: r.ID,
        objectId: r.ObjectID,
        name: r.Name,
        account: r.AccountName,
        status: r.RFQStatusText,
        dueDate: parseODataDate(r.RFQDueDate)?.toISOString() || null,
        owner: r.OwnerName,
        created: parseODataDate(r.CreationDateTime)?.toISOString() || null,
        open: isRfqOpen(r.RFQStatusText),
      }));
    return {
      total: unique.length,
      matching: scoped.length,
      scope,
      openCount,
      closedCount,
      overdueCount,
      dueThisWeekCount,
      rows,
    };
  });
}

export async function getDailySummary(filters, userJwt, userEmail) {
  return getOrSet(userEmail, 'daily-summary', filters, async () => {
    const today = new Date();
    const recentFrom = new Date(today);
    recentFrom.setUTCDate(recentFrom.getUTCDate() - 7);
    const weekFilters = { ...filters, dateFrom: recentFrom.toISOString().slice(0, 10) };

    // allSettled so one bad collection reports alongside the others
    // instead of masking them one redeploy at a time
    const settled = await Promise.allSettled([
      rawQuotes(filters, userJwt, userEmail),
      rawOpportunities(filters, userJwt, userEmail),
      fetchTasks(filters, userJwt),
      rawRFQs(filters, userJwt, userEmail),
      fetchVisits(weekFilters, userJwt),
      fetchAppointments(weekFilters, userJwt),
    ]);
    const failures = settled.filter((s) => s.status === 'rejected');
    if (failures.length) {
      throw new Error(failures.map((f) => f.reason?.message || String(f.reason)).join(' || '));
    }
    const [quotes, opps, tasks, rfqs, visits, appointments] = settled.map((s) => s.value);

    const summary = dailySummary(
      quotes.results, opps.results, tasks.results,
      rfqs.results, visits.results, appointments.results, today
    );

    // Exact open counts via OData inline count — correct on any range and not
    // limited by the record cap (the fetched results above are only used for
    // sums / lists / the stage chart). Best-effort: keep the sampled counts if
    // a count query fails.
    const [cQuotes, cOpps, cRfqs] = await Promise.allSettled([
      countQuotes(filters, userJwt),
      countOpportunities(filters, userJwt),
      countRFQs(filters, userJwt),
    ]);
    if (cQuotes.status === 'fulfilled') summary.openQuotes = cQuotes.value.open;
    if (cOpps.status === 'fulfilled') summary.openOpportunities = cOpps.value.open;
    if (cRfqs.status === 'fulfilled') summary.openRFQs = cRfqs.value.open;

    // Per-figure exactness for the fail-closed UI. Counts are exact only if
    // their inline-count query succeeded; record-derived figures (sums, the
    // stage distribution) are exact only if the underlying fetch wasn't capped.
    summary.exact = {
      openQuotes: cQuotes.status === 'fulfilled',
      openOpportunities: cOpps.status === 'fulfilled',
      openRFQs: cRfqs.status === 'fulfilled',
      pipelineValue: !opps.truncated,
      pipelineByStage: !opps.truncated,
      overdueTasks: !tasks.truncated,
      // visits/appointments use a 7-day window — always within the cap
      meetings: true,
    };

    // Extra payloads so the Daily Briefing renders from a single call
    summary.quotesByDay = quotesByDayThisWeek(quotes.results, today);
    summary.pipeline = pipelineStages(opps.results.filter((o) => isOpenStatus(o.LifeCycleStatusCodeText)));
    summary.recentOpenQuotes = quotes.results
      .filter((q) => isOpenStatus(q.LifeCycleStatusCodeText))
      .sort((a, b) => (parseODataDate(b.CreationDateTime) || 0) - (parseODataDate(a.CreationDateTime) || 0))
      .slice(0, 10)
      .map((q) => ({
        id: q.ID,
        objectId: q.ObjectID,
        customer: q.BuyerPartyName,
        status: q.LifeCycleStatusCodeText,
        amount: toNumber(q.NetAmount),
        currency: q.CurrencyCode,
        created: parseODataDate(q.CreationDateTime)?.toISOString() || null,
      }));
    summary.todaysTasks = tasks.results
      .filter((t) => {
        const due = parseODataDate(t.DueDateTime);
        return due && due.toISOString().slice(0, 10) === today.toISOString().slice(0, 10);
      })
      .slice(0, 20)
      .map((t) => ({
        id: t.ID,
        subject: t.Subject,
        status: t.StatusText,
        priority: t.PriorityCodeText,
        due: parseODataDate(t.DueDateTime)?.toISOString() || null,
      }));
    return summary;
  });
}

/**
 * Dispatch table for the Claude-powered dashboard generator.
 */
export const ENDPOINT_HANDLERS = {
  'quotes/by-status': quotesByStatus,
  'quotes/by-sales-org': quotesBySalesOrg,
  'quotes/trend': quotesTrend,
  'quotes/by-biz-type': quotesByBizType,
  'quotes/top-customers': quotesTopCustomers,
  'opportunities/pipeline': opportunitiesPipeline,
  'rfqs/by-status': rfqsByStatus,
  'daily-summary': getDailySummary,
};

/**
 * Headline numbers for the Sales Brief "data included" panel.
 * Stale = open opportunity untouched for 90+ days (EntityLastChangedOn).
 */
export async function briefStats(filters, userJwt, userEmail) {
  return getOrSet(userEmail, 'brief/stats', filters, async () => {
    const [quotes, opps] = await Promise.all([
      rawQuotes(filters, userJwt, userEmail),
      rawOpportunities(filters, userJwt, userEmail),
    ]);
    const now = new Date();
    const in12m = new Date(now);
    in12m.setUTCMonth(in12m.getUTCMonth() + 12);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);

    const open = opps.results.filter((o) => isOpenStatus(o.LifeCycleStatusCodeText));
    const won = quotes.results.filter((q) => /won|accept/i.test(q.LifeCycleStatusCodeText || ''));
    const lost = quotes.results.filter((q) => /lost|reject/i.test(q.LifeCycleStatusCodeText || ''));
    const closed = won.length + lost.length;

    return {
      totalOpportunities: opps.total,
      totalQuotes: quotes.total,
      openDeals: open.length,
      openPipelineValue: open.reduce((a, o) => a + oppValue(o), 0),
      winRate: closed ? Math.round((won.length / closed) * 100) : null,
      wonCount: won.length,
      sopNext12MValue: open
        .filter((o) => {
          const d = parseODataDate(o.ExpectedProcessingEndDate);
          return d && d >= now && d <= in12m;
        })
        .reduce((a, o) => a + oppValue(o), 0),
      staleCount: open.filter((o) => {
        const d = parseODataDate(o.EntityLastChangedOn);
        return d && d < ninetyDaysAgo;
      }).length,
      orgCount: new Set(quotes.results.map((q) => q.SalesOrganisationName).filter(Boolean)).size,
      ownerCount: new Set(opps.results.map((o) => o.MainEmployeeResponsiblePartyName).filter(Boolean)).size,
    };
  });
}

/**
 * Full aggregate package the brief is written from — every piece comes out
 * of the shared raw caches, so this adds no extra C4C round trips.
 */
export async function briefData(filters, userJwt, userEmail) {
  const [stats, byStatus, bySalesOrg, trend, customers, pipeline, byOwner, closeTrend, rfqStatus] =
    await Promise.all([
      briefStats(filters, userJwt, userEmail),
      quotesByStatus(filters, userJwt, userEmail),
      quotesBySalesOrg({ ...filters, limit: 15 }, userJwt, userEmail),
      quotesTrend({ ...filters, months: 12 }, userJwt, userEmail),
      quotesTopCustomers({ ...filters, limit: 10 }, userJwt, userEmail),
      opportunitiesPipeline(filters, userJwt, userEmail),
      opportunitiesByOwner(filters, userJwt, userEmail),
      opportunitiesCloseTrend({ ...filters, months: 12 }, userJwt, userEmail),
      rfqsByStatus(filters, userJwt, userEmail),
    ]);
  return {
    stats: stats.data,
    quotesByStatus: byStatus.data,
    quotesBySalesOrg: bySalesOrg.data,
    quoteTrend: trend.data,
    topCustomers: customers.data,
    pipelineStages: pipeline.data,
    pipelineByOwner: byOwner.data,
    expectedCloseByMonth: closeTrend.data,
    rfqsByStatus: rfqStatus.data,
  };
}
