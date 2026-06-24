# TSS C4C Dashboard & Analytics — Project Handoff

> Single source of truth for the Trelleborg Sealing Solutions (TSS) sales dashboard built on SAP Cloud for Customer (C4C). Hand this to a new chat/developer to continue work.

---

## 1. What this is

A web dashboard + analytics app over **SAP Cloud for Customer (C4C)** sales data (opportunities, quotes, RFQs, tasks, visits, appointments). It gives Sales Reps and Sales Managers fast, decision-grade views of the pipeline, plus an AI report builder, an audience-tailored Sales Brief, and a Copilot Studio chart integration.

**Live URLs**
- App (frontend): `https://cx-dashboard-app.cfapps.eu10.hana.ondemand.com`
- API health: `https://cx-dashboard-api.cfapps.eu10.hana.ondemand.com/health`
- C4C tenant (Prod, UI deep links): `https://my332854.crm.ondemand.com`

**Repo:** `dhruvinmehta27/CX_MCP_DATA` (monorepo)
- `cx-dashboard-api/` — Node/Express backend (C4C analytics + AI)
- `cx-dashboard-app/` — React/Vite frontend
- Active feature branch: **`claude/keen-newton-4z77kc`** (all the work below)
- `main` — contains the same work + Abdul's launchpad PR (branches reconciled via merge)

---

## 2. Tech stack & services

**Frontend** (`cx-dashboard-app`): React 18, Vite, react-router-dom, `@azure/msal-browser` + `@azure/msal-react` (Azure AD SSO), **Recharts** (most charts), **ECharts** (Bubble Matrix; lazy-loaded), axios, date-fns, html2canvas.

**Backend** (`cx-dashboard-api`): Node ≥20, Express, axios, `node-cache`, `@anthropic-ai/sdk` (Claude), **echarts + @resvg/resvg-js** (server-side chart→PNG for Copilot), cors.

**Platform:** SAP BTP Cloud Foundry (region **eu10**), org `Trelleborg Sealing Solutions Germany GmbH_TSS-BTP-C4C-Extension`, space `dev`.

**Bound CF services (API):** `cx-destination` (BTP Destination Service), `cx-xsuaa-mcp` (XSUAA — the `cx-mcp-server` app registration).

**AI model:** Claude — `ANTHROPIC_MODEL=claude-opus-4-8`.

---

## 3. Authentication & C4C access (OBO) — important

The chain is **Azure AD On-Behalf-Of (OBO), NO XSUAA token exchange**:

1. Frontend logs the user in via **Azure AD (MSAL)** → gets an access token (scope `api://<clientId>/access_as_user`).
2. Token sent as `Authorization: Bearer` to the API.
3. API does **not** verify the token itself — it passes the raw Azure token as **`X-user-token`** to the **BTP Destination Service**, requesting destination **`C4C_PRD_OBO`**.
4. Destination Service validates the token (Azure AD JWKS), builds + signs a **SAML assertion**, gets a **user-scoped C4C OAuth token**.
5. API calls **C4C OData as the real logged-in user** → every query is automatically scoped to what that user is authorized to see.

Key files: `cx-dashboard-api/src/c4c-client.js` (destination lookup, paginated fetch), `cx-dashboard-api/src/middleware/auth.js` (decodes JWT for the per-user cache key; allows `X-API-Key` for Copilot endpoints).

Azure config is in `cx-dashboard-app/public/config.js` (runtime, editable without rebuild): `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `DASHBOARD_API_URL`, `C4C_UI_BASE`.

---

## 4. Features / pages

| Route | Page | Notes |
|---|---|---|
| `/` | **Welcome launchpad** | Full-screen, **no sidebar/header/filter bar**. Personalised greeting + large accent tiles. Sidebar appears only after picking a tile. |
| `/briefing` | **Daily Briefing** | KPI tiles (open quotes/opps/RFQs, pipeline value, overdue tasks, meetings), quotes-this-week, pipeline-by-stage, my open quotes, today's tasks. |
| `/quotes` | **Quote Analytics** | By status, by sales org, trend, by biz type, top customers, list. |
| `/board` | **Pipeline Command Center** | One shared filter set, 5 views: **Kanban**, **Funnel** (+period compare), **Forecast** (quarters/monthly/attainment), **Flow** (snapshot-derived Sankey), **Bubble Matrix** (ECharts scatter). Drill-down drawer, Excel/CSV/PDF export, saved presets, shareable URL. |
| `/pipeline` | **Pipeline Health** | Funnel, by-owner, expected-close trend, opportunities list. |
| `/rfqs` | **RFQ Tracker** | Open/Closed/All scope toggle + search; closed = **Confirmed/Rejected**. |
| `/builder` | **AI Report Builder** | NL → chart (Claude). |
| `/brief` | **Sales Brief** | Audience-tailored, print-ready brief from live data (Claude). |

Cross-cutting frontend: `AccessGate` (no-C4C-access screen), `MetricCard`/`ChartCard`/`DataTable` UI primitives, `useFilters` (global date/org/owner), `useAnalytics` (fetch hook), Fiori Horizon theme in `index.css`.

---

## 5. API endpoints

**Analytics** (`/api/analytics/...`, Bearer auth, per-user OBO):
`quotes/by-status`, `quotes/by-sales-org`, `quotes/trend`, `quotes/by-biz-type`, `quotes/top-customers`, `quotes/list`, `opportunities/pipeline`, `opportunities/pipeline-overview`, `opportunities/by-owner`, `opportunities/close-trend`, `opportunities/list`, `rfqs/by-status`, `rfqs/trend`, `rfqs/list`, `daily-summary`, `whoami` (access probe), `sales-orgs`.

**Dashboard/AI** (`/api/dashboard/...`):
`GET brief-stats`, `POST brief`, `POST plan`, `POST generate` (NL→Recharts config), `POST inline` (data→ECharts **HTML**, Copilot), `POST inline-image` (data→**PNG**, Copilot).

**Cache:** `DELETE /api/cache/clear`, `GET /api/cache/stats`. Health: `GET /health` (open).

---

## 6. Core architecture decisions (the "why")

- **Per-user OBO everywhere** — data is always scoped to the signed-in user; never a service account.
- **Shared raw-fetch cache** — the 6 quote endpoints (etc.) share ONE paginated C4C fetch per entity (keyed on base filters), with in-flight coalescing, to avoid a fetch stampede.
- **Paginated fetcher** (`fetchAllPages`): C4C OData v2, 1000/page, parallel in batches of 15, **`$orderby=ObjectID`** for stable pages (prevents duplicate/skipped rows), **hard cap `C4C_MAX_RECORDS=60000`** so a wide range can't OOM the instance, returns `{ total, results, truncated }`.
- **Client-side aggregation for the board** — `opportunities/list` returns up to 20k rows; the Pipeline Command Center computes KPIs/funnel/forecast/flow client-side (`utils/pipeline.js`) so every filter updates instantly.

### Data-correctness rules (HARD REQUIREMENTS — keep these)
- **Value = group/base currency.** Opportunity value uses the custom field **`ZBaseCurrency_KUTContent_KUT`** (EUR), not `ExpectedRevenueAmount` (transaction currency), so multi-currency deals never sum wrong. Helper: `oppValue()` (falls back to `ExpectedRevenueAmount` only if base is empty).
- **"Pipeline" = OPEN opportunities everywhere.** Won/Lost/**Stopped** are NOT pipeline. Daily Briefing, Pipeline Health, and Command KPIs all filter to open. The Command STATUS chip only scopes the Kanban; the KPI header still computes over all statuses (so Win Rate / Closed Won/Lost / Avg Cycle work).
- **Open/closed classification is identical on server & client.** Server `isOpenStatus` (`aggregations.js`) and client `statusBucket` (`utils/pipeline.js`) MUST stay in sync. Closed = `won|lost|completed|cancel|closed|reject|finished|stopped`. **"Stopped" is closed.**
- **Win rate is an opportunity outcome**, computed from opportunity Won/Lost — NOT from quote statuses (quotes have no Won/Lost).
- **RFQ closed = Confirmed or Rejected**; everything else open (`isRfqOpen`).
- **Exact counts via OData inline count.** Headline counts (open quotes/opps/RFQs) use `$inlinecount=allpages&$top=1` filtered queries (exact, cheap, immune to the record cap) — do NOT count client-side over fetched records. C4C OData v2 has **no `$apply`**, so value *sums* can't be aggregated server-side (see Known Issues).
- **Fail-closed guardrail.** A figure is shown only if provably exact. If the underlying fetch was truncated, the UI shows **"—" / "narrow the date range"** instead of a partial number. Backend returns an `exact` flag per figure (Daily Briefing, Sales Brief); the Pipeline Command board hides entirely when its opportunity set is truncated.
- **Invariant tests** in `cx-dashboard-api/test/aggregations.test.js`: open ≤ total, parts sum to whole, weighted ≤ gross, win rate 0–100, and **monotonicity** (a wider range can't report fewer opens than a narrower one).

---

## 7. Confirmed C4C field mappings (OpportunityCollection)

| Concept | Field | Notes |
|---|---|---|
| Value (base currency) | `ZBaseCurrency_KUTContent_KUT` (+ `..currencyCode_KUT`) | EUR; use this, not ExpectedRevenueAmount |
| Source | `OriginTypeCode` / `OriginTypeCodeText` | |
| Type | `OpportunityLevel_KUT` / `..Text` | e.g. "Level 1 - Managed Opportunity" |
| Region / Sales Team | `SalesTerritoryID` / `SalesTerritoryName` | standard SalesUnit/Org are blank on this tenant |
| Industry — Segment | `BUS_SEG_CDE_KUT` / `..Text` | e.g. "Automotive", "Industrial" |
| Industry — Sub-segment | `MKT_SEG_CODE` / `..Text` | e.g. "Light Vehicle Manufacturers" |
| Stale / last activity | `EntityLastChangedOn` | stale = open & untouched >90d (briefStats) / >N days (bubble) |
| Account link | `ProspectPartyID` ↔ account `AccountID` | join key for the deferred Country/Industry work |
| Stage | `SalesCyclePhaseCode/Text` | |
| Probability | `ProbabilityPercent` | NOT `OrderProbability` |
| Status | `LifeCycleStatusCode/Text` | Open/In Process/Won/Lost/Stopped |
| SOP (start of production) | `ZSOP` | real SOP date (brief currently approximates via ExpectedProcessingEndDate) |
| Business type | `ZBIZTYPE` / `..Text` | New / Follow-up / Replacement |

ODATA bases: standard `/sap/c4c/odata/v1/c4codataapi`; custom `/sap/c4c/odata/cust/v1` (RFQ = `zrfq/RFQRootCollection`, sales orgs = `orgidnamesandfunc`).

---

## 8. Copilot Studio integration

Two endpoints, both auth'd by **`X-API-Key: <INLINE_API_KEY>`** (currently `PROD-C4C_MCP`). They render whatever `data` you POST — they do NOT fetch C4C themselves.
- `POST /api/dashboard/inline` → `{ html, title, summary }` (self-contained ECharts HTML page; needs hosting/iframe).
- `POST /api/dashboard/inline-image` → `{ image (data:image/png base64), title, summary }` (or raw PNG with `?format=binary`). **Renders inline in an Adaptive Card** — chart built deterministically server-side (ECharts SSR → resvg), only title/summary from Claude. **This is the recommended one for Copilot.**

Body: `{ userRequest, data, chartType }`. `chartType`: bar/line/area/pie. Adaptive Card binds `${image}`/`${title}`/`${summary}`.

**Open design question (not yet built):** use the **C4C MCP server** (`cx-mcp-server`) as Copilot's *data* layer + the render endpoint for *charts*. Two non-negotiables before doing so: (1) the MCP server must use the **same per-user OBO auth**, and (2) it must reuse the **same aggregation/guardrail logic** as this API, or Copilot will show numbers that disagree with the dashboard.

---

## 9. Deployment & operations

**Branches:** develop on `claude/keen-newton-4z77kc`. `main` has it + the launchpad.

**Deploy (CF, from each app dir):**
```bash
# API
cd cx-dashboard-api && git pull origin <branch> && cf push
# Frontend (build first — dist/ is what gets pushed)
cd cx-dashboard-app && git pull origin <branch> && npm install && npm run build && cf push
```

**Manifests:** API `memory: 2048M`, buildpack `nodejs_buildpack`, env `C4C_DESTINATION=C4C_PRD_OBO`, `C4C_MAX_RECORDS="60000"`, `DASHBOARD_APP_ORIGIN`, `NODE_ENV=production`. App `memory: 64M`, `staticfile_buildpack`, path `dist`.

**Secrets via `cf set-env` (never committed):** `ANTHROPIC_API_KEY`, `INLINE_API_KEY`.

**Operational gotchas (learned the hard way):**
- ⚠️ **`cf push` drops `INLINE_API_KEY`** (it's not in the manifest). After every API push, if Copilot is used: `cf set-env cx-dashboard-api INLINE_API_KEY PROD-C4C_MCP && cf restage`.
- ⚠️ **`cf restage` ≠ `cf push`.** Restage re-stages existing code; only `cf push` deploys new git code. (This caused "the deploy isn't taking effect" confusion.)
- ⚠️ **Push from the right folder** — the two apps are siblings; `cf push` reads the local dir's manifest. Watch the banner says the app you intend.
- ⚠️ **CF session expires** → `cf login -a https://api.cf.eu10.hana.ondemand.com --sso` (SSO passcode), then re-push.
- ⚠️ **Hard refresh** (Cmd/Ctrl+Shift+R) after frontend deploy — staticfile buildpack + browser cache the old bundle.
- If 2 GB memory exceeds space quota, drop API manifest back to `1024M` (the 60k cap prevents OOM on its own).
- New frontend deps (echarts) require `npm install` before `npm run build`.

---

## 10. Known issues / next steps

- **Exact value SUMS at scale.** Counts are exact (inline count); sums (Pipeline Value €) still come from a capped/record fetch → fail-closed when truncated. To make sums exact for huge ranges, integrate the **C4C Analytics/reporting OData service** (returns pre-aggregated measures) — confirm it's exposed on the `C4C_PRD_OBO` destination.
- **Fail-closed not yet applied to** Quote Analytics, Pipeline Health, and RFQ counts — same pattern as Daily Briefing/Sales Brief should be extended there.
- **Pending filters / data (deferred — needs account join `ProspectPartyID→AccountID`):** Country (`CountryCode`), geographic State/Region (`StateCode`), standard Industry (`IndustrialSectorCode` is blank on tenant — use segment fields). Shown as disabled "pending field mapping" chips.
- **Sankey Flow is snapshot-derived**, not true stage-transition history (C4C OData exposes only current stage). A faithful Sankey needs a change-history/transition source.
- **Sales Brief** still approximates SOP via ExpectedProcessingEndDate; real field is `ZSOP`.
- **"Strategic" in Bubble Matrix** is proxied from `OpportunityLevel` (Managed/Level 1); "Next planned action" omitted (needs activities join).
- **Bubble Matrix** chunk is large (~380 KB gz) but lazy-loaded.
- **MCP server integration** for Copilot (see §8).

---

## 11. Key files map

**Backend** (`cx-dashboard-api/src/`): `c4c-client.js` (OBO + fetch + inline counts), `analytics-service.js` (all aggregations + cache), `aggregations.js` (pure functions, status classifiers, `oppValue`, `pipelineOverview`), `claude.js` (AI prompts), `chart-render.js` (ECharts SSR→PNG), `routes/` (analytics, dashboard, cache), `middleware/auth.js`.

**Frontend** (`cx-dashboard-app/src/`): `App.jsx` (shell + welcome split), `pages/` (Dashboard=welcome, DailyBriefing, QuoteAnalytics, PipelineBoard, PipelineHealth, RFQTracker, CustomBuilder, SalesBrief), `components/pipeline/` (KpiHeader, BoardFilters, Kanban/Funnel/Forecast/Flow/Bubble views, MultiSelect, OpportunityDrawer), `utils/pipeline.js` (client aggregation + `statusBucket`/`emptyBoardFilters`), `auth/` (MSAL + AccessGate), `index.css` (theme + all component styles).

**Tests:** `cx-dashboard-api/test/aggregations.test.js` — `npm run test:aggregations`.
