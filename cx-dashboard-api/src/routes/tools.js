/**
 * Standalone REST wrappers around the 7 custom-aggregate tools, for
 * consumption by an external agent runtime (Azure AI Foundry's AnalyticsAgent,
 * via an OpenAPI tool) instead of the in-process Anthropic tool-calling loop
 * in claude.js/runCustomAggregateAgent.
 *
 * Auth: mounted under /api, so authMiddleware already requires a real Bearer
 * token (the end user's Azure AD token) — same contract as every other route
 * in this app. There is no service-account/API-key path here on purpose:
 * this is per-user CRM data, so the caller (Foundry, or whatever orchestrator
 * sits in front of it) must forward the end user's own token, not a fixed
 * technical identity. If that token isn't being forwarded, these endpoints
 * will 401 exactly like the rest of /api does today — that's the correct
 * failure mode, not a bug to work around here.
 *
 * Each handler mirrors the corresponding branch of executeCustomAgentTool in
 * routes/dashboard.js as closely as possible — same input shape, same
 * analytics-service calls — so the two call paths (in-process agent loop vs.
 * external Foundry agent) can't silently drift apart on filter handling.
 */
import { Router } from 'express';
import {
  aggregateField,
  aggregateByOrgs,
  opportunitiesConvertedToQuote,
  countQuoteConversionsByOrgs,
  rfqsRaisedFromQuotes,
  resolveOrgScopeTool,
  getSalesOrgs,
} from '../analytics-service.js';
import { fetchCollectionFields } from '../c4c-client.js';

const router = Router();

function classificationFilters(rest) {
  return {
    segment: rest.segment || null,
    application: rest.application || null,
    marketSegmentGroup: rest.marketSegmentGroup || null,
    strategicAccount: rest.strategicAccount || null,
  };
}

router.post('/list_fields', async (req, res, next) => {
  try {
    const { collection } = req.body || {};
    if (!collection) return res.status(400).json({ error: 'collection is required' });
    const fields = await fetchCollectionFields(collection, req.userJwt);
    res.json({ collection, fields });
  } catch (err) {
    next(err);
  }
});

router.post('/resolve_org_scope', async (req, res, next) => {
  try {
    const { term } = req.body || {};
    if (!term) return res.status(400).json({ error: 'term is required' });
    const result = await resolveOrgScopeTool({ term }, req.userJwt);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/aggregate', async (req, res, next) => {
  try {
    const { entity, fieldName, aggregation, ...rest } = req.body || {};
    if (!entity || !fieldName || !aggregation) {
      return res.status(400).json({ error: 'entity, fieldName, and aggregation are required' });
    }
    const filters = {
      salesOrgId: rest.salesOrgId || null,
      account: rest.account || null,
      dateFrom: rest.dateFrom || null,
      dateTo: rest.dateTo || null,
      status: rest.status || 'all',
      secondaryDateField: rest.secondaryDateField || null,
      secondaryDateFrom: rest.secondaryDateFrom || null,
      secondaryDateTo: rest.secondaryDateTo || null,
      ...classificationFilters(rest),
    };
    const result = await aggregateField({ entity, fieldName, aggregation, filters }, req.userJwt, req.userEmail);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/aggregate_by_org', async (req, res, next) => {
  try {
    const { entity, fieldName, aggregation, orgs, ...rest } = req.body || {};
    if (!entity || !fieldName || !aggregation || !Array.isArray(orgs) || orgs.length === 0) {
      return res.status(400).json({ error: 'entity, fieldName, aggregation, and a non-empty orgs array are required' });
    }
    const filters = {
      dateFrom: rest.dateFrom || null,
      dateTo: rest.dateTo || null,
      status: rest.status || 'all',
      secondaryDateField: rest.secondaryDateField || null,
      secondaryDateFrom: rest.secondaryDateFrom || null,
      secondaryDateTo: rest.secondaryDateTo || null,
      ...classificationFilters(rest),
    };
    const result = await aggregateByOrgs({ entity, fieldName, aggregation, orgs, filters }, req.userJwt, req.userEmail);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/count_quote_conversions', async (req, res, next) => {
  try {
    const rest = req.body || {};
    const filters = {
      salesOrgId: rest.salesOrgId || null,
      account: rest.account || null,
      dateFrom: rest.dateFrom || null,
      dateTo: rest.dateTo || null,
      status: rest.status || 'all',
      ...classificationFilters(rest),
    };
    const result = await opportunitiesConvertedToQuote(filters, req.userJwt, req.userEmail);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/count_quote_conversions_by_org', async (req, res, next) => {
  try {
    const { orgs, ...rest } = req.body || {};
    if (!Array.isArray(orgs) || orgs.length === 0) {
      return res.status(400).json({ error: 'a non-empty orgs array is required' });
    }
    const filters = {
      account: rest.account || null,
      dateFrom: rest.dateFrom || null,
      dateTo: rest.dateTo || null,
      status: rest.status || 'all',
      ...classificationFilters(rest),
    };
    const result = await countQuoteConversionsByOrgs({ orgs, filters }, req.userJwt, req.userEmail);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/count_rfqs_from_quotes', async (req, res, next) => {
  try {
    const { dateFrom, dateTo } = req.body || {};
    const result = await rfqsRaisedFromQuotes({ dateFrom: dateFrom || null, dateTo: dateTo || null }, req.userJwt, req.userEmail);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Not one of the 7 agent tools, but useful for resolve_org_scope's "the agent
// needs real org names" case without re-deriving that logic — mirrors the
// resolve_org_scope short-circuit's catalog lookup in executeCustomAgentTool.
router.get('/sales_orgs', async (req, res, next) => {
  try {
    const orgs = await getSalesOrgs(req.userJwt);
    res.json({ orgs });
  } catch (err) {
    next(err);
  }
});

export default router;
