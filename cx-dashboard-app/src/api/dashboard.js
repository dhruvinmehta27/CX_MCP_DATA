import client from './client';

export const planReport = (userRequest, filters) =>
  client.post('/api/dashboard/plan', { userRequest, filters }).then((r) => r.data);

export const generateDashboard = (userRequest, filters, intent) =>
  client.post('/api/dashboard/generate', { userRequest, filters, intent }).then((r) => r.data);

export const generateInline = (userRequest, data, chartType) =>
  client.post('/api/dashboard/inline', { userRequest, data, chartType }).then((r) => r.data);
