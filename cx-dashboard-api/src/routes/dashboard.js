/**
 * Claude-powered dashboard endpoints.
 * /generate — natural language → analytics data → Recharts config (Mode 1)
 * /inline   — data → self-contained ECharts HTML for Copilot Studio (Mode 2)
 */
import { Router } from 'express';
import { parseIntent, sanitizeIntent, generateChartConfig, generateInlineHtml } from '../claude.js';
import { ENDPOINT_HANDLERS } from '../analytics-service.js';

const router = Router();

// Step 1 of the report wizard: parse intent only, so the UI can show what
// the AI understood (data sources, chart type, title) before building.
router.post('/plan', async (req, res, next) => {
  try {
    const { userRequest, filters = {} } = req.body || {};
    if (!userRequest) {
      return res.status(400).json({ error: 'userRequest is required' });
    }
    const intent = await parseIntent(userRequest, filters);
    res.json({ intent });
  } catch (err) {
    next(err);
  }
});

router.post('/generate', async (req, res, next) => {
  try {
    const { userRequest, filters = {} } = req.body || {};
    if (!userRequest) {
      return res.status(400).json({ error: 'userRequest is required' });
    }

    // 1. Use the confirmed plan when provided (wizard flow), otherwise parse
    const intent = req.body.intent
      ? sanitizeIntent(req.body.intent)
      : await parseIntent(userRequest, filters);
    const mergedFilters = { ...filters, ...(intent.filters || {}) };

    // 2. Call the identified analytics endpoints (in-process, same caching)
    const rawData = {};
    await Promise.all(
      intent.endpoints.map(async (endpoint) => {
        const handler = ENDPOINT_HANDLERS[endpoint];
        if (!handler) return;
        const { data } = await handler(mergedFilters, req.userJwt, req.userEmail);
        rawData[endpoint] = data;
      })
    );

    // 3. Generate the Recharts config from the data
    const chartConfig = await generateChartConfig(intent.chartType, rawData, userRequest);

    res.json({
      chartConfig,
      rawData,
      title: chartConfig.title || intent.title,
      summary: chartConfig.summary || '',
      insights: chartConfig.insights || [],
      suggestedChartType: chartConfig.chartType || intent.chartType,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/inline', async (req, res, next) => {
  try {
    const { userRequest, data, chartType } = req.body || {};
    if (!userRequest || data === undefined) {
      return res.status(400).json({ error: 'userRequest and data are required' });
    }
    const result = await generateInlineHtml(data, userRequest, chartType);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
