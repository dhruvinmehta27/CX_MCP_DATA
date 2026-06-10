/**
 * Analytics service — one function per query type.
 * Each function: cache check → fetch all pages from C4C → aggregate → cache.
 * Shared by the REST routes and the Claude-powered dashboard generator.
 */
import {
  fetchQuotes, fetchOpportunities, fetchRFQs,
  fetchTasks, fetchVisits, fetchAppointments,
} from './c4c-client.js';
import {
  countBy, sumBy, trendByMonth, pipelineStages, dailySummary,
  quotesByDayThisWeek, isOpenStatus, parseODataDate, toNumber,
} from './aggregations.js';
import { getOrSet } from './cache.js';

const BIZ_TYPE_LABELS = { 11: 'New', 12: 'Follow-up', 13: 'Replacement' };

export async function quotesByStatus(filters, userJwt, userEmail) {
  return getOrSet(userEmail, 'quotes/by-status', filters, async () => {
    const { results } = await fetchQuotes(filters, userJwt);
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
    const { results } = await fetchQuotes(filters, userJwt);
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
    const { results } = await fetchQuotes(effective, userJwt);
    return trendByMonth(results, 'CreationDateTime', 'NetAmount', months)
      .map(({ month, count, total }) => ({ month, count, totalAmount: total }));
  });
}

export async function quotesByBizType(filters, userJwt, userEmail) {
  return getOrSet(userEmail, 'quotes/by-biz-type', filters, async () => {
    const { results } = await fetchQuotes(filters, userJwt);
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
    const { results } = await fetchQuotes(filters, userJwt);
    return sumBy(results, 'BuyerPartyName', 'NetAmount')
      .slice(0, limit)
      .map(({ label, count, total }) => ({ customer: label, count, totalAmount: total }));
  });
}

export async function quotesList(filters, userJwt, userEmail) {
  const limit = Math.min(parseInt(filters.limit || '500', 10), 2000);
  return getOrSet(userEmail, 'quotes/list', { ...filters, limit }, async () => {
    const { total, results } = await fetchQuotes(filters, userJwt);
    const rows = [...results]
      .sort((a, b) => (parseODataDate(b.CreationDateTime) || 0) - (parseODataDate(a.CreationDateTime) || 0))
      .slice(0, limit)
      .map((q) => ({
        id: q.ID,
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
    const { results } = await fetchOpportunities(filters, userJwt);
    return pipelineStages(results);
  });
}

export async function opportunitiesByOwner(filters, userJwt, userEmail) {
  return getOrSet(userEmail, 'opportunities/by-owner', filters, async () => {
    const { results } = await fetchOpportunities(filters, userJwt);
    return sumBy(results, 'MainEmployeeResponsiblePartyName', 'ExpectedRevenueAmount')
      .slice(0, 20)
      .map(({ label, count, total }) => ({ owner: label, count, totalValue: total }));
  });
}

export async function opportunitiesCloseTrend(filters, userJwt, userEmail) {
  const months = parseInt(filters.months || '6', 10);
  return getOrSet(userEmail, 'opportunities/close-trend', { ...filters, months }, async () => {
    const { results } = await fetchOpportunities(filters, userJwt);
    const now = new Date();
    // Expected closes look forward, not back
    const future = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months - 1, 1));
    return trendByMonth(results, 'ExpectedProcessingEndDate', 'ExpectedRevenueAmount', months, future)
      .map(({ month, count, total }) => ({ month, count, totalValue: total }));
  });
}

export async function opportunitiesList(filters, userJwt, userEmail) {
  const limit = Math.min(parseInt(filters.limit || '500', 10), 2000);
  return getOrSet(userEmail, 'opportunities/list', { ...filters, limit }, async () => {
    const { total, results } = await fetchOpportunities(filters, userJwt);
    const rows = [...results]
      .sort((a, b) => (parseODataDate(b.CreationDateTime) || 0) - (parseODataDate(a.CreationDateTime) || 0))
      .slice(0, limit)
      .map((o) => ({
        id: o.ID,
        name: o.Name,
        account: o.ProspectPartyName,
        stage: o.SalesPhaseCodeText,
        status: o.LifeCycleStatusCodeText,
        expectedValue: toNumber(o.ExpectedRevenueAmount),
        expectedClose: parseODataDate(o.ExpectedProcessingEndDate)?.toISOString() || null,
        owner: o.MainEmployeeResponsiblePartyName,
      }));
    return { total, rows };
  });
}

export async function rfqsByStatus(filters, userJwt, userEmail) {
  return getOrSet(userEmail, 'rfqs/by-status', filters, async () => {
    const { results } = await fetchRFQs(filters, userJwt);
    return countBy(results, 'RFQStatusText').map(({ label, count }) => ({ status: label, count }));
  });
}

export async function rfqsTrend(filters, userJwt, userEmail) {
  const months = parseInt(filters.months || '6', 10);
  return getOrSet(userEmail, 'rfqs/trend', { ...filters, months }, async () => {
    const { results } = await fetchRFQs(filters, userJwt);
    return trendByMonth(results, 'CreationDateTime', null, months)
      .map(({ month, count }) => ({ month, count }));
  });
}

export async function rfqsList(filters, userJwt, userEmail) {
  const limit = Math.min(parseInt(filters.limit || '500', 10), 2000);
  return getOrSet(userEmail, 'rfqs/list', { ...filters, limit }, async () => {
    const { total, results } = await fetchRFQs(filters, userJwt);
    const rows = [...results]
      .sort((a, b) => (parseODataDate(a.RFQDueDate) || Infinity) - (parseODataDate(b.RFQDueDate) || Infinity))
      .slice(0, limit)
      .map((r) => ({
        id: r.ID,
        name: r.Name,
        account: r.AccountName,
        status: r.RFQStatusText,
        dueDate: parseODataDate(r.RFQDueDate)?.toISOString() || null,
        owner: r.OwnerName,
        created: parseODataDate(r.CreationDateTime)?.toISOString() || null,
        open: isOpenStatus(r.RFQStatusText),
      }));
    return { total, rows };
  });
}

export async function getDailySummary(filters, userJwt, userEmail) {
  return getOrSet(userEmail, 'daily-summary', filters, async () => {
    const today = new Date();
    const recentFrom = new Date(today);
    recentFrom.setUTCDate(recentFrom.getUTCDate() - 7);
    const weekFilters = { ...filters, dateFrom: recentFrom.toISOString().slice(0, 10) };

    const [quotes, opps, tasks, rfqs, visits, appointments] = await Promise.all([
      fetchQuotes(filters, userJwt),
      fetchOpportunities(filters, userJwt),
      fetchTasks(filters, userJwt),
      fetchRFQs(filters, userJwt),
      fetchVisits(weekFilters, userJwt),
      fetchAppointments(weekFilters, userJwt),
    ]);

    const summary = dailySummary(
      quotes.results, opps.results, tasks.results,
      rfqs.results, visits.results, appointments.results, today
    );

    // Extra payloads so the Daily Briefing renders from a single call
    summary.quotesByDay = quotesByDayThisWeek(quotes.results, today);
    summary.pipeline = pipelineStages(opps.results.filter((o) => isOpenStatus(o.LifeCycleStatusCodeText)));
    summary.recentOpenQuotes = quotes.results
      .filter((q) => isOpenStatus(q.LifeCycleStatusCodeText))
      .sort((a, b) => (parseODataDate(b.CreationDateTime) || 0) - (parseODataDate(a.CreationDateTime) || 0))
      .slice(0, 10)
      .map((q) => ({
        id: q.ID,
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
        account: t.MainAccountPartyName,
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
