/**
 * Mock API responses for the design preview (preview.html).
 * Lets the UI render with realistic data without Azure AD or C4C.
 */
const month = (offset) => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + offset, 1);
  return d.toISOString().slice(0, 7);
};
const day = (offset) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const iso = (offset) => new Date(Date.now() + offset * 86400000).toISOString();

const STAGES = [
  { stage: 'Identify Opportunity', count: 184, totalValue: 12400000, avgValue: 67391 },
  { stage: 'Qualify Opportunity', count: 131, totalValue: 9100000, avgValue: 69465 },
  { stage: 'Develop Solution', count: 86, totalValue: 6900000, avgValue: 80232 },
  { stage: 'Quotation', count: 52, totalValue: 4300000, avgValue: 82692 },
  { stage: 'Negotiation', count: 27, totalValue: 2800000, avgValue: 103703 },
];

const QUOTE_ROWS = Array.from({ length: 137 }, (_, i) => ({
  id: String(8200 + i),
  customer: ['ACME Industrial', 'Globex GmbH', 'Initech AG', 'Umbrella Corp', 'Stark Industries', 'Wayne Enterprises'][i % 6],
  salesOrg: ['TSS Germany', 'TSS Americas', 'TSS Nordic', 'TSS Italy'][i % 4],
  status: ['Open', 'In Process', 'Won', 'Lost', 'Pending Release'][i % 5],
  amount: Math.round(8000 + (i * 7919) % 240000),
  currency: 'EUR',
  created: iso(-(i % 170)),
  owner: ['Dhruvin Mehta', 'Anna Schmidt', 'Luca Rossi', 'Erik Larsen'][i % 4],
}));

export const FIXTURES = {
  'daily-summary': {
    openQuotes: 1284,
    openOpportunities: 480,
    overdueTasksCount: 7,
    tasksToday: 5,
    openRFQs: 96,
    visitsToday: 2,
    appointmentsToday: 3,
    quotesCreatedToday: 41,
    totalPipelineValue: 35500000,
    quotesByDay: Array.from({ length: 7 }, (_, i) => ({ day: day(i - 6), count: [34, 51, 47, 12, 8, 56, 41][i] })),
    pipeline: STAGES,
    recentOpenQuotes: QUOTE_ROWS.filter((q) => q.status === 'Open' || q.status === 'In Process').slice(0, 10),
    todaysTasks: [
      { id: 'T-1', subject: 'Follow up on quote 8204 with ACME Industrial', status: 'Open', priority: 'High', due: iso(0) },
      { id: 'T-2', subject: 'Prepare RFQ response for Globex sealing kits', status: 'In Process', priority: 'Normal', due: iso(0) },
      { id: 'T-3', subject: 'Validate pricing for O-ring series 70 EPDM', status: 'Open', priority: 'Normal', due: iso(0) },
      { id: 'T-4', subject: 'Send updated drawings to Initech engineering', status: 'Open', priority: 'Low', due: iso(0) },
    ],
  },
  'quotes/by-status': [
    { status: 'Open', count: 712, totalAmount: 18400000, currency: 'EUR' },
    { status: 'In Process', count: 572, totalAmount: 12100000, currency: 'EUR' },
    { status: 'Won', count: 1320, totalAmount: 30400000, currency: 'EUR' },
    { status: 'Lost', count: 488, totalAmount: 9600000, currency: 'EUR' },
    { status: 'Pending Release', count: 104, totalAmount: 2700000, currency: 'EUR' },
  ],
  'quotes/trend': Array.from({ length: 6 }, (_, i) => ({
    month: month(i - 5),
    count: [382, 415, 391, 472, 505, 461][i],
    totalAmount: [7.4, 8.1, 7.7, 9.5, 10.2, 9.1][i] * 1e6,
  })),
  'quotes/top-customers': [
    { customer: 'ACME Industrial', count: 84, totalAmount: 4200000 },
    { customer: 'Globex GmbH', count: 61, totalAmount: 3600000 },
    { customer: 'Stark Industries', count: 47, totalAmount: 2900000 },
    { customer: 'Initech AG', count: 55, totalAmount: 2400000 },
    { customer: 'Umbrella Corp', count: 38, totalAmount: 1900000 },
    { customer: 'Wayne Enterprises', count: 29, totalAmount: 1500000 },
    { customer: 'Cyberdyne Systems', count: 33, totalAmount: 1200000 },
    { customer: 'Tyrell Corp', count: 21, totalAmount: 980000 },
    { customer: 'Soylent GmbH', count: 18, totalAmount: 760000 },
    { customer: 'Wonka Industries', count: 12, totalAmount: 540000 },
  ],
  'quotes/by-biz-type': [
    { bizType: 'New', count: 1410, totalAmount: 31200000 },
    { bizType: 'Follow-up', count: 980, totalAmount: 24300000 },
    { bizType: 'Replacement', count: 806, totalAmount: 17700000 },
  ],
  'quotes/by-sales-org': [
    { salesOrg: 'TSS Germany', count: 842, totalAmount: 21400000 },
    { salesOrg: 'TSS Americas', count: 731, totalAmount: 18200000 },
    { salesOrg: 'TSS Nordic', count: 502, totalAmount: 11900000 },
    { salesOrg: 'TSS Italy', count: 418, totalAmount: 9400000 },
    { salesOrg: 'TSS France', count: 366, totalAmount: 7800000 },
    { salesOrg: 'TSS UK', count: 290, totalAmount: 6200000 },
    { salesOrg: 'TSS Japan', count: 47, totalAmount: 4300000 },
  ],
  'quotes/list': { total: 199384, rows: QUOTE_ROWS },
  'opportunities/pipeline': STAGES,
  'opportunities/by-owner': [
    { owner: 'Dhruvin Mehta', count: 42, totalValue: 6400000 },
    { owner: 'Anna Schmidt', count: 38, totalValue: 5700000 },
    { owner: 'Luca Rossi', count: 31, totalValue: 4400000 },
    { owner: 'Erik Larsen', count: 27, totalValue: 3900000 },
    { owner: 'Marie Dubois', count: 22, totalValue: 2800000 },
  ],
  'opportunities/close-trend': Array.from({ length: 6 }, (_, i) => ({
    month: month(i),
    count: [22, 31, 27, 35, 18, 12][i],
    totalValue: [2.1, 3.4, 2.8, 4.1, 1.9, 1.2][i] * 1e6,
  })),
  'opportunities/list': {
    total: 480,
    rows: Array.from({ length: 60 }, (_, i) => ({
      id: String(5100 + i),
      name: `Sealing solution ${['hydraulics', 'aerospace', 'food & beverage', 'automotive'][i % 4]} #${i + 1}`,
      account: QUOTE_ROWS[i % 6].customer,
      stage: STAGES[i % 5].stage,
      status: 'Open',
      expectedValue: Math.round(20000 + (i * 13841) % 480000),
      expectedClose: iso((i * 5) % 170),
      owner: ['Dhruvin Mehta', 'Anna Schmidt', 'Luca Rossi', 'Erik Larsen'][i % 4],
    })),
  },
  'rfqs/by-status': [
    { status: 'Open', count: 52 },
    { status: 'In Process', count: 31 },
    { status: 'Completed', count: 144 },
    { status: 'Cancelled', count: 18 },
  ],
  'rfqs/trend': Array.from({ length: 6 }, (_, i) => ({ month: month(i - 5), count: [28, 35, 31, 44, 39, 26][i] })),
  'rfqs/list': {
    total: 245,
    rows: Array.from({ length: 40 }, (_, i) => ({
      id: `RFQ-${3000 + i}`,
      name: `RFQ ${['rotary seals', 'O-rings', 'gaskets', 'wear rings'][i % 4]} batch ${i + 1}`,
      account: QUOTE_ROWS[i % 6].customer,
      status: ['Open', 'In Process', 'Completed'][i % 3],
      dueDate: iso(i - 6),
      owner: ['Dhruvin Mehta', 'Anna Schmidt', 'Luca Rossi'][i % 3],
      created: iso(-(i + 4)),
      open: i % 3 !== 2,
    })),
  },
  'sales-orgs': [
    { id: 'DE01', name: 'TSS Germany' },
    { id: 'US01', name: 'TSS Americas' },
    { id: 'SE01', name: 'TSS Nordic' },
  ],
  'dashboard/generate': {
    chartConfig: {
      chartType: 'bar',
      data: [
        { salesOrg: 'TSS Germany', totalAmount: 21400000 },
        { salesOrg: 'TSS Americas', totalAmount: 18200000 },
        { salesOrg: 'TSS Nordic', totalAmount: 11900000 },
        { salesOrg: 'TSS Italy', totalAmount: 9400000 },
      ],
      xKey: 'salesOrg',
      yKeys: [{ key: 'totalAmount', color: '#0070F2', label: 'Quote value' }],
      title: 'Quote Value by Sales Org — Last Quarter',
      summary: 'TSS Germany leads quote value generation this quarter at €21.4M.',
      insights: [
        'TSS Germany generated 18% more quote value than TSS Americas.',
        'The top two sales orgs account for 65% of total quote value.',
        'TSS Italy shows the highest average quote value per deal.',
      ],
    },
    rawData: {
      'quotes/by-sales-org': [
        { salesOrg: 'TSS Germany', count: 842, totalAmount: 21400000 },
        { salesOrg: 'TSS Americas', count: 731, totalAmount: 18200000 },
        { salesOrg: 'TSS Nordic', count: 502, totalAmount: 11900000 },
        { salesOrg: 'TSS Italy', count: 418, totalAmount: 9400000 },
      ],
    },
    title: 'Quote Value by Sales Org — Last Quarter',
    summary: 'TSS Germany leads quote value generation this quarter at €21.4M.',
    insights: [
      'TSS Germany generated 18% more quote value than TSS Americas.',
      'The top two sales orgs account for 65% of total quote value.',
      'TSS Italy shows the highest average quote value per deal.',
    ],
    suggestedChartType: 'bar',
  },
};

export function matchFixture(url) {
  for (const [key, value] of Object.entries(FIXTURES)) {
    if (url.includes(key)) return value;
  }
  return null;
}
