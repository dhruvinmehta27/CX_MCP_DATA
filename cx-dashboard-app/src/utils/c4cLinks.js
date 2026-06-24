/**
 * Deep links into the C4C UI. The URL pattern is runtime-configurable via
 * public/config.js so it can be corrected without a rebuild:
 *   C4C_UI_BASE:        tenant UI host
 *   C4C_LINK_TEMPLATES: optional per-type overrides with {id} placeholder,
 *                       e.g. { rfq: 'https://.../{id}' }
 */
const cfg = window.__APP_CONFIG__ || {};

const DEFAULT_TYPES = {
  quote: 'COD_SALES_QUOTE',
  opportunity: 'COD_OPPORTUNITY',
};

export function c4cObjectUrl(type, objectId) {
  if (!objectId) return null;
  const template = (cfg.C4C_LINK_TEMPLATES || {})[type];
  if (template) return template.replace('{id}', objectId);
  const base = cfg.C4C_UI_BASE;
  const boType = DEFAULT_TYPES[type];
  if (!base || !boType) return null;
  return `${base}/sap/ap/ui/clogin?object-type=${boType}&object-action=DISPLAY&object-value=${objectId}`;
}
