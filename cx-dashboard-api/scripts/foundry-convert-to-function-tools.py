"""
Converts AnalyticsAgent's tools in Azure AI Foundry (proj-C4C) from OpenAPI-type
to Function-type, so the agent's run pauses with requires_action/submit_tool_outputs
instead of Foundry executing the HTTP call itself (which structurally cannot
forward the real signed-in user's token). The portal does not support editing
function definitions (confirmed via Microsoft's own function-calling docs) --
this must run via the SDK.

Requires real Azure credentials for proj-C4C (az login as a principal with Owner/
Contributor on the project, or a service principal env-configured for
DefaultAzureCredential). This script does NOT run in the Claude cloud session --
run it wherever you have that access (your machine, Cowork if it has az login).

Install: pip install "azure-ai-projects>=2.1.0" azure-identity

The 8 function schemas below are copied directly from
cx-dashboard-api/openapi/analytics-tools.json's requestBody schemas -- kept in
sync by hand; if that spec changes, update this list to match.
"""

from azure.identity import DefaultAzureCredential
from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import FunctionTool

ENDPOINT = "https://azr-fou-sc-cx.services.ai.azure.com/api/projects/proj-C4C"
AGENT_NAME = "AnalyticsAgent"

FUNCTION_TOOLS = [
    FunctionTool(
        name="list_fields",
        description=(
            "List real field names on a C4C collection. Call this before aggregate "
            "whenever a field name isn't already confirmed via the glossary -- "
            "never guess a field name."
        ),
        parameters={
            "type": "object",
            "properties": {
                "collection": {
                    "type": "string",
                    "enum": ["opportunities", "opportunity-items", "quotes", "quote-items", "rfqs"],
                }
            },
            "required": ["collection"],
        },
    ),
    FunctionTool(
        name="resolve_org_scope",
        description=(
            "Resolve a free-text org/country/region term against the real C4C sales "
            "org catalog. Always call this before using any org/region term as a "
            "filter. Returns matchType: single, multiple, region, ambiguous, or none. "
            "On ambiguous, report failure and surface the real candidate names "
            "instead of guessing."
        ),
        parameters={
            "type": "object",
            "properties": {
                "term": {"type": "string", "description": 'e.g. "Hungary" or "Europe"'}
            },
            "required": ["term"],
        },
    ),
    FunctionTool(
        name="aggregate",
        description=(
            "Sum, count, or average ONE confirmed field across Opportunities or "
            "Quotes, scoped to at most one org. fieldName must come from list_fields "
            "or the glossary -- a guessed field name silently returns zero, which "
            "must be treated as failure, not a real zero."
        ),
        parameters={
            "type": "object",
            "properties": {
                "entity": {"type": "string", "enum": ["opportunities", "quotes"]},
                "fieldName": {"type": "string"},
                "aggregation": {"type": "string", "enum": ["sum", "count", "avg"]},
                "status": {"type": "string", "enum": ["won", "open", "lost", "all"]},
                "salesOrgId": {
                    "type": "string",
                    "description": "Bare org ID or country/region name only, if already resolved via resolve_org_scope.",
                },
                "account": {"type": "string"},
                "dateFrom": {"type": "string"},
                "dateTo": {"type": "string"},
                "secondaryDateField": {"type": "string"},
                "secondaryDateFrom": {"type": "string"},
                "secondaryDateTo": {"type": "string"},
                "segment": {"type": "string", "description": "AER, AUT, HM, or IND (or the name)."},
                "application": {"type": "string"},
                "marketSegmentGroup": {"type": "string"},
                "strategicAccount": {"type": "string"},
            },
            "required": ["entity", "fieldName", "aggregation"],
        },
    ),
    FunctionTool(
        name="aggregate_by_org",
        description=(
            "Per-org breakdown AND total of sum/count/avg across MULTIPLE orgs in "
            "one call -- use whenever more than one org/country/region is involved, "
            "instead of calling aggregate once per org. Keeps currency-field choice "
            "consistent across every org and keeps 0-result orgs visible."
        ),
        parameters={
            "type": "object",
            "properties": {
                "entity": {"type": "string", "enum": ["opportunities", "quotes"]},
                "fieldName": {"type": "string"},
                "aggregation": {"type": "string", "enum": ["sum", "count", "avg"]},
                "orgs": {
                    "type": "array",
                    "description": "The exact orgs array from a resolve_org_scope result -- do not hand-build this list.",
                    "items": {
                        "type": "object",
                        "properties": {"id": {"type": "string"}, "name": {"type": "string"}},
                        "required": ["id", "name"],
                    },
                },
                "status": {"type": "string", "enum": ["won", "open", "lost", "all"]},
                "dateFrom": {"type": "string"},
                "dateTo": {"type": "string"},
                "secondaryDateField": {"type": "string"},
                "secondaryDateFrom": {"type": "string"},
                "secondaryDateTo": {"type": "string"},
                "segment": {"type": "string"},
                "application": {"type": "string"},
                "marketSegmentGroup": {"type": "string"},
                "strategicAccount": {"type": "string"},
            },
            "required": ["entity", "fieldName", "aggregation", "orgs"],
        },
    ),
    FunctionTool(
        name="count_quote_conversions",
        description=(
            "Count opportunities converted to a Sales Quote, scoped to at most one "
            "org. Internally prefers ZQuoteExist_KUT when populated, else falls back "
            "to the document-reference join; response includes which method was "
            "used. For more than one org use count_quote_conversions_by_org instead."
        ),
        parameters={
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": ["won", "open", "lost", "all"]},
                "salesOrgId": {"type": "string"},
                "account": {"type": "string"},
                "dateFrom": {"type": "string"},
                "dateTo": {"type": "string"},
                "segment": {"type": "string"},
                "application": {"type": "string"},
                "marketSegmentGroup": {"type": "string"},
                "strategicAccount": {"type": "string"},
            },
            "required": [],
        },
    ),
    FunctionTool(
        name="count_quote_conversions_by_org",
        description=(
            "Same as count_quote_conversions but across MULTIPLE orgs in one call. "
            "Runs the count once per org server-side with one consistent method, "
            "returning a per-org breakdown plus the combined total."
        ),
        parameters={
            "type": "object",
            "properties": {
                "orgs": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {"id": {"type": "string"}, "name": {"type": "string"}},
                        "required": ["id", "name"],
                    },
                },
                "status": {"type": "string", "enum": ["won", "open", "lost", "all"]},
                "account": {"type": "string"},
                "dateFrom": {"type": "string"},
                "dateTo": {"type": "string"},
                "segment": {"type": "string"},
                "application": {"type": "string"},
                "marketSegmentGroup": {"type": "string"},
                "strategicAccount": {"type": "string"},
            },
            "required": ["orgs"],
        },
    ),
    FunctionTool(
        name="count_rfqs_from_quotes",
        description=(
            "Count RFQs raised from quotes (derived from RFQ_IDcontent_SDK on "
            "SalesQuoteItem). CAVEAT: this field has not been observed populated in "
            "any sample record -- a 0 result must be reported as 'field may not be "
            "populated by the current process', not as a confident 'no RFQs were "
            "raised'. No org/account filter yet."
        ),
        parameters={
            "type": "object",
            "properties": {
                "dateFrom": {"type": "string"},
                "dateTo": {"type": "string"},
            },
            "required": [],
        },
    ),
    FunctionTool(
        name="list_sales_orgs",
        description="Full real sales org catalog (id + name). Useful for displaying readable org names after resolve_org_scope.",
        parameters={"type": "object", "properties": {}, "required": []},
    ),
]


def main():
    with DefaultAzureCredential() as credential, AIProjectClient(
        endpoint=ENDPOINT,
        credential=credential,
        allow_preview=True,
    ) as project_client:
        agent = project_client.agents.get(agent_name=AGENT_NAME)
        print(f"Current version: {agent.version}")
        print(f"Current tools: {[t.get('type') for t in (agent.tools or [])]}")

        new_version = project_client.agents.create_version(
            agent_name=AGENT_NAME,
            model=agent.model,
            instructions=agent.instructions,
            tools=FUNCTION_TOOLS,
        )
        print(f"Created version: {new_version.version}")
        print(f"New tools: {[t.get('type') for t in (new_version.tools or [])]}")
        print(
            "Done. AnalyticsAgent's tools are now function-type -- Foundry will no "
            "longer execute them itself. Any caller driving this agent's runs must "
            "now handle requires_action/submit_tool_outputs for all 8 operations."
        )


if __name__ == "__main__":
    main()
