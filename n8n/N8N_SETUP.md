# n8n Workflow & AI Agent Setup Guide

> **AISHA AI Orchestrator** — Personal Agents + Workflow Agents + MCP Integration
> Production instance: **https://n8n.aisha.guru/**
> MCP Server: **mcp-knowledge-server** (30+ tools)

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                      n8n @ n8n.aisha.guru                             │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  AI AGENTS (Personal Agents)                                   │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │  │
│  │  │ Knowledge   │  │ Compliance  │  │  Delivery   │           │  │
│  │  │   Agent     │  │   Agent     │  │   Agent     │           │  │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘           │  │
│  │         └───────── MCP Client ────────────┘                   │  │
│  │                      │                                        │  │
│  │  ┌───────────────────▼─────────────────────────────────────┐  │  │
│  │  │  DIRIGENT AGENT (Master Orchestrator)                   │  │  │
│  │  │  MCP Tools (30+) + Workflow Agent Tools:                │  │  │
│  │  │  ┌──────────┐  ┌──────────┐  ┌──────────┐              │  │  │
│  │  │  │ PR Gate  │  │ Reroute  │  │  Audit   │ sub-workflow │  │  │
│  │  │  └──────────┘  └──────────┘  └──────────┘              │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  WORKER WORKFLOWS (triggered by agents or events)              │  │
│  │  PR Gate │ Compliance Reroute │ Nightly Audit                  │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────┬───────────────────────────────────────────┘
                           │ JSON-RPC 2.0 (MCP Streamable HTTP)
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Supabase                                                            │
│  ┌─────────────────────────────────────┐                            │
│  │ mcp-knowledge-server (30+ tools)    │ ← n8n MCP Client target   │
│  │ Knowledge │ Delivery │ Compliance   │                            │
│  │ Router │ Composer │ Dirigent        │                            │
│  └─────────────────┬───────────────────┘                            │
│  ┌─────────────────▼───────────────────┐                            │
│  │ PostgreSQL + pgvector               │                            │
│  │ expert_rules │ ai_runs │ ai_trace   │                            │
│  └─────────────────────────────────────┘                            │
└──────────────────────────────────────────────────────────────────────┘
          ▲                                  ▲
          │                                  │
┌─────────┴──────────┐          ┌────────────┴─────────────┐
│ GitHub (webhooks)  │          │ Admin UI (n8n-trigger)   │
│ → webhook-bridge   │          │ → programmatic triggers  │
└────────────────────┘          └──────────────────────────┘
```

## Prerequisites

- n8n on Coolify — **https://n8n.aisha.guru/** ✅
- Supabase project with all migrations applied
- GitHub App or PAT with `checks:write` and `pull_requests:read` scopes
- Keycloak/OAuth access token for user-scoped MCP calls, or a scoped Keycloak service account for internal automation

## Credentials to Configure in n8n

### 1. Supabase Service Role (`supabase-service`)

| Setting | Value |
|---------|-------|
| **Type** | Header Auth |
| **Header Name** | `Authorization` + `apikey` |
| **Header Value** | `Bearer <SERVICE_ROLE_KEY>` for Auth, `<SERVICE_ROLE_KEY>` for apikey |

> Set these as a single "HTTP Header Auth" credential with name `Supabase Service Role`.

### 2. GitHub Token (`github-token`)

| Setting | Value |
|---------|-------|
| **Type** | Header Auth |
| **Header Name** | `Authorization` |
| **Header Value** | `Bearer <GITHUB_PAT_OR_APP_TOKEN>` |

Required scopes: `checks:write`, `pull_requests:read`, `contents:read`

### 3. Environment Variables

Set these in n8n Settings → Variables:

| Variable | Value |
|----------|-------|
| `AISHA_POSTGREST_URL` | `https://<project-ref>.supabase.co` |
| `AISHA_ACCESS_TOKEN` | Short-lived Keycloak/OAuth bearer for MCP tool calls |
| `N8N_API_KEY` | API key from n8n Settings → API (same as Edge Function secret) |
| `ADMIN_USER_ID` | UUID of the admin user receiving Copilot push notifications |

## Workflow Import

### Step 1: Import Workflows

1. Open n8n UI → **Workflows** → **Import from File**
2. Import each JSON file in order:
   - `WF_PR_COMPLIANCE_GATE.json`
   - `WF_COMPLIANCE_REROUTE.json`
   - `WF_NIGHTLY_STORY_AUDIT.json`

### Step 2: Configure Credentials

After import, each workflow will show ⚠️ on nodes needing credentials:
- Link all `supabase-service` credential references
- Link all `github-token` credential references

### Step 3: Activate Workflows

1. **WF_PR_COMPLIANCE_GATE** → Activate → Copy webhook URL
2. **WF_COMPLIANCE_REROUTE** → Activate → Copy webhook URL
3. **WF_NIGHTLY_STORY_AUDIT** → Activate (CRON auto-triggers at 02:00 Prague time)

### Step 4: Configure GitHub Webhook (via Bridge)

Instead of pointing GitHub directly to n8n, use the **webhook bridge** edge function:

1. Go to GitHub repository → **Settings** → **Webhooks** → **Add webhook**
2. **Payload URL:** `https://<supabase-url>/functions/v1/github-webhook-bridge`
3. **Content type:** `application/json`
4. **Secret:** Same as `GITHUB_WEBHOOK_SECRET` env var
5. **Events:** Select individual events:
   - Pull requests
   - Pushes
   - Issues
   - Issue comments
6. **Active:** ✅

> The bridge verifies HMAC-SHA256 signature and routes events to the
> appropriate n8n webhook on `n8n.aisha.guru`.

### Step 5: Configure Edge Function Environment

Set these in Supabase Edge Function secrets (or `.env`):

| Variable | Value | Purpose |
|----------|-------|---------|
| `N8N_WEBHOOK_URL` | `https://n8n.aisha.guru` | Base URL of n8n instance |
| `N8N_API_KEY` | `<from n8n Settings → API>` | Internal gateway → n8n webhook auth |
| `GITHUB_WEBHOOK_SECRET` | `<shared secret>` | HMAC verification |

### Programmatic Triggers (Gateway n8n Trigger)

Admin/staff users can trigger workflows via the gateway `admin/n8n-trigger` route. Caller auth is a Keycloak/OAuth user token; the gateway performs the admin/staff check before forwarding internally to n8n:

```bash
# Trigger nightly audit manually
curl -X POST https://<api-gateway-url>/admin/n8n-trigger \
  -H "Authorization: Bearer <user-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"workflow": "nightly-audit", "payload": {}}'

# Trigger compliance reroute
curl -X POST https://<api-gateway-url>/admin/n8n-trigger \
  -H "Authorization: Bearer <user-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "workflow": "compliance-reroute",
    "payload": {
      "story_id": "<uuid>",
      "pr_number": 42,
      "violations": ["no_ruleset"]
    }
  }'
```

## Workflow Details

### WF_PR_COMPLIANCE_GATE

```
GitHub PR (opened/synchronize)
  → Filter (only opened + synchronize)
  → Get PR Diff (GitHub API)
  → Extract PR Context (story_id from branch/labels)
  → Route Task (pr_gate) + Validate Compliance + Create AI Run
  → Evaluate Result
  → GitHub Check Run (pass/fail)
```

**Trigger:** GitHub webhook on PR events
**Output:** GitHub Check Run on the PR commit

### WF_COMPLIANCE_REROUTE

```
Webhook (from PR Gate fail)
  → Parse Input (story_id, violations, attempt count)
  → Max Attempts? (≥2 → escalate to human)
  → Route Fix Task (incident mode, high risk)
  → Compose Fix Context (repo_plus_rules profile)
  → Re-check Compliance
  → Log Trace Event
```

**Trigger:** Called by PR Gate workflow when compliance fails
**Escalation:** After 2 failed attempts → human approval required

### WF_NIGHTLY_STORY_AUDIT

```
CRON (02:00 daily, Europe/Prague)
  → Get Active Stories (in_progress/qa/review)
  → Batch (5 at a time)
  → Validate Compliance per story
  → Evaluate (has_ruleset, stale, needs_attention)
  → Log Audit Run
  → Aggregate Results → Log Summary
```

**Trigger:** Daily at 02:00
**Output:** Audit summary in `audit_journal` table

## Testing

### Manual Test: PR Compliance Gate (via Bridge)

```bash
# Trigger via webhook bridge (simulates GitHub webhook)
curl -X POST https://<supabase-url>/functions/v1/github-webhook-bridge \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: pull_request" \
  -H "X-GitHub-Delivery: test-001" \
  -d '{
    "action": "opened",
    "pull_request": {
      "number": 42,
      "title": "Test PR",
      "head": {
        "ref": "feature/story-<story-uuid>",
        "sha": "abc123"
      },
      "diff_url": "https://github.com/owner/repo/pull/42.diff",
      "labels": []
    },
    "repository": {
      "full_name": "owner/repo"
    }
  }'
```

### Manual Test: Direct n8n (without bridge)

```bash
# Trigger n8n directly (for testing)
curl -X POST https://n8n.aisha.guru/webhook/pr-compliance-gate \
  -H "Content-Type: application/json" \
  -d '{
    "action": "opened",
    "pull_request": {
      "number": 42,
      "title": "Test PR",
      "head": {
        "ref": "feature/test",
        "sha": "abc123"
      },
      "diff_url": "https://github.com/owner/repo/pull/42.diff",
      "labels": []
    },
    "repository": {
      "full_name": "owner/repo"
    }
  }'
```

### Manual Test: Nightly Audit

In n8n UI: Open `WF_NIGHTLY_STORY_AUDIT` → Click **Execute Workflow**

### Verify Results

```sql
-- Check AI runs created by workflows
SELECT id, kind, status, route_plan->'audit_type' as type
FROM ai_runs
WHERE kind IN ('pr_gate', 'compliance_check')
ORDER BY started_at DESC LIMIT 10;

-- Check trace events
SELECT ae.event_type, ae.operation, ae.status, ae.created_at
FROM ai_trace_events ae
WHERE ae.event_type IN ('compliance_check', 'human_approval')
ORDER BY ae.created_at DESC LIMIT 10;
```

---

## AI Agent Workflows (n8n Personal Agents + MCP)

n8n nabízí **AI Agent** nody založené na LangChain ReAct patternu — autonomní agenty s tool calling, pamětí a sub-workflow delegací. AISHA je využívá pro:

| Agent | Workflow JSON | Popis |
|-------|-------|-------|
| **Knowledge Agent** | `WF_KNOWLEDGE_AGENT.json` | Vyhledávání v knowledge base, expert matching |
| **Compliance Agent** | `WF_COMPLIANCE_AGENT.json` | Autonomní kontrola compliance s reasoning |
| **Delivery Agent** | `WF_DELIVERY_AGENT.json` | Řízení delivery lifecycle stories |
| **Dirigent Agent** | `WF_DIRIGENT_AGENT.json` | Master orchestrátor — koordinuje ostatní agenty |

### Klíčové n8n nody

| Node | Typ | Verze | Účel |
|------|-----|-------|------|
| AI Agent | `@n8n/n8n-nodes-langchain.agent` | 1.7 | Autonomní agent (ReAct) |
| MCP Client Tool | `@n8n/n8n-nodes-langchain.toolMcp` | 1 | Připojení k MCP serveru |
| Workflow Tool | `@n8n/n8n-nodes-langchain.toolWorkflow` | 2 | Sub-workflow jako tool |
| Buffer Memory | `@n8n/n8n-nodes-langchain.memoryBufferWindow` | 1.3 | Konverzační paměť |
| Chat Trigger | `@n8n/n8n-nodes-langchain.chatTrigger` | 1.1 | Interaktivní chat UI |
| OpenAI LLM | `@n8n/n8n-nodes-langchain.lmChatOpenAi` | 1.2 | GPT-4o model |

### Step 6: Import AI Agent Workflows

1. **Import v pořadí** (sub-agenty před Dirigentem):
   - `WF_KNOWLEDGE_AGENT.json`
   - `WF_COMPLIANCE_AGENT.json`
   - `WF_DELIVERY_AGENT.json`
   - `WF_DIRIGENT_AGENT.json` (master — musí být poslední)

2. **Zapiš si workflow IDs** — po importu každého workflow si zkopíruj jeho ID z URL.

### Step 7: Configure AI Credentials

#### 7a. OpenAI API Credential

| Setting | Value |
|---------|-------|
| **Type** | OpenAI API |
| **Name** | `openai-api` |
| **API Key** | `<OPENAI_API_KEY>` |
| **Model** | `gpt-4o` (nastaveno v každém workflow) |

#### 7b. AISHA MCP Credential

| Setting | Value |
|---------|-------|
| **Type** | HTTP Header Auth |
| **Name** | `aisha-mcp` |
| **Header Name** | `Authorization` |
| **Header Value** | `Bearer <KEYCLOAK_ACCESS_TOKEN>` |

> Pro user-facing workflow používej krátkodobý Keycloak token přihlášeného uživatele; pro interní automatizaci jen omezený Keycloak service account s explicitními rolemi.

#### 7c. MCP Client Node Configuration

V každém AI Agent workflow najdi **MCP Client Tool** node a nastav:

| Setting | Value |
|---------|-------|
| **Transport** | `Streamable HTTP` |
| **URL** | `{{ $env.AISHA_POSTGREST_URL }}/functions/v1/mcp-knowledge-server` |
| **Credential** | `aisha-mcp` (Header Auth) |

### Step 8: Set Agent Environment Variables

V n8n **Settings → Variables** přidej:

| Variable | Value | Purpose |
|----------|-------|---------|
| `OPENAI_API_KEY` | `sk-...` | OpenAI API klíč |
| `WF_KNOWLEDGE_AGENT_ID` | `<id>` | Workflow ID Knowledge Agenta |
| `WF_COMPLIANCE_AGENT_ID` | `<id>` | Workflow ID Compliance Agenta |
| `WF_DELIVERY_AGENT_ID` | `<id>` | Workflow ID Delivery Agenta |
| `WF_NIGHTLY_AUDIT_ID` | `<id>` | Workflow ID Nightly Audit workflow |

> Tyto proměnné používá **Dirigent Agent** k volání sub-agentů přes Workflow Tool.

### Step 9: Activate AI Agents

1. **Knowledge Agent** → Activate → Webhook: `/webhook/knowledge-agent`
2. **Compliance Agent** → Activate → Webhook: `/webhook/compliance-agent`
3. **Delivery Agent** → Activate → Webhook: `/webhook/delivery-agent`
4. **Dirigent Agent** → Activate → Webhook: `/webhook/dirigent-agent` + Chat UI

### Step 10: Test AI Agents

```bash
# Test Knowledge Agent
curl -X POST https://n8n.aisha.guru/webhook/knowledge-agent \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Jaké jsou best practices pro onboarding specialistů?",
    "session_id": "test-001"
  }'

# Test Compliance Agent
curl -X POST https://n8n.aisha.guru/webhook/compliance-agent \
  -H "Content-Type: application/json" \
  -d '{
    "pr_number": 42,
    "repository": "aisha/aisha-dirigent",
    "story_id": "<uuid>",
    "diff_summary": "Added new RPC function without audit logging"
  }'

# Test Delivery Agent
curl -X POST https://n8n.aisha.guru/webhook/delivery-agent \
  -H "Content-Type: application/json" \
  -d '{
    "action": "transition",
    "story_id": "<uuid>",
    "target_status": "in_review",
    "session_id": "test-001"
  }'

# Test Dirigent Agent (via webhook)
curl -X POST https://n8n.aisha.guru/webhook/dirigent-agent \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Zkontroluj compliance story XYZ a navrhni delivery plán",
    "session_id": "test-001"
  }'
```

> **Dirigent Agent** má také **Chat Trigger** — otevři `https://n8n.aisha.guru/chat/dirigent-agent` pro interaktivní chat UI.

### Programmatic Agent Triggers

Agenty lze volat i přes gateway `admin/n8n-trigger` route:

```bash
# Trigger Knowledge Agent z Admin UI
curl -X POST https://<api-gateway-url>/admin/n8n-trigger \
  -H "Authorization: Bearer <user-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "workflow": "knowledge-agent",
    "payload": {
      "query": "Jaké jsou dostupné programy pro enterprise klienty?"
    }
  }'

# Trigger Dirigent Agent z Admin UI
curl -X POST https://<api-gateway-url>/admin/n8n-trigger \
  -H "Authorization: Bearer <user-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "workflow": "dirigent-agent",
    "payload": {
      "message": "Proveď nightly audit a pošli shrnutí"
    }
  }'
```

### Agent Architecture Details

Kompletní architektura, bezpečnostní model a rollout plán viz:
→ [docs/N8N_AGENT_ARCHITECTURE.md](../docs/N8N_AGENT_ARCHITECTURE.md)

---

## Multi-Model Routing (WF_MODEL_ROUTER)

Model Router umožňuje inteligentní směrování požadavků na různé LLM providery podle kontextu, rizika a typu úlohy.

### Architektura routeru

```
Request (task + provider hint)
  → Prepare & Auto-Resolve Provider
  → Switch Node:
      ├─ gemini   → AISHA Scout (Gemini 2.0 Flash)
      ├─ anthropic → [reserved for Claude]
      └─ openai   → AISHA Expert (GPT-4o)
  → Format Response (unified output)
  → Log Trace Event
```

### Model Router: Kdy co použít

| Kontext | Provider | Model | Důvod |
|---------|----------|-------|-------|
| `fast` / `low_risk` / `triage` | Google | `gemini-2.0-flash` | Rychlé, levné, dostatečně přesné |
| `high_risk` / `deep_analysis` / `compliance` | OpenAI | `gpt-4o` | Přesnost v kritických kontextech |
| `creative` / `research` | OpenAI | `gpt-4o` | Lepší reasoning |
| `code_review` | Auto | Dle `agent.model_overrides` | Router rozhodne dle rizikovosti |

### Triggering

```bash
# Via VS Code extension (slash command)
@aisha /route gemini Classify this error message

# Via gateway n8n trigger
curl -X POST https://<api-gateway-url>/admin/n8n-trigger \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "workflow": "model-router",
    "payload": {
      "task": "Classify this security finding",
      "provider": "openai"
    }
  }'
```

### Konfigurace v DB

Model overrides jsou uloženy v `agent_catalog.model_overrides` jako JSONB:

```json
{
  "fast": { "provider": "google", "model": "gemini-2.0-flash" },
  "low_risk": { "provider": "google", "model": "gemini-2.0-flash" },
  "high_risk": { "provider": "openai", "model": "gpt-4o" },
  "deep_analysis": { "provider": "openai", "model": "gpt-4o" }
}
```

---

## Workflow Chaining Patterns

n8n workflows lze řetězit v několika vzorech. AISHA používá všechny tři:

### Pattern 1: Sequential Chain (Agent → Sub-Agent → Result)

```
Dirigent Agent
  → calls Knowledge Agent (via Workflow Tool)
  → calls Compliance Agent (via Workflow Tool)
  → aggregates results
  → returns unified response
```

**Použití:** Komplexní úlohy kde Dirigent potřebuje data z více specializovaných agentů.

**Implementace v n8n:** Dirigent má Workflow Tool nody propojené na sub-agenty přes `$env.WF_KNOWLEDGE_AGENT_ID` atd.

### Pattern 2: Route & Switch (Router → Provider-specific Agent)

```
Request → Model Router
  → resolve provider (auto/explicit)
  → Switch Node:
      ├─ Provider A  → Agent A
      └─ Provider B  → Agent B
  → Unified Response
```

**Použití:** Multi-model routing — WF_MODEL_ROUTER.

**Implementace:** Code node auto-resolves provider z model prefix convention (`gemini-*` → google, `claude-*` → anthropic, default → openai). Switch node pak deleguje na správného agenta.

### Pattern 3: Event-Driven Pipeline

```
GitHub Webhook
  → webhook-bridge (HMAC verify)
  → n8n PR Gate workflow
  → on failure: triggers Compliance Reroute (sub-workflow)
  → on 2nd failure: escalates to human
```

**Použití:** CI/CD integrační pipeline — PR Compliance Gate → Reroute → Escalation.

**Implementace v n8n:** PR Gate má HTTP Request node který volá Compliance Reroute webhook. Reroute má counter a po 2 selháních generuje human approval task.

### Pattern 4: Bidirectional IDE ↔ n8n

```
VS Code Extension (@aisha /dirigent)
  → callN8nAgent("dirigent-agent", payload)
  → gateway /admin/n8n-trigger
  → n8n Dirigent Agent webhook
  → Agent uses MCP tools + sub-agents
  → Response back to VS Code
```

**Použití:** Přímá delegace z IDE na n8n orchestraci. Developer ptá Dirigenta přímo z VS Code.

**Implementace:**
1. VS Code extension `callN8nAgent()` → POST na gateway `/admin/n8n-trigger` s Keycloak user tokenem
2. Gateway ověří admin/staff oprávnění a routuje na správný n8n webhook (dle `WORKFLOW_MAP`)
3. n8n Agent zpracuje s MCP tools a vrátí response
4. Extension zobrazí výsledek v chat panelu

### Registrace nových workflow

Při přidání nového workflow:

1. Přidej webhook path do `N8N_WORKFLOW_MAP` v `services/gateway/src/routes/admin.ts`
2. Přidej JSON do `n8n/workflows/`
3. Dokumentuj v této sekci
4. Přidej system prompt do `n8n/prompts/SYSTEM_PROMPTS.md`

### Aktuální WORKFLOW_MAP

| Key | Webhook Path | Workflow |
|-----|-------------|----------|
| `pr-gate` | `/webhook/pr-compliance-gate` | PR Compliance Gate |
| `compliance-reroute` | `/webhook/compliance-reroute` | Compliance Reroute |
| `nightly-audit` | `/webhook/nightly-story-audit` | Nightly Audit |
| `knowledge-agent` | `/webhook/knowledge-agent` | Knowledge Agent |
| `compliance-agent` | `/webhook/compliance-agent` | Compliance Agent |
| `delivery-agent` | `/webhook/delivery-agent` | Delivery Agent |
| `dirigent-agent` | `/webhook/dirigent-agent` | Dirigent Master Agent |
| `model-router` | `/webhook/model-router` | Multi-model Router |
| `node-factory` | `/webhook/node-factory` | Node Factory (Self-Orchestration) |

---

## Custom Community Nodes — n8n-nodes-aisha

> Detailní dokumentace: [docs/N8N_COMMUNITY_NODES.md](../docs/N8N_COMMUNITY_NODES.md)

### Přehled

Vlastní community node package `n8n-nodes-aisha` s 6 nody a 2 credential typy:

| Node | Účel |
|------|------|
| **AishaRpc** | Universal Supabase RPC (26+ funkcí) |
| **AishaAudit** | SOC 2 audit journal writer (15 akcí) |
| **AishaStoryManager** | Delivery lifecycle (8 operací) |
| **AishaModelRouter** | Multi-LLM routing (4 výstupy) |
| **AishaTrigger** | Platform event polling (8 typů) |
| **AishaNodeFactory** | Self-orchestration meta-node |

### Instalace

```bash
cd packages/n8n-nodes-aisha
npm install && npm test && npm run build

# Deploy na n8n Coolify instanci
npm run deploy:n8n

# Nebo lokálně
npm run deploy:n8n -- --local
```

### Self-Orchestration

Workflow **WF_NODE_FACTORY** umožňuje Aisha Dirigent generovat nové community nody:
- Cron trigger (pondělí 3:00) + Webhook `/node-factory`
- Pipeline: Generate → Validate → Test → Register → Audit
- Aisha je svým vlastním klientem
