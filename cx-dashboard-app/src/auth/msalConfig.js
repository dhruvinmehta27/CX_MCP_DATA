const cfg = window.__APP_CONFIG__ || {};

export const msalConfig = {
  auth: {
    clientId: cfg.AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${cfg.AZURE_TENANT_ID}`,
    redirectUri: window.location.origin,
  },
  cache: {
    // sessionStorage (not localStorage) — BTP compatible, survives refresh
    cacheLocation: 'sessionStorage',
  },
};

// Always the ACCESS token scope, never an ID-token scope.
export const tokenRequest = {
  scopes: [`api://${cfg.AZURE_CLIENT_ID}/access_as_user`],
};
