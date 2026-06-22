/**
 * C4C analytics endpoints. All routes share the same flow:
 * Bearer token (validated downstream by the Destination Service) →
 * per-user cache key → cache hit or fetch+aggregate → respond.
 */
import { Router } from 'express';
import * as svc from '../analytics-service.js';
import { fetchSalesOrgs, probeC4CAccess } from '../c4c-client.js';

const router = Router();

function pickFilters(query) {
  const { salesOrgId, ownerId, dateFrom, dateTo, months, limit, compare, scope } = query;
  return { salesOrgId, ownerId, dateFrom, dateTo, months, limit, compare, scope };
}

function handle(serviceFn) {
  return async (req, res, next) => {
    try {
      const { data, cached } = await serviceFn(pickFilters(req.query), req.userJwt, req.userEmail);
      res.set('X-Cache', cached ? 'HIT' : 'MISS');
      res.json(data);
    } catch (err) {
      next(err);
    }
  };
}

router.get('/quotes/by-status', handle(svc.quotesByStatus));
router.get('/quotes/by-sales-org', handle(svc.quotesBySalesOrg));
router.get('/quotes/trend', handle(svc.quotesTrend));
router.get('/quotes/by-biz-type', handle(svc.quotesByBizType));
router.get('/quotes/top-customers', handle(svc.quotesTopCustomers));
router.get('/quotes/list', handle(svc.quotesList));
router.get('/opportunities/pipeline', handle(svc.opportunitiesPipeline));
router.get('/opportunities/pipeline-overview', handle(svc.pipelineOverviewSvc));
router.get('/opportunities/by-owner', handle(svc.opportunitiesByOwner));
router.get('/opportunities/close-trend', handle(svc.opportunitiesCloseTrend));
router.get('/opportunities/list', handle(svc.opportunitiesList));
router.get('/rfqs/by-status', handle(svc.rfqsByStatus));
router.get('/rfqs/trend', handle(svc.rfqsTrend));
router.get('/rfqs/list', handle(svc.rfqsList));
router.get('/daily-summary', handle(svc.getDailySummary));

// Lightweight access probe: does the signed-in user actually have C4C access?
// Always 200 with { ok } so the UI gets a clean signal (not an error card).
router.get('/whoami', async (req, res) => {
  try {
    await probeC4CAccess(req.userJwt);
    res.json({ ok: true, user: req.userEmail });
  } catch (err) {
    res.json({ ok: false, user: req.userEmail, message: err.message });
  }
});

router.get('/sales-orgs', async (req, res, next) => {
  try {
    const orgs = await fetchSalesOrgs(req.query.search, req.userJwt);
    res.json(orgs);
  } catch (err) {
    next(err);
  }
});

export default router;
