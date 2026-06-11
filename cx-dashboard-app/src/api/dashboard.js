import client from './client';

export const planReport = (userRequest, filters) =>
  client.post('/api/dashboard/plan', { userRequest, filters }).then((r) => r.data);

export const generateDashboard = (userRequest, filters, intent) =>
  client.post('/api/dashboard/generate', { userRequest, filters, intent }).then((r) => r.data);

export const generateInline = (userRequest, data, chartType) =>
  client.post('/api/dashboard/inline', { userRequest, data, chartType }).then((r) => r.data);

export const getBriefStats = (filters) =>
  client.get('/api/dashboard/brief-stats', { params: filters }).then((r) => r.data);

export const generateBrief = (audience, intent, filters) =>
  client.post('/api/dashboard/brief', { audience, intent, filters }).then((r) => r.data);
