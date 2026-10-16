/**
 * Claude-powered dashboard endpoints.
 * /generate — natural language → analytics data → Recharts config (Mode 1)
 * /inline   — data → self-contained ECharts HTML for Copilot Studio (Mode 2)
 */
import { Router } from 'express';
import { parseIntent, sanitizeIntent, generateChartConfig, generateMultiCharts, generateInlineHtml, generateBrief, generateChartMeta, parseBriefIntent, runCustomAggregateAgent, getFieldDisplayLabel } from '../claude.js';
import { ENDPOINT_HANDLERS, briefStats, briefData, aggregateField, opportunitiesConvertedToQuote, rfqsRaisedFromQuotes, resolveOrgScopeTool, aggregateByOrgs } from '../analytics-service.js';
import { fetchCollectionFields } from '../c4c-client.js';
import { buildEChartsOption, renderChartPng } from '../chart-render.js';

const router = Router();

// The agent is instructed to keep formattedValue to a bare number, but that's
// a prompt rule, not a guarantee — sanitize server-side so a malformed value
// (e.g. embedded prose) never reaches the UI's Value column. Falls back to
// formatting the raw numeric value if formattedValue doesn't look clean.
function sanitizeFormattedValue(agentResult) {
  const raw = agentResult.formattedValue;
  if (typeof raw === 'string') {
    const match = raw.match(/^[\s]*[€$£]?\s?-?[\d,]+(\.\d+)?%?/);
    if (match && match[0].trim()) return match[0].trim();
  }
  if (typeof agentResult.value === 'number') {
    return agentResult.value.toLocaleString();
  }
  return raw ?? agentResult.value ?? null;
}

function pickFilters(source = {}) {
  const { salesOrgId, ownerId, dateFrom, dateTo, account } = source;
  return { salesOrgId, ownerId, dateFrom, dateTo, account };
}

// Executes the custom-aggregate agent's tool calls against real C4C data.
// Injected into runCustomAggregateAgent so claude.js stays free of
// C4C/analytics-service imports.
// resolvedSalesOrgId: the salesOrgId already resolved on the Confirm screen
// (if any). Passed in so resolve_org_scope can be short-circuited in CODE,
// not just discouraged by a prompt rule — this makes it structurally
// impossible for the agent to re-discover and re-ask an org ambiguity the
// user already answered, regardless of whether it reads/follows that rule.
function executeCustomAgentTool(req, resolvedSalesOrgId) {
  return async (name, input) => {
    if (name === 'resolve_org_scope' && resolvedSalesOrgId) {
      const ids = resolvedSalesOrgId.split(',').map((s) => s.trim()).filter(Boolean);
      return {
        matchType: ids.length > 1 ? 'multiple' : 'single',
        orgs: ids.map((id) => ({ id, name: id })),
        alreadyResolved: true,
        note: 'This was already resolved on the Confirm screen — use it as-is, do not ask the user again.',
      };
    }
    if (name === 'list_fields') {
      const fields = await fetchCollectionFields(input.collection, req.userJwt);
      return { collection: input.collection, fields };
    }
    if (name === 'aggregate') {
      const { entity, fieldName, aggregation, ...rest } = input;
      const filters = {
        salesOrgId: rest.salesOrgId || null,
        account: rest.account || null,
        dateFrom: rest.dateFrom || null,
        dateTo: rest.dateTo || null,
        status: rest.status || 'all',
        secondaryDateField: rest.secondaryDateField || null,
        secondaryDateFrom: rest.secondaryDateFrom || null,
        secondaryDateTo: rest.secondaryDateTo || null,
      };
      return aggregateField({ entity, fieldName, aggregation, filters }, req.userJwt, req.userEmail);
    }
    if (name === 'count_quote_conversions') {
      const filters = {
        salesOrgId: input.salesOrgId || null,
        account: input.account || null,
        dateFrom: input.dateFrom || null,
        dateTo: input.dateTo || null,
        status: input.status || 'all',
      };
      return opportunitiesConvertedToQuote(filters, req.userJwt, req.userEmail);
    }
    if (name === 'count_rfqs_from_quotes') {
      return rfqsRaisedFromQuotes({ dateFrom: input.dateFrom || null, dateTo: input.dateTo || null }, req.userJwt, req.userEmail);
    }
    if (name === 'resolve_org_scope') {
      return resolveOrgScopeTool({ term: input.term }, req.userJwt);
    }
    if (name === 'aggregate_by_org') {
      const { entity, fieldName, aggregation, orgs, ...rest } = input;
      const filters = {
        dateFrom: rest.dateFrom || null,
        dateTo: rest.dateTo || null,
        status: rest.status || 'all',
        secondaryDateField: rest.secondaryDateField || null,
        secondaryDateFrom: rest.secondaryDateFrom || null,
        secondaryDateTo: rest.secondaryDateTo || null,
      };
      return aggregateByOrgs({ entity, fieldName, aggregation, orgs, filters }, req.userJwt, req.userEmail);
    }
    throw new Error(`Unknown tool: ${name}`);
  };
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

// Parse brief intent — returns AI understanding + scope warnings before generating
router.post('/brief-plan', async (req, res, next) => {
  try {
    const { audience, intent, filters = {} } = req.body || {};
    if (!audience) return res.status(400).json({ error: 'audience is required' });
    const plan = await parseBriefIntent({ audience, intent, availableFilters: filters });
    res.json({ plan });
  } catch (err) {
    next(err);
  }
});

// Audience-tailored, print-ready sales brief from live C4C data
router.post('/brief', async (req, res, next) => {
  try {
    const { audience, intent, filters = {}, focusAreas = [] } = req.body || {};
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
      customerName: f.account || null,
      focusAreas,
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

    // For a custom-metric request with a detected org/region term, resolve it
    // against real org data NOW — on the understanding/confirm screen — rather
    // than letting the agent discover an ambiguity only after Build is clicked.
    // Reuses the same clarificationNeeded/clarificationQuestion UI the rest of
    // the plan step already uses, so no new frontend pattern is needed.
    if (intent.endpoints?.includes('custom/aggregate') && intent.detectedOrgName && !intent.detectedOrgName.includes(',')) {
      const scope = await resolveOrgScopeTool({ term: intent.detectedOrgName }, req.userJwt);
      if (scope.matchType === 'ambiguous') {
        const names = (scope.candidates || []).slice(0, 6).map((o) => o.name).join(', ');
        intent.clarificationNeeded = true;
        intent.clarificationQuestion = names
          ? `"${intent.detectedOrgName}" matches more than one real scope: ${names}${(scope.candidates || []).length > 6 ? ', ...' : ''}. Which did you mean?`
          : `"${intent.detectedOrgName}" doesn't match a known org — could you clarify which org/region you mean?`;
        // One-click options instead of making the user retype their answer —
        // each carries the exact resolved org ID list to apply directly.
        if (scope.directOrgs?.length && scope.regionOrgs?.length) {
          intent.clarificationOptions = [
            { label: `${intent.detectedOrgName} orgs only (${scope.directOrgs.length})`, salesOrgId: scope.directOrgs.map((o) => o.id).join(','), orgs: scope.directOrgs },
            { label: `All ${scope.region || 'country-level'} orgs (${scope.regionOrgs.length})`, salesOrgId: scope.regionOrgs.map((o) => o.id).join(','), orgs: scope.regionOrgs },
            { label: 'Both', salesOrgId: [...scope.directOrgs, ...scope.regionOrgs].map((o) => o.id).join(','), orgs: [...scope.directOrgs, ...scope.regionOrgs] },
          ];
        } else if (scope.candidates?.length) {
          intent.clarificationOptions = scope.candidates.slice(0, 6).map((o) => ({ label: o.name, salesOrgId: o.id, orgs: [o] }));
        }
      } else if (scope.matchType === 'region' || scope.matchType === 'multiple') {
        // Resolved to several real orgs — pass them through as the exact
        // comma-separated ID list, so build() doesn't need to re-resolve it.
        intent.filters = { ...intent.filters, salesOrgId: scope.orgs.map((o) => o.id).join(',') };
        intent.resolvedOrgs = scope.orgs;
      }
    }

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
      ? sanitizeIntent(req.body.intent, userRequest)
      : await parseIntent(userRequest, filters);
    // UI-supplied dates (builder range chips) always win over AI-parsed dates
    const mergedFilters = { ...(intent.filters || {}), ...filters };

    // 1b. Custom-metric requests go through the verification agent instead of
    // a fixed endpoint — see runCustomAggregateAgent for why (prevents
    // confidently-wrong answers for fields/metrics we don't have pre-built).
    if (intent.endpoints.includes('custom/aggregate')) {
      const agentResult = await runCustomAggregateAgent({
        userRequest,
        baseFilters: mergedFilters,
        executeTool: executeCustomAgentTool(req, mergedFilters.salesOrgId),
      });

      let rows;
      if (agentResult.success && Array.isArray(agentResult.breakdown) && agentResult.breakdown.length > 0) {
        // Multi-org rollup — show a proper per-org breakdown table instead of
        // squeezing a region-wide answer into one row (a 0-result org stays
        // visible as its own row, not a caveat someone has to expand to find).
        rows = [
          ...agentResult.breakdown,
          { Org: 'Total', Value: agentResult.value, 'Records matched': agentResult.recordsMatched },
        ];
      } else {
        const noDataFound = agentResult.success && agentResult.recordsMatched === 0;
        rows = [
          agentResult.success
            ? {
                Metric: userRequest,
                Value: noDataFound ? 'No matching records found' : sanitizeFormattedValue(agentResult),
                'Field used': getFieldDisplayLabel(agentResult.fieldUsed),
                'Records matched': agentResult.recordsMatched,
              }
            : {
                Metric: userRequest,
                Result: 'Could not compute — see explanation',
              },
        ];
      }

      return res.json({
        charts: [],
        rawData: { 'custom/aggregate': { total: rows.length, rows } },
        title: intent.title || 'Custom Query Result',
        summary: agentResult.explanation,
        insights: agentResult.caveats || [],
      });
    }

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

    // 3. Table mode — skip chart generation, return raw rows directly
    if (intent.chartType === 'table') {
      const firstEndpoint = intent.endpoints[0];
      const tableData = rawData[firstEndpoint] || {};
      return res.json({
        charts: [],
        rawData,
        title: intent.title || 'Data Table',
        summary: `${(tableData.total || tableData.rows?.length || 0).toLocaleString()} records retrieved`,
        insights: [],
      });
    }

    // 4. Generate 4 complementary charts from the data
    const multi = await generateMultiCharts(rawData, userRequest);

    res.json({
      charts: multi.charts || [],
      rawData,
      title: multi.overallTitle || intent.title,
      summary: multi.overallSummary || '',
      insights: multi.insights || [],
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
