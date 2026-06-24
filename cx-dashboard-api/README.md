# cx-dashboard-api

Standalone analytics API for TSS Dashboard & Analytics. Node.js (ESM) + Express,
deployed to BTP CF eu10. Completely independent of `cx-mcp-server-secure`.

## Auth — Azure AD OBO without XSUAA exchange

```
User → MSAL (React) → Azure AD ACCESS token (api://6e70fc21.../access_as_user)
     → Authorization: Bearer on every API call
     → this backend passes the token RAW as X-user-token to the BTP Destination Service
     → Destination C4C_QUA_OBO validates via x_user_token.jwks_uri (Azure AD JWKS)
     → builds + signs SAML assertion (userIdSource=upn, audience HTTPS://my352500-sso.crm.ondemand.com)
     → C4C OAuth issues a user-scoped token → OData runs as the real user
```

- Bearer token present = authenticated; full validation is done by the Destination Service.
- Exception: `POST /api/dashboard/inline` also accepts `X-API-Key: $INLINE_API_KEY`
  (Copilot Studio mode — no user token available).

## Pagination

C4C returns max 1000 records/request. `fetchAllPages()` reads `__count` from the
first page (`$inlinecount=allpages`), then fetches all remaining pages in
parallel (`$skip=1000, 2000, …`, batched 15 at a time) and merges. Every fetch
uses `$select` to keep pages small even at 199k+ records.

## Caching

`node-cache`, TTL 15 min (override with `CACHE_TTL_SECONDS`). Cache key =
`userEmail:queryType:JSON(sortedFilters)` — per-user isolation.
`DELETE /api/cache/clear` clears only the current user's entries.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | unauthenticated |
| GET | `/api/analytics/quotes/by-status` | `salesOrgId, ownerId, dateFrom, dateTo` |
| GET | `/api/analytics/quotes/by-sales-org` | `+ limit` (default 20) |
| GET | `/api/analytics/quotes/trend` | `+ months` (default 6) |
| GET | `/api/analytics/quotes/by-biz-type` | maps 11=New, 12=Follow-up, 13=Replacement |
| GET | `/api/analytics/quotes/top-customers` | `+ limit` (default 10) |
| GET | `/api/analytics/quotes/list` | latest N rows for tables (default 500, max 2000) |
| GET | `/api/analytics/opportunities/pipeline` | stages in pipeline order |
| GET | `/api/analytics/opportunities/by-owner` | |
| GET | `/api/analytics/opportunities/close-trend` | expected close, forward-looking |
| GET | `/api/analytics/opportunities/list` | |
| GET | `/api/analytics/rfqs/by-status` | custom `cust/v1/zrfq/RFQRootCollection` |
| GET | `/api/analytics/rfqs/trend` | |
| GET | `/api/analytics/rfqs/list` | |
| GET | `/api/analytics/daily-summary` | parallel fetch of all entities + briefing payloads |
| GET | `/api/analytics/sales-orgs` | OrganisationalUnitCollection, SalesIndicator eq true |
| POST | `/api/dashboard/generate` | NL → Claude intent → analytics → Recharts config |
| POST | `/api/dashboard/inline` | data → self-contained ECharts HTML (Copilot Studio) |
| DELETE | `/api/cache/clear` | current user's cache |

## Deploy

```sh
cf push                                            # uses manifest.yml
cf set-env cx-dashboard-api ANTHROPIC_API_KEY <key>
cf set-env cx-dashboard-api INLINE_API_KEY <key>   # for Copilot Studio inline auth
cf restage cx-dashboard-api
```

Services bound via manifest: `cx-destination`, `cx-xsuaa-mcp`.

## Local dev

```sh
cp .env.example .env   # fill VCAP_SERVICES + ANTHROPIC_API_KEY
npm install
npm run dev
npm run test:aggregations
```
