/**
 * Smoke tests for pure aggregation functions with mock C4C-shaped data.
 * Run: npm run test:aggregations
 */
import assert from 'node:assert/strict';
import {
  parseODataDate, groupBy, countBy, sumBy, trendByMonth,
  pipelineStages, dailySummary, isOpenStatus, quotesByDayThisWeek,
} from '../src/aggregations.js';

const NOW = new Date('2026-06-10T12:00:00Z');
const od = (iso) => `/Date(${new Date(iso).getTime()})/`;

// parseODataDate handles both formats
assert.equal(parseODataDate(od('2026-01-15T00:00:00Z')).toISOString(), '2026-01-15T00:00:00.000Z');
assert.equal(parseODataDate('2026-01-15T00:00:00Z').toISOString(), '2026-01-15T00:00:00.000Z');
assert.equal(parseODataDate(null), null);
assert.equal(parseODataDate('garbage'), null);

const quotes = [
  { LifeCycleStatusCodeText: 'Open', NetAmount: '100.50', SalesOrganisationName: 'TSS DE', CreationDateTime: od('2026-06-10T08:00:00Z'), BuyerPartyName: 'ACME' },
  { LifeCycleStatusCodeText: 'Open', NetAmount: '200', SalesOrganisationName: 'TSS DE', CreationDateTime: od('2026-06-08T08:00:00Z'), BuyerPartyName: 'ACME' },
  { LifeCycleStatusCodeText: 'Won', NetAmount: '1000', SalesOrganisationName: 'TSS US', CreationDateTime: od('2026-05-01T08:00:00Z'), BuyerPartyName: 'Globex' },
  { LifeCycleStatusCodeText: 'Lost', NetAmount: '50', SalesOrganisationName: 'TSS US', CreationDateTime: od('2026-04-01T08:00:00Z'), BuyerPartyName: 'Initech' },
];

// groupBy / countBy / sumBy
assert.equal(Object.keys(groupBy(quotes, 'LifeCycleStatusCodeText')).length, 3);
const counts = countBy(quotes, 'LifeCycleStatusCodeText');
assert.deepEqual(counts[0], { label: 'Open', count: 2 });
const sums = sumBy(quotes, 'SalesOrganisationName', 'NetAmount');
assert.equal(sums[0].label, 'TSS US');
assert.equal(sums[0].total, 1050);
assert.equal(sums[1].total, 300.5);

// trendByMonth — 3 months ending June 2026, gaps filled
const trend = trendByMonth(quotes, 'CreationDateTime', 'NetAmount', 3, NOW);
assert.deepEqual(trend.map((t) => t.month), ['2026-04', '2026-05', '2026-06']);
assert.equal(trend[2].count, 2);
assert.equal(trend[2].total, 300.5);
assert.equal(trend[0].total, 50);

// pipelineStages ordered by code
const opps = [
  { SalesPhaseCode: '03', SalesPhaseCodeText: 'Quote', ExpectedRevenueAmount: '500', LifeCycleStatusCodeText: 'Open' },
  { SalesPhaseCode: '01', SalesPhaseCodeText: 'Identify', ExpectedRevenueAmount: '100', LifeCycleStatusCodeText: 'Open' },
  { SalesPhaseCode: '01', SalesPhaseCodeText: 'Identify', ExpectedRevenueAmount: '300', LifeCycleStatusCodeText: 'Open' },
];
const stages = pipelineStages(opps);
assert.equal(stages[0].stage, 'Identify');
assert.equal(stages[0].count, 2);
assert.equal(stages[0].totalValue, 400);
assert.equal(stages[0].avgValue, 200);
assert.equal(stages[1].stage, 'Quote');

// isOpenStatus
assert.equal(isOpenStatus('Open'), true);
assert.equal(isOpenStatus('In Process'), true);
assert.equal(isOpenStatus('Won'), false);
assert.equal(isOpenStatus('Completed'), false);

// dailySummary
const tasks = [
  { StatusText: 'Open', DueDateTime: od('2026-06-10T09:00:00Z') },   // today
  { StatusText: 'Open', DueDateTime: od('2026-06-01T09:00:00Z') },   // overdue
  { StatusText: 'Completed', DueDateTime: od('2026-06-01T09:00:00Z') }, // done — ignored
];
const visits = [{ StartDateTime: od('2026-06-10T10:00:00Z') }];
const appts = [{ StartDate: od('2026-06-10T14:00:00Z') }];
const rfqs = [{ RFQStatusText: 'Open' }, { RFQStatusText: 'Closed' }];
const summary = dailySummary(quotes, opps, tasks, rfqs, visits, appts, NOW);
assert.equal(summary.openQuotes, 2);
assert.equal(summary.openOpportunities, 3);
assert.equal(summary.overdueTasksCount, 1);
assert.equal(summary.tasksToday, 1);
assert.equal(summary.openRFQs, 1);
assert.equal(summary.visitsToday, 1);
assert.equal(summary.appointmentsToday, 1);
assert.equal(summary.quotesCreatedToday, 1);
assert.equal(summary.totalPipelineValue, 900);

// quotesByDayThisWeek — 7 buckets, today last
const byDay = quotesByDayThisWeek(quotes, NOW);
assert.equal(byDay.length, 7);
assert.equal(byDay[6].day, '2026-06-10');
assert.equal(byDay[6].count, 1);
assert.equal(byDay[4].count, 1); // 2026-06-08

console.log('✓ all aggregation tests passed');
