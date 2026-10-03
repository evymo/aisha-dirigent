# Aisha Admin Integration — NocoDB + Langfuse

> **Verze:** 2.0 | **Datum:** 2025-06

Aisha Dirigent je **maximálně integrovaná pro autonomní řízení** s funkčním dohledem expertního člověka. Architektura kombinuje:
- **Autonomní operace** — self-healing health monitor, automatické recovery, performance review
- **Lidský dohled** — expert notification, approval gates, severity-based eskalace
- **Closed-loop feedback** — Langfuse anomálie → Dirigent → akce → audit trail → NocoDB report

---

## Architektura

```
┌───────────────┐     ┌────────────────┐     ┌──────────────────┐
│  MCP Client   │────▶│  MCP Knowledge │────▶│  Supabase DB     │
│  (VS Code,    │     │  Server v2.2   │     │  (integration_   │
│   Claude,     │     │  35 tools      │     │   services)      │
│   n8n)        │     └──────┬─────────┘     └──────────────────┘
└───────────────┘            │
                             │ admin_* tools
                    ┌────────▼─────────┐
                    │   NocoDB         │◀─── Supabase PG Tables
                    │   REST API       │     (spreadsheet view)
                    └──────────────────┘
                    ┌──────────────────┐
                    │   Langfuse       │◀─── LLM Traces, Scores
                    │   REST API       │     (observability)
                    └──────────────────┘
```

### Komponenty

| Komponenta | Popis | Umístění |
|------------|-------|----------|
| **AishaAdminBridge** | n8n community node pro NocoDB + Langfuse + Health | `packages/n8n-nodes-aisha/nodes/AishaAdminBridge/` |
| **MCP Admin Tools** | 6 nových MCP nástrojů pro přímý přístup | `supabase/functions/mcp-knowledge-server/index.ts` |
| **Integration Services DB** | Registr + logy integračních služeb | `supabase/migrations/20260305160000_integration_services.sql` |
| **WF Health Monitor** | Self-healing health check s circuit breakerem | `n8n/workflows/WF_ADMIN_HEALTH_MONITOR.json` |
| **WF Admin Orchestration** | Webhook API pro admin operace | `n8n/workflows/WF_ADMIN_ORCHESTRATION.json` |
| **WF Expert Notification** | Multi-channel notifikace pro expertní dohled | `n8n/workflows/WF_EXPERT_NOTIFICATION.json` |
| **WF Approval Gate** | Human-in-the-loop schvalovací workflow | `n8n/workflows/WF_APPROVAL_GATE.json` |
| **WF Langfuse Performance** | Denní AI performance review + anomaly detection | `n8n/workflows/WF_LANGFUSE_PERFORMANCE_REVIEW.json` |
| **Docker Compose** | Kontejnerizace NocoDB + Langfuse | `docker-compose.local.yml`, `docker-compose.coolify.yml` |

---

## Autonomní řízení — Přehled

### Uzavřená smyčka (Closed-Loop)

```
┌──────────────┐    cron 5min   ┌──────────────────────┐
│ Health       │───────────────▶│ Self-Healing Logic    │
│ Monitor      │                │ (circuit breaker:     │
│ (15 nodes)   │                │  max 3 attempts/h)    │
└──────────────┘                └──────────┬───────────┘
                                           │
                              ┌────────────┼────────────┐
                              ▼            ▼            ▼
                         recovery    notify         escalate
                         attempt     Dirigent       to Expert
                              │            │            │
                              ▼            ▼            ▼
                         Log         Autonomous    WF_EXPERT_
                         Recovery    Triage        NOTIFICATION
```

```
┌──────────────┐    cron 3 AM   ┌──────────────────────┐
│ Langfuse     │───────────────▶│ Analyze Performance   │
│ Performance  │                │ (latency, cost,       │
│ Review       │                │  scores, errors)      │
│ (10 nodes)   │                └──────────┬───────────┘
└──────────────┘                           │
                              ┌────────────┼────────────┐
                              ▼            ▼            ▼
                         NocoDB       Dirigent      Expert
                         Report       (anomaly)     (critical)
```

### Severity → Channel Mapping

| Severity | Akce | Kanál |
|----------|------|-------|
| **LOW** | Log only, digest queue | Audit trail |
| **MEDIUM** | Log + email digest | Audit + sběrný email |
| **HIGH** | Dirigent triage + immediate email | Webhook + email |
| **CRITICAL** | Dirigent + email + webhook callback | Vše + Slack/webhook |

### Approval Gate Flow

```
Dirigent potřebuje schválení (DELETE, CRITICAL akce)
    │
    ▼
POST /approval-gate
    │
    ├── Generuje approval_id + approve/reject links
    ├── Notifikuje experta (WF_EXPERT_NOTIFICATION)
    └── Vrací approval_id volajícímu
    
Expert klikne na link
    │
    ▼
GET /approval-response?id=X&decision=approved
    │
    ├── Validuje + loguje rozhodnutí
    ├── Posílá decision zpět do Dirigenta (webhook)
    └── Vrací HTML stránku (✅ Schváleno / ❌ Zamítnuto)
```

---

## MCP Nástroje (Admin Bridge)

6 nových nástrojů přidaných do MCP Knowledge Server v2.2.0:

| Nástroj | Popis | RPC funkce |
|---------|-------|------------|
| `admin_list_services` | Seznam registrovaných integračních služeb | `list_integration_services` |
| `admin_health_check` | Health check jedné nebo všech služeb | `list_integration_services`, `update_integration_health` |
| `admin_nocodb_query` | Dotaz na záznamy z NocoDB tabulky | `list_integration_services` |
| `admin_nocodb_manage` | CRUD operace na NocoDB záznamech | `list_integration_services`, `log_integration_action` |
| `admin_langfuse_traces` | Dotaz na LLM traces/sessions/generations | `list_integration_services` |
| `admin_log_action` | Zápis admin akce do audit logu | `log_integration_action` |

### Příklady použití

```json
// Seznam všech služeb
{ "method": "tools/call", "params": { "name": "admin_list_services" } }

// Health check konkrétní služby
{ "method": "tools/call", "params": {
  "name": "admin_health_check",
  "arguments": { "service_name": "nocodb" }
}}

// Dotaz na NocoDB tabulku
{ "method": "tools/call", "params": {
  "name": "admin_nocodb_query",
  "arguments": {
    "table_name": "users_admin_view",
    "where": "(Status,eq,active)",
    "limit": 10
  }
}}

// Posledních 20 LLM traces
{ "method": "tools/call", "params": {
  "name": "admin_langfuse_traces",
  "arguments": { "type": "traces", "limit": 20 }
}}
```

---

## n8n Node — AishaAdminBridge

### Architektura

Node používá **standalone function pattern** (ne private methods) kvůli n8n runtime rebinding `this`:

```typescript
// ✅ SPRÁVNĚ — standalone funkce
async function executeNocoDBOps(ctx: IExecuteFunctions, ...): Promise<...> { }

// ❌ ŠPATNĚ — private method (this je rebound n8n runtime)
private async executeNocoDB(this: IExecuteFunctions, ...): Promise<...> { }
```

### Operace

**NocoDB** (8 operací):
- `list_tables` — seznam NocoDB tabulek
- `get_schema` — schéma tabulky
- `list_records` — záznamy s filtrováním
- `create_record` — vytvoření záznamu
- `update_record` — aktualizace záznamu
- `delete_record` — smazání záznamu
- `create_view` — vytvoření pohledu
- `run_formula` — spuštění NocoDB formule

**Langfuse** (6 operací):
- `get_traces` — LLM traces
- `get_sessions` — sessions
- `get_metrics` — agregované metriky
- `create_score` — přidání hodnocení
- `get_generations` — generace s tokeny
- `get_datasets` — datasety pro evaluaci

**Health** (2 operace):
- `check_all` — zdraví všech služeb
- `check_one` — zdraví konkrétní služby

### Credentials

| Credential | Typ | Pole |
|------------|-----|------|
| `evymoNocoDbApi` | NocoDB | `baseUrl`, `apiToken` |
| `evymoLangfuseApi` | Langfuse | `host`, `publicKey`, `secretKey` |
| `evymoSupabaseApi` | Supabase | `supabaseUrl`, `serviceRoleKey` |

---

## Databáze

### Tabulky

**`integration_services`** — Registr integračních služeb:
- `service_name` (unique) — identifikátor (nocodb, langfuse, n8n)
- `service_type` — admin_bridge, observability, automation, analytics, messaging
- `base_url` — endpoint URL
- `health_status` — healthy, degraded, down, unknown
- `managed_by` — aisha, manual
- RLS: admin/staff only

**`integration_service_logs`** — Audit log operací:
- `service_id` → `integration_services`
- `action` — typ akce
- `action_detail` — JSONB detail
- `status` — success, failure, partial
- RLS: admin/staff only

### RPC Funkce

| Funkce | Popis | Security |
|--------|-------|----------|
| `upsert_integration_service` | Upsert služby | DEFINER, admin/staff |
| `list_integration_services` | Seznam služeb s filtry | DEFINER, admin/staff |
| `update_integration_health` | Aktualizace health statusu | DEFINER, admin/staff |
| `log_integration_action` | Zápis do audit logu | DEFINER, admin/staff |

### Seed Data

```sql
INSERT INTO integration_services (service_name, display_name, service_type, base_url)
VALUES
  ('nocodb', 'NocoDB', 'admin_bridge', 'https://nocodb.aisha.guru'),
  ('langfuse', 'Langfuse', 'observability', 'https://langfuse.aisha.guru'),
  ('n8n', 'n8n Workflow Engine', 'automation', 'https://n8n.aisha.guru');
```

---

## Workflows

### WF_DIRIGENT_AGENT (vylepšený)

- **Nodes**: 30 (z původních 22)
- **Nové admin MCP tools**: 6 (admin_list_services, admin_health_check, admin_nocodb_query, admin_nocodb_manage, admin_langfuse_traces, admin_log_action)
- **Nové workflow tools**: 2 (notify_expert → WF_EXPERT_NOTIFICATION, request_approval → WF_APPROVAL_GATE)
- **System prompt**: Rozšířen o §7 (Infrastruktura & Admin Bridge), §8 (Eskalace & Notifikace), §9 (Bezpečnostní invarianty)
- **Max iterations**: 15 (z 12)
- **Playbooks**: Admin Health Alert, Performance Review, Approval Gate Response

### WF_ADMIN_HEALTH_MONITOR (self-healing)

- **Trigger**: Cron každých 5 minut
- **Nodes**: 15 (z původních 8)
- **Flow**: Health check → Parse → If degraded? → Self-Healing Logic → Recovery/Escalation
- **Self-Healing**: Circuit breaker (max 3 pokusy/h/službu), automatický recovery attempt
- **Escalation path**: Po vyčerpání pokusů → WF_EXPERT_NOTIFICATION (CRITICAL)
- **Notifikace Dirigenta**: Každý health alert → webhook do Dirigenta pro autonomní triage
- **ID**: `AdminHealthMonitor001`

### WF_EXPERT_NOTIFICATION

- **Trigger**: POST webhook `/expert-notification`
- **Nodes**: 13
- **Severity routing**: LOW → log only, MEDIUM → email digest, HIGH → immediate email, CRITICAL → email + webhook callback
- **Email delivery**: Supabase edge function `send-notification-email`
- **Audit trail**: Každá notifikace logována přes `log_integration_action`
- **ID**: `ExpertNotification001`

### WF_APPROVAL_GATE

- **Trigger**: Dual webhook — POST `/approval-gate` (request) + GET `/approval-response` (expert odpověď)
- **Nodes**: 16
- **Flow**: Request → Generate approval_id + links → Notify expert → Wait for response
- **Response**: Expert klikne approve/reject → HTML stránka → webhook zpět do Dirigenta
- **Timeout**: Konfigurovatelný (default 4h), po expiraci auto-eskalace
- **ID**: `ApprovalGate001`

### WF_LANGFUSE_PERFORMANCE_REVIEW

- **Trigger**: Cron denně v 3:00 AM (Europe/Prague)
- **Nodes**: 10
- **Flow**: Fetch traces → Analyze (latency, cost, scores, errors) → Store in NocoDB → Route by anomaly
- **Thresholds**: Latency > 10s, Cost > $0.50/trace, Score < 50%, Error count
- **Severity**: ≥5 errors OR ≥10 high-latency = CRITICAL, ≥2 OR ≥5 = HIGH, ≥3 anomalies = MEDIUM
- **Output**: Report v NocoDB + Dirigent notification (anomaly) + Expert escalation (critical)
- **ID**: `LangfusePerformance001`

### WF_ADMIN_ORCHESTRATION

- **Trigger**: POST webhook `/admin-bridge`
- **Flow**: Validate → Route (nocodb/langfuse/health) → Execute → Log → Respond
- **Nodes**: 11
- **ID**: `AdminOrchestration001`
- **MCP**: `availableInMCP: true`

**Request format:**
```json
POST /webhook/admin-bridge
{
  "service": "nocodb",
  "operation": "list_tables",
  "params": {}
}
```

---

## Docker Setup

### Lokální vývoj

```bash
# Spuštění admin služeb
docker compose -f docker-compose.local.yml --profile admin up -d

# NocoDB:   http://localhost:8080
# Langfuse: http://localhost:3100
```

### Produkce (Coolify)

NocoDB a Langfuse se deployují jako součást `docker-compose.coolify.yml`:

| Služba | URL | Traefik label |
|--------|-----|---------------|
| NocoDB | `https://nocodb.aisha.guru` | `nocodb.aisha.guru` |
| Langfuse | `https://langfuse.aisha.guru` | `langfuse.aisha.guru` |

Obě služby sdílí Supabase PostgreSQL s oddělenými schématy.

---

## Testování

```bash
# AishaAdminBridge unit testy (26 testů)
cd packages/n8n-nodes-aisha
npx vitest run __tests__/AishaAdminBridge.test.ts

# MCP contract testy (76 testů — includiing 6 admin tools)
npx vitest run src/tests/mcp/mcp-tool-contract.test.ts

# Celý MCP suite (90 testů)
npx vitest run src/tests/mcp/

# Integrační pipeline (includes admin bridge checks)
npm run aisha:integration
```

### Test Coverage

| Oblast | Testy | Status |
|--------|-------|--------|
| AishaAdminBridge node | 26 | ✅ PASS |
| MCP tool contract (35 tools) | 82 | ✅ PASS |
| MCP protocol | 14 | ✅ PASS |
| Community nodes (full suite) | 96 | ✅ PASS |
| Integration pipeline Step 6 | 11 sub-checks | ✅ |
| Integration pipeline Step 7 | 12 sub-checks | ✅ |
| Workflow JSON validation | 15 files | ✅ |

---

## Environment Variables

### Nové pro deep integration

| Proměnná | Popis | Příklad |
|----------|-------|---------|
| `WF_EXPERT_NOTIFICATION_ID` | ID notifikačního workflow v n8n | `ExpertNotification001` |
| `WF_APPROVAL_GATE_ID` | ID approval gate workflow v n8n | `ApprovalGate001` |
| `EXPERT_EMAIL` | Email expertního člověka pro notifikace | `dirigent@aisha.guru` |
| `EXPERT_WEBHOOK_URL` | Webhook URL pro CRITICAL eskalace | `https://hooks.slack.com/...` |
| `N8N_URL` | Base URL n8n instance | `https://n8n.aisha.guru` |

---

## Plán nasazení

1. **Migrace na lokální DB**: `npm run db:migrate:local` (aplikuje #83)
2. **Typy**: `npm run db:types:gen:local`
3. **Deploy Docker**: `docker compose -f docker-compose.coolify.yml up -d`
4. **Importuj n8n workflows**: Upload `WF_ADMIN_HEALTH_MONITOR.json` + `WF_ADMIN_ORCHESTRATION.json`
5. **Aktivuj credentials**: V n8n nastav NocoDB + Langfuse credentials
6. **Ověř health**: `admin_health_check` přes MCP nebo n8n webhook

---

## Bezpečnost

- **RLS**: Všechny tabulky mají RLS — přístup jen admin/staff
- **SECURITY DEFINER**: Všechny RPC funkce s `SET search_path`
- **Audit trail**: Každá admin operace logována do `integration_service_logs`
- **Token management**: API tokeny v `integration_services.api_token` (encrypted at rest v PG)
- **Health monitoring**: Automatické degradace/down detekce s alertingem
