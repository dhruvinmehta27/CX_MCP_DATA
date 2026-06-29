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

const RFQ_WOC_ID = '/Y1WQ4AMSY_MAIN/SRC/Custom/BO/RFQ/RFQ_WCF.WCF.uiwoc';

export function c4cObjectUrl(type, objectId) {
  if (!objectId) return null;
  const template = (cfg.C4C_LINK_TEMPLATES || {})[type];
  if (template) return template.replace('{id}', objectId);
  const base = cfg.C4C_UI_BASE;
  if (!base) return null;
  if (type === 'rfq') {
    return `${base}/sap/ap/ui/clogin?woc-id=${encodeURIComponent(RFQ_WOC_ID)}&object-action=DISPLAY&object-value=${objectId}`;
  }
  const boType = DEFAULT_TYPES[type];
  if (!boType) return null;
  return `${base}/sap/ap/ui/clogin?object-type=${boType}&object-action=DISPLAY&object-value=${objectId}`;
}
