/**
 * Claude-powered dashboard endpoints.
 * /generate — natural language → analytics data → Recharts config (Mode 1)
 * /inline   — data → self-contained ECharts HTML for Copilot Studio (Mode 2)
 */
import { Router } from 'express';
import { parseIntent, sanitizeIntent, generateChartConfig, generateInlineHtml, generateBrief, generateChartMeta } from '../claude.js';
import { ENDPOINT_HANDLERS, briefStats, briefData } from '../analytics-service.js';
import { buildEChartsOption, renderChartPng } from '../chart-render.js';

const router = Router();

function pickFilters(source = {}) {
  const { salesOrgId, ownerId, dateFrom, dateTo } = source;
  return { salesOrgId, ownerId, dateFrom, dateTo };
}

// Headline numbers for the Sales Brief "data included" panel
router.get('/brief-stats', async (req, res, next) => {
  try {
    const { data, cached } = await briefStats(pickFilters(req.query), req.userJwt, req.userEmail);
    res.set('X-Cache', cached ? 'HIT' : 'MISS');
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// Audience-tailored, print-ready sales brief from live C4C data
router.post('/brief', async (req, res, next) => {
  try {
    const { audience, intent, filters = {} } = req.body || {};
    if (!audience) {
      return res.status(400).json({ error: 'audience is required' });
    }
    const f = pickFilters(filters);
    const data = await briefData(f, req.userJwt, req.userEmail);
    const brief = await generateBrief({
      audience,
      intent,
      data,
      preparedBy: req.userEmail,
      period: `${f.dateFrom || 'start'} to ${f.dateTo || 'today'}`,
    });
    res.json({ brief, stats: data.stats });
  } catch (err) {
    next(err);
  }
});

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

/**
 * Copilot-friendly: render the data to a PNG that drops straight into an
 * Adaptive Card image. The chart is built deterministically (no LLM JS); only
 * the title/summary come from Claude. Returns a data URI by default; pass
 * ?format=binary (or Accept: image/png) for the raw PNG.
 */
router.post('/inline-image', async (req, res, next) => {
  try {
    const { userRequest, data, chartType, width, height } = req.body || {};
    if (data === undefined) {
      return res.status(400).json({ error: 'data is required' });
    }
    const meta = await generateChartMeta(data, userRequest);
    const option = buildEChartsOption(data, chartType, meta.title);
    const png = renderChartPng(option, { width: Number(width) || 900, height: Number(height) || 520 });

    const wantsBinary = req.query.format === 'binary' || (req.headers.accept || '').includes('image/png');
    if (wantsBinary) {
      res.set('Content-Type', 'image/png');
      res.set('X-Chart-Title', encodeURIComponent(meta.title || ''));
      return res.send(png);
    }
    res.json({
      image: `data:image/png;base64,${png.toString('base64')}`,
      title: meta.title,
      summary: meta.summary,
      contentType: 'image/png',
    });
  } catch (err) {
    next(err);
  }
});

export default router;
