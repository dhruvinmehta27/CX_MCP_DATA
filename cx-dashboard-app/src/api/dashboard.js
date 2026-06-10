import client from './client';

export const generateDashboard = (userRequest, filters) =>
  client.post('/api/dashboard/generate', { userRequest, filters }).then((r) => r.data);

export const generateInline = (userRequest, data, chartType) =>
  client.post('/api/dashboard/inline', { userRequest, data, chartType }).then((r) => r.data);
