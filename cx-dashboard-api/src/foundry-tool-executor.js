/**
 * In-process executor for the 8 analytics tools, callable directly from the
 * Foundry orchestrator loop (routes/foundry-agent.js) without an HTTP hop —
 * same dispatch shape as routes/tools.js's REST handlers and the same
 * response enrichment (unit/fieldLabel/zero-result warnings), just invoked
 * as a plain function instead of over the wire, since the orchestrator is
 * already inside this same Node process.
 *
 * Deliberately not sharing code with tools.js (some duplication) rather than
 * having the orchestrator make loopback HTTP calls to its own app, or having
 * tools.js depend on this file — three call paths now exist for the same
 * underlying analytics-service functions (claude.js's in-process Anthropic
 * loop, tools.js's REST endpoints for an external caller, and this in-process
 * executor for the Foundry orchestrator loop) and each is kept independently
 * readable rather than layered through shared indirection.
 */
import {
  aggregateField,
  aggregateByOrgs,
  opportunitiesConvertedToQuote,
  countQuoteConversionsByOrgs,
  rfqsRaisedFromQuotes,
  resolveOrgScopeTool,
  getSalesOrgs,
} from './analytics-service.js';
import { fetchCollectionFields } from './c4c-client.js';
import { getFieldDisplayLabel } from './claude.js';

function withUnit(result, unit, fieldLabel) {
  return { ...result, unit, fieldLabel };
}

function remapConversionBreakdown(breakdown = []) {
  return breakdown.map((row) => ({
    Org: row.Org,
    Value: row['Converted to quote'],
    'Records matched': row['Total opportunities'],
    'Conversion rate': row['Conversion rate'],
  }));
}

function withZeroValueFlag(result) {
  const suspicious = result.recordsMatched > 0 && result.valuesFound === 0;
  return suspicious
    ? { ...result, likelyWrongField: true, warning: 'valuesFound is 0 while recordsMatched > 0 — this field name is likely wrong or empty for every matched record. Do not report this as a real "0" answer; try a different field from list_fields, or report that the value could not be computed.' }
    : result;
}

// name: the function tool's name as Foundry sends it (matches the 8
// FunctionTool names in scripts/foundry-convert-to-function-tools.py).
// args: already-parsed JSON object (caller parses the function_call's
// stringified arguments before calling this).
export async function executeFoundryTool(name, args, userJwt, userEmail) {
  switch (name) {
    case 'list_fields': {
      const fields = await fetchCollectionFields(args.collection, userJwt);
      return { collection: args.collection, fields };
    }
    case 'resolve_org_scope':
      return resolveOrgScopeTool({ term: args.term }, userJwt);
    case 'aggregate': {
      const { entity, fieldName, aggregation, ...rest } = args;
      const filters = {
        salesOrgId: rest.salesOrgId || null,
        account: rest.account || null,
        dateFrom: rest.dateFrom || null,
        dateTo: rest.dateTo || null,
        status: rest.status || 'all',
        secondaryDateField: rest.secondaryDateField || null,
        secondaryDateFrom: rest.secondaryDateFrom || null,
        secondaryDateTo: rest.secondaryDateTo || null,
        segment: rest.segment || null,
        application: rest.application || null,
        marketSegmentGroup: rest.marketSegmentGroup || null,
        strategicAccount: rest.strategicAccount || null,
      };
      const result = await aggregateField({ entity, fieldName, aggregation, filters }, userJwt, userEmail);
      const unit = aggregation === 'count' ? 'count' : 'currency';
      return withZeroValueFlag(withUnit(result, unit, getFieldDisplayLabel(result.fieldName)));
    }
    case 'aggregate_by_org': {
      const { entity, fieldName, aggregation, orgs, ...rest } = args;
      const filters = {
        dateFrom: rest.dateFrom || null,
        dateTo: rest.dateTo || null,
        status: rest.status || 'all',
        secondaryDateField: rest.secondaryDateField || null,
        secondaryDateFrom: rest.secondaryDateFrom || null,
        secondaryDateTo: rest.secondaryDateTo || null,
        segment: rest.segment || null,
        application: rest.application || null,
        marketSegmentGroup: rest.marketSegmentGroup || null,
        strategicAccount: rest.strategicAccount || null,
      };
      const result = await aggregateByOrgs({ entity, fieldName, aggregation, orgs, filters }, userJwt, userEmail);
      const unit = aggregation === 'count' ? 'count' : 'currency';
      return withUnit(result, unit, getFieldDisplayLabel(result.fieldUsed || fieldName));
    }
    case 'count_quote_conversions': {
      const filters = {
        salesOrgId: args.salesOrgId || null,
        account: args.account || null,
        dateFrom: args.dateFrom || null,
        dateTo: args.dateTo || null,
        status: args.status || 'all',
        segment: args.segment || null,
        application: args.application || null,
        marketSegmentGroup: args.marketSegmentGroup || null,
        strategicAccount: args.strategicAccount || null,
      };
      const result = await opportunitiesConvertedToQuote(filters, userJwt, userEmail);
      return withUnit(result, 'count', 'Opportunities Converted to Quote');
    }
    case 'count_quote_conversions_by_org': {
      const { orgs, ...rest } = args;
      const filters = {
        account: rest.account || null,
        dateFrom: rest.dateFrom || null,
        dateTo: rest.dateTo || null,
        status: rest.status || 'all',
        segment: rest.segment || null,
        application: rest.application || null,
        marketSegmentGroup: rest.marketSegmentGroup || null,
        strategicAccount: rest.strategicAccount || null,
      };
      const result = await countQuoteConversionsByOrgs({ orgs, filters }, userJwt, userEmail);
      return {
        ...withUnit(result, 'count', 'Opportunities Converted to Quote'),
        breakdown: remapConversionBreakdown(result.breakdown),
      };
    }
    case 'count_rfqs_from_quotes': {
      const result = await rfqsRaisedFromQuotes({ dateFrom: args.dateFrom || null, dateTo: args.dateTo || null }, userJwt, userEmail);
      const enriched = withUnit(result, 'count', 'RFQs Raised from Quotes');
      return result.uniqueRFQCount === 0
        ? { ...enriched, warning: 'This field (RFQ_IDcontent_SDK) has not been observed populated in any sample record during development. Report this 0 as "the underlying field may not be populated by the current process" — not as a confident "no RFQs were raised".' }
        : enriched;
    }
    case 'list_sales_orgs': {
      const orgs = await getSalesOrgs(userJwt);
      return { orgs };
    }
    default:
      throw new Error(`Unknown Foundry function tool: ${name}`);
  }
}
