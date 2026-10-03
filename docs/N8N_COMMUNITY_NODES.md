# AISHA Community Nodes for n8n

> **Package:** `n8n-nodes-aisha` v0.5.7  
> **Umístění:** `packages/n8n-nodes-aisha/`  
> **n8n instance:** `https://n8n.aisha.guru`

---

## 📦 Přehled nodů

| Node | Typ | Popis | Klíčové operace |
|------|-----|-------|-----------------|
| **AishaRpc** | Execute | Universal Supabase RPC invocation | 26+ funkcí ve 6 kategoriích |
| **AishaAudit** | Execute | SOC 2 audit journal writer | 15 predefinovaných akcí |
| **AishaStoryManager** | Execute | Delivery lifecycle management | 8 operací (status, env, effort) |
| **AishaModelRouter** | Execute | Multi-LLM routing s fixními výstupy | 4 výstupy (OpenAI/Google/Anthropic/Fallback) |
| **AishaLlmRouter** | AI Language Model | Langchain-compatible LLM sub-node s provider failover | Připojení k Agent node jako language model |
| **AishaAdminBridge** | Execute | Autonomní admin interface (NocoDB/Langfuse/Forgejo) | 3 systémy, 10+ operací |
| **AishaTrigger** | Trigger (Poll) | Platform event listener | 8 typů událostí + deduplikace |
| **AishaNodeFactory** | Execute | Self-orchestration meta-node | Generate/Validate/Test/Deploy/Register |

---

## 🏗️ Architektura

```
┌──────────────────────────────────────────────────────────────┐
│                  n8n-nodes-aisha                             │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  AishaRpc   │  │  AishaAudit  │  │ AishaStoryMgr    │   │
│  │ (26+ RPC)   │  │ (SOC 2)      │  │ (Delivery)       │   │
│  └──────┬──────┘  └──────┬───────┘  └──────┬───────────┘   │
│         │                │                  │                │
│  ┌──────┴──────┐  ┌──────┴───────┐  ┌──────┴───────────┐   │
│  │ ModelRouter │  │ AishaTrigger │  │ AishaNodeFactory  │   │
│  │ (4 outputs) │  │ (8 events)   │  │ (Self-orchestr.)  │   │
│  └─────────────┘  └──────────────┘  └──────────────────┘   │
│                                                              │
│  Credentials: AishaPostgrestApi | AishaMcpApi | AishaNocoDbApi │
│               AishaLangfuseApi | AishaForgejoApi | AishaAppsmithApi │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  Supabase PostgREST → RPC Functions → PostgreSQL             │
└──────────────────────────────────────────────────────────────┘
```

### Datový tok

```
n8n Workflow → AishaRpc → POST /rest/v1/rpc/{fn} → Supabase PostgreSQL
                             ↓
                        AishaAudit → audit_journal table
                             ↓
                      AishaTrigger ← Poll: /rest/v1/rpc/{event_fn}
```

---

## 🔧 Instalace & Konfigurace

### Lokální vývoj

```bash
cd packages/n8n-nodes-aisha
npm install
npm test          # Spustit 48+ testů
npm run build     # Kompilace + kopie ikon
```

### Deploy na n8n instanci

```bash
# Coolify container (výchozí)
npm run deploy:n8n

# Lokální n8n
npm run deploy:n8n -- --local

# Pouze tarball
npm run deploy:n8n -- --tarball
```

### Credentials v n8n

Po instalaci nodů je nutné vytvořit credentials v n8n UI:

#### AishaPostgrestApi
| Pole | Hodnota |
|------|---------|
| PostgREST URL | `https://api.aisha.guru` |
| Service Role Key | `(z .env.aisha: AISHA_POSTGREST_SERVICE_KEY)` |
| Anon Key | `(volitelné)` |

#### AishaMcpApi
| Pole | Hodnota |
|------|---------|
| MCP Server URL | `https://api.aisha.guru/functions/v1/mcp-knowledge-server` |
| MCP Token | `(z .env.aisha: MCP_TOKEN)` |
| Scope | `session` |
#### AishaNocoDbApi
| Pole | Hodnota |
|------|--------|
| NocoDB API URL | URL NocoDB instance |
| API Token | NocoDB API token |

#### AishaLangfuseApi
| Pole | Hodnota |
|------|--------|
| Langfuse Host | `https://langfuse.aisha.guru` (nebo self-hosted) |
| Secret Key | Langfuse secret key |
| Public Key | Langfuse public key |

#### AishaForgejoApi
| Pole | Hodnota |
|------|--------|
| Forgejo URL | `https://repo.id3a.cz` |
| API Token | Forgejo Personal Access Token |

#### AishaAppsmithApi
| Pole | Hodnota |
|------|--------|
| Appsmith URL | Appsmith instance URL |
| API Key | Appsmith API key |
---

## 📋 Detail nodů

### AishaRpc — Universal RPC

Nahrazuje manuální httpRequest nody. Přes dropdown vybereš funkci, přidáš parametry.

**Kategorie:**
- **Knowledge:** `search_knowledge`, `search_knowledge_v2`, `get_expert_rule`, `get_expertise_areas`, `match_experts`, `get_agent_knowledge`, `get_knowledge_item`, `get_knowledge_stats`
- **Delivery:** `get_story_context`, `create_story_ruleset`, `transition_delivery_status`, `get_delivery_timeline`, `get_allowed_transitions`, `manage_story_environment`, `get_story_environments`
- **Orchestration:** `route_task`, `compose_context`, `suggest_next_step`, `estimate_effort`
- **Dirigent:** `generate_copilot_instructions`, `get_project_context`
- **Compliance:** `validate_compliance`, `moderate_flow`, `evaluate_tests`, `assess_quality`, `check_pr_compliance`
- **Custom:** Libovolný RPC function name

**Auth režimy:** `service_role` (výchozí), `anon`

### AishaAudit — Audit Journal Writer

SOC 2 compliant audit logging. Automaticky přikládá `workflow_id` a `workflow_name`.

**Předdefinované akce:**
`AGENT_INVOKED`, `COMPLIANCE_CHECK`, `DELIVERY_TRANSITION`, `KNOWLEDGE_ACCESS`, `ESCALATION`, `MODEL_ROUTING`, `NODE_FACTORY_GENERATE`, `NODE_FACTORY_VALIDATE`, `NODE_FACTORY_DEPLOY`, `CUSTOM_ACTION`, `DATA_EXPORT`, `PERMISSION_CHECK`, `CONFIGURATION_CHANGE`, `ERROR_RECOVERY`, `HEALTH_CHECK`

**Fallback:** Pokud RPC `insert_audit_entry` neexistuje, zapíše přímo do `audit_journal` tabulky přes REST.

### AishaStoryManager — Delivery Lifecycle

8 operací pro správu delivery stories:

| Operace | RPC funkce |
|---------|-----------|
| `getContext` | `get_story_context` |
| `transitionStatus` | `transition_delivery_status` |
| `getAllowedTransitions` | `get_allowed_transitions` |
| `getTimeline` | `get_delivery_timeline` |
| `manageEnvironment` | `manage_story_environment` |
| `getEnvironments` | `get_story_environments` |
| `createRuleset` | `create_story_ruleset` |
| `estimateEffort` | `estimate_effort` |

### AishaModelRouter — Multi-LLM Routing

Inteligentní routing na 4 výstupy podle rizika a typu úlohy:

| Výstup | Index | Kdy |
|--------|-------|-----|
| OpenAI (GPT-4o) | 0 | High risk, code review, quality-first |
| Google (Gemini) | 1 | Low risk, classification, cost-optimized |
| Anthropic (Claude) | 2 | Explicitní volba |
| Fallback | 3 | Nerozhodné, DB override chyba |

**Strategie:** `auto`, `explicit`, `costOptimized`, `qualityFirst`, `fromDb`

### AishaTrigger — Event Polling

Poll-based trigger s deduplikací (500 ID rolling window):

| Event | RPC |
|-------|-----|
| `story_created` | `get_recent_stories` |
| `story_status_changed` | `get_story_status_changes` |
| `compliance_result` | `get_compliance_results` |
| `escalation` | `get_escalations` |
| `audit_anomaly` | `get_audit_anomalies` |
| `node_factory_request` | `get_pending_node_factory_requests` |
| `agent_registered` | `get_recently_registered_agents` |
| `custom_rpc` | Custom RPC funkce |

**Filtry:** Status filter (story changes), Severity filter (escalations/anomalies)

### AishaLlmRouter — Centralized Multi-Provider LLM Sub-Node

Langchain-compatible AI Language Model sub-node — připojuje se k n8n Agent node jako `language model`. Implementuje transparent **provider failover**: pokud primary provider vrátí chybu kvóty/billingu/dostupnosti (429, 402, 503), automaticky přepne na další provider bez přerušení workflowu.

**Podporované providery:**

| Provider | Model | Kdy |
|----------|-------|-----|
| Google Gemini | `gemini-2.5-flash` (výchozí) | Auto routing, cost-optimized |
| OpenAI | `gpt-4o`, `gpt-4o-mini` | Explicitní nebo high-risk |
| Anthropic | `claude-3.5-sonnet` | Explicitní nebo quality-first |
| xAI / Grok | `grok-3-mini` | Pending model evaluation |

**Strategie routingu:** `auto`, `explicit`, `costOptimized`, `qualityFirst`

**Klíčový rozdíl od AishaModelRouter:** AishaLlmRouter je **AI sub-node** (vrací langchain model přes `supplyData()`), takže agent pokračuje se vzadu s modelem — není potřeba větvení workflowu. AishaModelRouter je Execute node se 4 výstupními větvemi.

**Credentials:** Na provideru:
- Google: `GEMINI_API_KEY` (env var) nebo credential
- OpenAI: `OPENAI_API_KEY` (env var) nebo credential
- Anthropic: `ANTHROPIC_API_KEY` (env var) nebo credential

### AishaAdminBridge — Autonomní Admin Interface

Poskytuje Aishe přímý přístup k interním admin systémům bez React UI:

| Systém | Skupiny operací |
|--------|----------------|
| **NocoDB** | `list_tables`, `list_rows`, `create_row`, `update_row`, `delete_row`, `list_views`, `aggregate` |
| **Langfuse** | `get_traces`, `get_sessions`, `create_score`, `get_metrics`, `get_observations` |
| **Forgejo** | `list_repos`, `get_file`, `create_pr`, `list_issues`, `create_issue`, `push_file` |

**Credentials:** `AishaNocoDbApi`, `AishaLangfuseApi`, `AishaForgejoApi` (separátní per systém)

**Použití:** Aisha vytváří záznamy v NocoDB pro reporty, čte Langfuse traces pro self-debugging, spravuje PR přes Forgejo při autonomním deploymentu.

### AishaNodeFactory — Self-Orchestration 🏭

Meta-node: Aisha generuje nové n8n community nody autonomně.

| Operace | Popis |
|---------|-------|
| `generate` | TypeScript kód z názvu + operací + RPC funkcí |
| `validate` | Kontrola struktury + security (eval, select *) |
| `test` | Generuje Vitest test suite |
| `deploy` | Instrukce pro npm pack + install |
| `register` | Registrace v agent_catalog přes RPC |
| `listNodes` | Seznam všech dostupných nodů (built-in + custom) |

---

## 🏭 Self-Orchestration Workflow

Workflow **WF_NODE_FACTORY** (`n8n/workflows/WF_NODE_FACTORY.json`):

```
                  ┌──────────────────┐
                  │  Cron (Mon 3:00) │
                  └────────┬─────────┘
                           │
┌──────────────────┐       │
│  Webhook POST    ├───────┤
│  /node-factory   │       │
└──────────────────┘       ▼
                  ┌──────────────────┐
                  │ Normalize Request│
                  └────────┬─────────┘
                           ▼
                  ┌──────────────────┐
                  │  Generate Code   │
                  └────────┬─────────┘
                           ▼
                  ┌──────────────────┐    ┌──────────────────┐
                  │  Validate Code   ├───►│ Validation Failed │
                  └────────┬─────────┘    └────────┬─────────┘
                           ▼                       │
                  ┌──────────────────┐             │
                  │  Generate Tests  │             │
                  └────────┬─────────┘             │
                           ▼                       │
                  ┌──────────────────┐             │
                  │ Register Catalog │             │
                  └────────┬─────────┘             │
                           ▼                       ▼
                  ┌──────────────────┐    ┌──────────────────┐
                  │   Audit Log      │◄───┤   Audit Log      │
                  └────────┬─────────┘    └──────────────────┘
                           ▼
                  ┌──────────────────┐
                  │    Summary       │
                  └──────────────────┘
```

### Webhook volání

```bash
curl -X POST https://n8n.aisha.guru/webhook/node-factory \
  -H "Content-Type: application/json" \
  -d '{
    "nodeName": "AishaMetrics",
    "description": "Platform metrics aggregation node",
    "operations": ["getDashboard", "getAgentMetrics", "getDeliveryStats"],
    "category": "analytics",
    "rpcFunctions": ["get_platform_metrics", "get_agent_stats", "get_delivery_stats"],
    "includeAudit": true
  }'
```

---

## 🧪 Testování

### Spuštění testů

```bash
cd packages/n8n-nodes-aisha

# Všechny testy (48+ test cases)
npm test

# Konkrétní node
npx vitest run __tests__/AishaRpc.test.ts

# Watch mode
npm run test:watch

# S coverage
npx vitest run --coverage
```

### Testovací architektura

- **Mock Factory** (`__tests__/helpers/mockFactory.ts`) — vytváří mock `IExecuteFunctions` a `IPollFunctions`
- **Fetch Mock** — `setupFetchMock()` nahrazuje `global.fetch` pro testování RPC volání
- **Žádné reálné HTTP** — všechny testy jsou unit testy bez network dependencies

### CI/CD

GitHub Actions workflow: `.github/workflows/test-community-nodes.yml`

Spouští se při push/PR na `packages/n8n-nodes-aisha/**`:
1. TypeScript compile check
2. Vitest test suite
3. Build + verify dist structure
4. Pack dry-run

---

## 📐 Vývoj nového nodu

### Manuální postup

```bash
# 1. Vytvoř adresář
mkdir nodes/AishaNovyNode

# 2. Zkopíruj icon
cp nodes/AishaRpc/aisha.svg nodes/AishaNovyNode/

# 3. Implementuj node
# Viz vzor v nodes/AishaRpc/AishaRpc.node.ts

# 4. Registruj v package.json → n8n.nodes[]
# "dist/nodes/AishaNovyNode/AishaNovyNode.node.js"

# 5. Vytvoř test
# __tests__/AishaNovyNode.test.ts

# 6. Test + Build
npm test && npm run build
```

### Automatický postup (Self-Orchestration)

Aisha Dirigent může vytvořit nový node přes WF_NODE_FACTORY:

1. **Dirigent agent** identifikuje potřebu nového nástroje
2. Odešle request na webhook `/node-factory`
3. WF_NODE_FACTORY vygeneruje kód, validuje, testuje
4. Registruje v `agent_catalog`
5. Vývojář reviewne PR, spustí testy, deployne

---

## 🔐 Bezpečnost

### Node kód

- **Žádné `eval()`** — validace v AishaNodeFactory
- **Žádné `.select("*")`** — explicitní sloupce vždy
- **Audit trail** — všechny operace logovány do `audit_journal`
- **continueOnFail** — všechny nody podporují graceful degradaci

### Credentials

- **Hesla** jsou `typeOptions.password: true` — nebude ani v logách ani v n8n expressions
- **Service Role Key** nikdy neopouští backend — jde jen do PostgREST headers
- **MCP Token** — scope-limited (session/project/account)

### Deploy

- Community nodes se instalují do n8n containeru přes npm
- Tarball se po instalaci smaže (`rm /tmp/*.tgz`)
- HUP signál restartuje n8n bez downtime

---

## 📊 Roadmap

### v0.2.0 (Plánováno)
- [ ] Migrace 31 toolCode nodů na AishaRpc nody
- [ ] Instance-level MCP Server aktivace
- [ ] AishaNodeFactory: auto-deploy (bez manuálního review pro low-risk)

### v0.3.0
- [ ] AishaMetrics node — platform analytics
- [ ] AishaNotifier node — multi-channel notifikace
- [ ] Native n8n toolMcp integrace místo toolCode

### v1.0.0
- [ ] Publish na npm registry
- [ ] n8n Community Nodes registry listing
- [ ] Full self-orchestration loop (bez human-in-the-loop pro safe operations)
