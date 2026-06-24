import express from 'express';
import cors from 'cors';
import { authMiddleware } from './middleware/auth.js';
import analyticsRoutes from './routes/analytics.js';
import dashboardRoutes from './routes/dashboard.js';
import cacheRoutes from './routes/cache.js';

if (process.env.NODE_ENV !== 'production') {
  const { config } = await import('dotenv');
  config();
}

const app = express();

const allowedOrigins = [
  process.env.DASHBOARD_APP_ORIGIN,
  'http://localhost:5173',
  'http://localhost:4173',
].filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  allowedHeaders: ['Authorization', 'Content-Type', 'X-API-Key'],
  exposedHeaders: ['X-Cache'],
}));
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'cx-dashboard-api', time: new Date().toISOString() });
});

app.use('/api', authMiddleware);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/cache', cacheRoutes);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.response?.status === 401 || err.response?.status === 403 ? 502 : 500;
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err.response?.data || err.message);
  res.status(status).json({
    error: err.message,
    upstream: err.response?.status
      ? { status: err.response.status, statusText: err.response.statusText }
      : undefined,
  });
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`cx-dashboard-api listening on :${port}`);
});
