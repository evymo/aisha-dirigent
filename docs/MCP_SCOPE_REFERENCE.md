# MCP Tool Scope Reference

> AISHA Expert Overlay — MCP server v2.1 tool → scope mapping.
> For IDE integration and token provisioning.

## Scope Model

Each MCP tool maps to a scope. When creating MCP tokens via `create_mcp_token`,
use the `allowed_tools` / `denied_tools` arrays to control access.

## Tool → Scope Matrix (41 tools)

| Tool | Scope | Description | Auth Required |
|------|-------|-------------|---------------|
| **Knowledge** | | | |
| `search_knowledge` | `knowledge.read` | Full-text search over expert rules | ✅ |
| `search_knowledge_v2` | `knowledge.read` | Semantic vector + text hybrid search | ✅ |
| `search_ragnarok` | `knowledge.read` | Elasticsearch hybrid search (BM25+KNN) over uploaded documents via Ragnarok | ✅ |
| `get_expert_rule` | `knowledge.read` | Get single rule by slug | ✅ |
| `get_knowledge_item` | `knowledge.read` | Get knowledge item with chunks | ✅ |
| `get_knowledge_stats` | `knowledge.read` | Knowledge graph statistics | ✅ |
| `get_expertise_areas` | `knowledge.read` | List expertise areas with counts | ✅ |
| `match_experts` | `knowledge.read` | Find guild experts for context | ✅ |
| `get_agent_knowledge` | `knowledge.read` | Rules bound to a specific agent | ✅ |
| **Context** | | | |
| `get_project_context` | `context.read` | Compose knowledge for a project | ✅ |
| `get_story_context` | `context.read` | Full delivery context for a story | ✅ |
| `create_story_ruleset` | `rules.write` | Pin rules to story with fingerprint | ✅ |
| **Orchestration** | | | |
| `route_task` | `orchestration.execute` | Router: select agents + models | ✅ |
| `compose_context` | `orchestration.execute` | Context Composer: build bundle | ✅ |
| `validate_compliance` | `compliance.execute` | Quality gate compliance check | ✅ |
| `generate_copilot_instructions` | `orchestration.execute` | Auto-generate copilot-instructions.md | ✅ |
| `generate_default_instructions` | `orchestration.execute` | Default copilot instructions (no story required) | ✅ |
| `get_instruction_payload` | `orchestration.execute` | Raw payload for IDE instruction adapters | ✅ |
| **Dirigent** | | | |
| `moderate_flow` | `dirigent.execute` | Start moderation session for dev flow | ✅ |
| `evaluate_tests` | `dirigent.execute` | Test strategy evaluation | ✅ |
| `assess_quality` | `dirigent.execute` | Code quality assessment | ✅ |
| `suggest_next_step` | `dirigent.execute` | What to do next recommendation | ✅ |
| `estimate_effort` | `dirigent.execute` | Effort estimation for tasks | ✅ |
| `check_pr_compliance` | `dirigent.execute` | PR compliance gate check | ✅ |
| `detect_project_context_from_analysis` | `dirigent.execute` | Update story delivery context from repo analysis | ✅ |
| `recommend_ruleset_for_story` | `dirigent.execute` | Recommend expert rules based on tech_stack/domain | ✅ |
| **Delivery** | | | |
| `transition_delivery_status` | `delivery.write` | State machine transition | ✅ |
| `get_delivery_timeline` | `delivery.read` | Transition history | ✅ |
| `get_allowed_transitions` | `delivery.read` | Available next states | ✅ |
| `manage_story_environment` | `delivery.write` | Upsert environment config | ✅ |
| `get_story_environments` | `delivery.read` | List environments | ✅ |
| **Admin** (requires admin/staff role) | | | |
| `admin_list_services` | `admin.read` | List registered integration services with health | ✅ admin |
| `admin_health_check` | `admin.execute` | Ping all services, update health_status | ✅ admin |
| `admin_log_action` | `admin.write` | Write integration audit trail entry | ✅ admin |
| `admin_nocodb_query` | `admin.read` | Query records from NocoDB tables | ✅ admin |
| `admin_nocodb_manage` | `admin.write` | Create/update/delete NocoDB records | ✅ admin |
| `admin_langfuse_traces` | `admin.read` | Query LLM traces from Langfuse | ✅ admin |
| `admin_n8n_workflows` | `admin.write` | Manage n8n workflows (list, deploy, activate, drift check) | ✅ admin |
| `admin_github_git` | `admin.write` | Git operations on GitHub (branch, commit, PR, merge) | ✅ admin |
| `admin_appsmith` | `admin.write` | Manage Appsmith dashboards | ✅ admin |
| `admin_appsmith_manage` | `admin.read` | Read-only Appsmith dashboard operations | ✅ admin |

## Recommended Token Configurations

### IDE / Copilot Token (read-only + dirigent)
```json
{
  "scope": "project",
  "allowed_tools": [
    "search_knowledge", "search_knowledge_v2",
    "search_ragnarok",
    "get_expert_rule", "get_knowledge_item",
    "get_expertise_areas", "get_story_context",
    "get_project_context", "get_knowledge_stats",
    "moderate_flow", "suggest_next_step",
    "assess_quality", "evaluate_tests", "estimate_effort",
    "get_delivery_timeline", "get_allowed_transitions",
    "get_story_environments"
  ],
  "rate_limit_rpm": 30,
  "rate_limit_daily": 500
}
```

### CI/CD Pipeline Token (compliance gate)
```json
{
  "scope": "project",
  "allowed_tools": [
    "get_story_context", "validate_compliance",
    "compose_context", "search_knowledge_v2",
    "check_pr_compliance"
  ],
  "rate_limit_rpm": 10,
  "rate_limit_daily": 200
}
```

### Backend Autopilot Token (full orchestration)
```json
{
  "scope": "account",
  "allowed_tools": [
    "search_knowledge_v2", "get_story_context",
    "search_ragnarok",
    "create_story_ruleset", "route_task",
    "compose_context", "validate_compliance",
    "get_expert_rule", "get_knowledge_item",
    "generate_copilot_instructions",
    "moderate_flow", "evaluate_tests", "assess_quality",
    "suggest_next_step", "estimate_effort", "check_pr_compliance",
    "transition_delivery_status", "get_delivery_timeline",
    "get_allowed_transitions", "manage_story_environment",
    "get_story_environments"
  ],
  "rate_limit_rpm": 60,
  "rate_limit_daily": 2000
}
```

## VS Code / Cursor Setup

1. Create a project-scoped MCP token via admin UI or `create_mcp_token` RPC
2. Add to `.vscode/mcp.json`:
```json
{
  "mcpServers": {
    "aisha-knowledge": {
      "type": "http",
      "url": "https://YOUR_SUPABASE_URL/functions/v1/mcp-knowledge-server",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_TOKEN"
      }
    }
  }
}
```
3. Restart VS Code — tools appear in Copilot Chat / Cursor

## n8n Setup

Use the **MCP Client Tool** node with:
- **Transport:** HTTP (Streamable)
- **URL:** `https://YOUR_SUPABASE_URL/functions/v1/mcp-knowledge-server`
- **Auth:** Bearer token in header
- **Tool Selection:** "Selected" with specific tool names
