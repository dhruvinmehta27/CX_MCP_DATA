import client from './client';

const get = (path, params) => client.get(path, { params }).then((r) => r.data);

export const getQuotesByStatus = (filters) => get('/api/analytics/quotes/by-status', filters);
export const getQuotesBySalesOrg = (filters) => get('/api/analytics/quotes/by-sales-org', filters);
export const getQuotesTrend = (filters) => get('/api/analytics/quotes/trend', filters);
export const getQuotesByBizType = (filters) => get('/api/analytics/quotes/by-biz-type', filters);
export const getTopCustomers = (filters) => get('/api/analytics/quotes/top-customers', filters);
export const getQuotesList = (filters) => get('/api/analytics/quotes/list', filters);
export const getPipeline = (filters) => get('/api/analytics/opportunities/pipeline', filters);
export const getPipelineByOwner = (filters) => get('/api/analytics/opportunities/by-owner', filters);
export const getCloseTrend = (filters) => get('/api/analytics/opportunities/close-trend', filters);
export const getOpportunitiesList = (filters) => get('/api/analytics/opportunities/list', filters);
export const getRFQsByStatus = (filters) => get('/api/analytics/rfqs/by-status', filters);
export const getRFQsTrend = (filters) => get('/api/analytics/rfqs/trend', filters);
export const getRFQsList = (filters) => get('/api/analytics/rfqs/list', filters);
export const getDailySummary = (filters) => get('/api/analytics/daily-summary', filters);
export const getSalesOrgs = (search) => get('/api/analytics/sales-orgs', { search });
export const clearCache = () => client.delete('/api/cache/clear').then((r) => r.data);
