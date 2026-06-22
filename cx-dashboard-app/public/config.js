// Runtime configuration — loaded before the app bundle.
// Edit this file in dist/ (or re-push) to change config without rebuilding.
window.__APP_CONFIG__ = {
  DASHBOARD_API_URL: 'https://cx-dashboard-api.cfapps.eu10.hana.ondemand.com',
  AZURE_CLIENT_ID: '6e70fc21-4a12-4191-803f-1433e14e7ac0',
  AZURE_TENANT_ID: '0f861177-7722-4f06-8db9-3384e5321a9f',
  // "Open in C4C" deep links — Prod tenant
  C4C_UI_BASE: 'https://my332854.crm.ondemand.com',
  // Optional per-type URL overrides with {id} placeholder, e.g.:
  // C4C_LINK_TEMPLATES: { rfq: 'https://my332854.crm.ondemand.com/...{id}...' },
};
