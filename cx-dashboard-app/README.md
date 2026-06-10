# cx-dashboard-app

SAP Analytics Cloud–inspired React 18 + Vite dashboard for TSS. Dark enterprise
theme, Azure AD login (MSAL, PKCE), deployed as a static app to BTP CF eu10.

## Pages

1. **Daily Briefing** (default) — 6 KPI cards, quotes-this-week + pipeline charts,
   open quotes table, today's tasks.
2. **Quote Analytics** — KPIs incl. win rate, status pie, 6-month trend,
   top customers, business types, sales orgs, full sortable/paginated table.
3. **Pipeline Health** — total/weighted pipeline, funnel, by-owner,
   expected close by month, opportunity table.
4. **RFQ Tracker** — open/overdue/due-this-week, status pie, volume trend,
   table with due-date highlighting (red overdue / yellow due ≤7 days).
5. **Custom Builder** ✨ — natural-language input → `/api/dashboard/generate`
   → DynamicChart + AI insights + data table + PNG export.

Global FilterBar (date range with presets, sales-org search, owner) persists
across pages via React context; Apply refetches all page data.

## Runtime configuration

`public/config.js` (copied to `dist/config.js` at build time) defines
`window.__APP_CONFIG__` — API URL, Azure client/tenant IDs. Edit it after
deployment without rebuilding. `VITE_` env vars are intentionally not used:
they would be baked in at build time and unchangeable in a static deployment.

## Auth

- MSAL browser with `sessionStorage` cache (BTP compatible).
- Acquires the **access** token for scope `api://<clientId>/access_as_user`
  via `acquireTokenSilent`, falling back to `acquireTokenRedirect`.
- Axios interceptor injects `Authorization: Bearer`; one retry on 401.

## Build & deploy

```sh
npm install
npm run build        # → dist/ (includes config.js + Staticfile with pushstate)
cf push              # manifest path: dist, staticfile_buildpack, 64M
```

`public/Staticfile` contains `pushstate: enabled` so React Router deep links
serve index.html.

## After deployment (manual, one time)

1. Azure Portal → App Registrations → ARZ-TSS-SAPBTP-MCP → Authentication →
   **Single-page application** (SPA, not Web — MSAL uses PKCE) → add redirect URI
   `https://cx-dashboard-app.cfapps.eu10.hana.ondemand.com`.
2. `cf set-env cx-dashboard-api ANTHROPIC_API_KEY … && cf restage cx-dashboard-api`.
3. Verify the C4C audit log shows the real user identity on data access.
