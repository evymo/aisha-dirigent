# AISHA Plugin System — Architecture & Developer Guide

> **Verze:** 1.0 | **Datum:** 18. dubna 2026
> **Status:** Phase 1 Complete (DB + Types + Sandbox Runtime + CLI + Reference Plugin)
> **Fingerprint:** Sandbox-first architecture — plugins as primary development surface

---

## Mentální Model

```
┌─────────────────────────────────────────────────────┐
│              AISHA PLATFORM (host)                  │
├─────────────────────────────────────────────────────┤
│  ┌────────────┐  ┌────────────┐  ┌────────────┐    │
│  │  Plugin A   │  │  Plugin B   │  │  Plugin C   │  │
│  │ (full_stack)│  │ (web_track) │  │ (auth_prov) │  │
│  │             │  │             │  │             │  │
│  │ ctx.rpc()   │  │ bootstrap() │  │ getProvider │  │
│  │ ctx.kv      │  │ ready()     │  │ Callback()  │  │
│  │ ctx.llm     │  │ dispose()   │  │             │  │
│  │ ctx.fetch   │  │             │  │             │  │
│  └─────┬───────┘  └─────┬───────┘  └──────┬──────┘  │
│        │                │                  │         │
│  ┌─────▼────────────────▼──────────────────▼───────┐ │
│  │           SandboxContext (injected by AISHA)     │ │
│  │  RPC proxy │ KV store │ LLM │ Storage │ Events  │ │
│  └─────────────────────┬───────────────────────────┘ │
│                        │                             │
│  ┌─────────────────────▼───────────────────────────┐ │
│  │  plugin-host (Deno edge function — sandbox RT)  │ │
│  │  Capability validation │ SHA256 verify │ Timeout │ │
│  └─────────────────────┬───────────────────────────┘ │
│                        │                             │
│  ┌─────────────────────▼───────────────────────────┐ │
│  │  PostgreSQL │ MinIO │ AI Router │ Langfuse       │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**Klíčový princip:** Pluginy NIKDY nepřistupují k infrastruktuře přímo.
Veškerá interakce probíhá přes `SandboxContext`, který AISHA injektuje do runtime.

---

## 5 Druhů Pluginů

| Kind | Purpose | Load Strategy | Module Interface |
|------|---------|---------------|-----------------|
| `web_tracking` | Browser-side tracking, analytics, A/B testy | HOT (lazy) | `bootstrap()`, `ready()`, `dispose()` |
| `auth_provider` | OAuth/OIDC provider pro GoTrue/Keycloak | COLD (blocking) | `getProviderConfig()`, `handleCallback?()` |
| `backend_provider` | Nový LLM backend (extends InferenceBackend) | COLD (blocking) | `createBackend()` |
| `automation_node` | n8n custom node registration | HOT (lazy) | `getNodeType()`, `execute()` |
| `full_stack` | **General-purpose sandbox app** — routes, UI, backend, data | HOT (on-demand) | `init(ctx)`, `handle(ctx, cap, payload)`, `dispose(ctx)` |

**`full_stack`** je primární development surface pro partnery a uživatele.

---

## SandboxContext API

```typescript
interface SandboxContext {
  // Identity (read-only)
  plugin: { id, version, kind, trustTier }
  tenant: { id, name }
  config: Record<string, unknown>  // get_plugin_runtime_config: výchozí (schéma) → zdroj → dešifrovaná pověření → přepis tenanta; shim ji vyzvedne přes broker /sandbox/config na token běhu, NIKDY z ENV

  // Core Data — RPC proxy (whitelisted by capabilities)
  rpc(functionName: string, params): Promise<unknown>

  // Key-Value Store (namespaced per plugin + tenant)
  kv: {
    get(key): Promise<unknown | null>
    set(key, value): Promise<void>
    delete(key): Promise<void>
    list(prefix?): Promise<string[]>
  }

  // Object Storage (MinIO proxy, namespaced per plugin)
  storage: {
    get(key): Promise<Uint8Array | null>
    put(key, data, contentType?): Promise<void>
    delete(key): Promise<void>
    list(prefix?): Promise<string[]>
  }

  // Event Bus
  publish(topic, payload): Promise<void>
  subscribe(topic, handler): void

  // LLM Inference (routed through AISHA backend providers)
  llm: {
    chat(messages: SandboxChatMessage[], options?): Promise<string>
    embed(text): Promise<number[]>
  }

  // Notifications
  notify(userId, payload: { channel, title, body, metadata? }): Promise<void>

  // Scheduled Tasks (cron) — DEKLARACE v init(), ne časovač (kontejner je jednorázový).
  // `capability` = `cron.*` z manifestu; host ji v cronu spustí přes handle(ctx, capability).
  // Cron: pět polí (`*`, `*/n`, `a-b`, `a,b`), pásmo procesu hostu (dnes UTC).
  schedule(cronExpr, capability): void

  // HTTP (restricted to manifest.sandbox.network_allowlist)
  fetch(url, init?): Promise<Response>

  // Logging (safe, no PII — routed to Langfuse)
  log(level: "debug"|"info"|"warn"|"error", message, metadata?): void
}
```

---

## Lifecycle (State Machine)

```
submitted ──→ reviewing ──→ sandbox_testing ──→ approved ──→ canary ──→ ga
    │              │              │                              │       │
    └── disabled ◄─┘              └─── disabled ◄───────────────┘       │
         │                                                              │
         └── reviewing ◄─────────────────────── disabled ◄──────────────┘
                                                    │
                                                    └── archived ──→ reviewing
```

Přechody jsou vynucovány tabulkou `plugin_transition_rules` s role requirements.

---

## Database Schema

### Tabulky (8)

| Tabulka | Purpose |
|---------|---------|
| `plugin_catalog` | Registry pluginů (slug, kind, trust_tier, status, capabilities, config, sandbox_policy) |
| `plugin_versions` | Verzování (artifact_sha256, artifact_url, changelog, reviewed_by) |
| `plugin_tenant_overrides` | Per-tenant config override + enable/disable |
| `plugin_health_events` | Health monitoring (load, invoke, error, timeout, rollback, patch) |
| `plugin_audit_events` | Audit log (PLUGIN_SUBMITTED, STATUS_TRANSITION, etc.) |
| `plugin_transition_rules` | State machine (from_status → to_status, requires_role) — 15 entries |
| `plugin_kv` | Sandbox KV store (UNIQUE per plugin_id + tenant_id + key) |
| `plugin_schedules` | Cron tasks (UNIQUE per plugin_id + tenant_id + handler_capability) |

### RPC Funkce (7)

| Function | Purpose | Access |
|----------|---------|--------|
| `get_available_plugins(p_kind, p_tenant_id)` | Plugin catalog (canary/ga); `p_tenant_id` (tenant itself, admin/staff, service_role) hides disabled plugins. Never returns plugin config | anon, authenticated, service_role |
| `submit_plugin(p_manifest, p_artifact_sha256, p_artifact_url)` | Submit new plugin/version | authenticated (admin/staff) |
| `transition_plugin_status(p_plugin_id, p_new_status, p_metadata)` | State machine transition | authenticated |
| `register_plugin_event(p_plugin_id, p_tenant_id, p_event_kind, ...)` | Record health event | anon, authenticated |
| `get_plugin_health_summary(p_plugin_id, p_hours)` | Health aggregation (error rate, P95 latency) | admin/staff |
| `sandbox_kv_op(p_op, p_key, p_plugin_id, p_tenant_id, ...)` | KV store CRUD | authenticated |
| `register_plugin_schedule(p_plugin_id, p_tenant_id, p_handler_capability, p_cron_expr)` | Ruční registrace rozvrhu | service_role, admin/staff |
| `reconcile_plugin_schedules(p_plugin_slug, p_tenant_id, p_declarations)` | Zápis deklarací z init() po běhu (validace proti manifestu, vypnutí nedeklarovaných) | service_role |
| `claim_due_plugin_schedules(p_limit, p_lease_seconds)` | Plánovač atomicky zabere splatné rozvrhy (SKIP LOCKED + pronájem) | service_role |
| `set_plugin_schedule_next_run(p_schedule_id, p_next_run_at)` | Příští termín po běhu | service_role |
| `get_plugin_runtime_config(p_plugin_slug, p_tenant_id)` | Konfigurace běhu pluginu včetně dešifrovaných pověření zdroje (broker /sandbox/config) | service_role |

---

## Edge Functions

### plugin-host (Sandbox Runtime)

**Endpoint:** `POST /functions/v1/plugin-host`

**Request:**
```json
{
  "plugin_id": "partner-metrics",
  "tenant_id": "uuid",
  "capability": "http.GET./metrics",
  "payload": {}
}
```

**Flow:**
1. Auth (Bearer token)
2. `resolvePlugin()` — call `get_available_plugins` RPC, find by slug
3. Validate capability against manifest whitelist
4. `createSandboxContext()` — build full API surface
5. `executePlugin()` — download artifact, verify SHA256, dynamic import
6. Execute `init()` → `handle(ctx, capability, payload)` with timeout
7. Log health event via `register_plugin_event`
8. Return response

**Security:**
- Capability whitelisting (per-function RPC validation)
- Network allowlist (outbound fetch restricted)
- SHA256 artifact verification
- Timeout enforcement (Promise.race)
- Every operation audited

### plugin-registry (Discovery)

**Endpoint:** `GET /functions/v1/plugin-registry?kind=full_stack&tenant_id=uuid`

Returns list of available plugins with merged tenant config.

---

## CLI

```bash
# Scaffold new plugin
aisha-plugin scaffold my-plugin --kind full_stack

# Submit to AISHA
aisha-plugin submit ./plugins/my-plugin

# Check status
aisha-plugin status --plugin-id my-plugin

# List available plugins
aisha-plugin list --kind full_stack
```

---

## File Layout

```
schemas/
  plugin-manifest.schema.json       # JSON Schema contract

src/lib/schemas/
  pluginSchemas.ts                  # Zod runtime validation (21 exports)

packages/llm-dispatch/src/providers/
  plugin-types.ts                   # TypeScript interfaces (SandboxContext, modules)

aisha/db/                           # data plane SoT (baseline-only: no delta migrations)
  sql/tables/plugin_*.sql           # catalog, versions, overrides, kv, schedules, health, audit
  migrations/00000000000000_baseline.sql   # generated from sql/ — never hand-edited
  heals.sql                         # idempotent reconcile for already-initialized DBs

aisha/db/sql/functions/
  get_available_plugins.sql         # Plugin catalog (no config — vendor credentials)
  submit_plugin.sql                 # Plugin submission
  transition_plugin_status.sql      # State machine
  register_plugin_event.sql         # Health events
  get_plugin_health_summary.sql     # Health aggregation
  sandbox_kv_op.sql                 # KV store CRUD
  register_plugin_schedule.sql      # Cron registration

services/svc-plugin-system/src/
  sandbox.ts                        # Sandbox runtime (fail-closed, https-only fetch)
  routes/                           # Discovery + submission API

bin/
  aisha-plugin                      # CLI wrapper

scripts/dirigent/
  workflows.mjs                     # runPluginWorkflow (scaffold/submit/status/list)

plugins/
  partner-metrics/                  # Reference full_stack plugin
    manifest.json
    src/index.ts
    README.md
```

---

## Trust Tiers & Sandbox Rules

| Trust Tier | Plugins | Sandbox Restrictions | Approval |
|-----------|---------|---------------------|----------|
| `internal` | AISHA-developed | Minimal restrictions | Auto-approve |
| `partner` | Partner-developed | Network allowlist enforced, rate limited | Staff review gate |
| `external` | Third-party | Strict sandbox (memory, timeout, network) | Admin review + pen test |

| Sandbox Rule | Enforcement |
|-------------|-------------|
| RPC calls | Whitelist per `manifest.capabilities` (`rpc.*` entries) |
| Network | Restricted to `manifest.sandbox.network_allowlist` |
| Timeout | `manifest.sandbox.timeout_ms` (100–30,000ms) |
| Memory | `manifest.sandbox.max_memory_mb` (8–256MB) |
| Cron frequency | Trust tier dependent (external: min 15m) |

---

## Known Limitations (Phase 1)

| Area | Status | Description |
|------|--------|-------------|
| Artifact upload | TODO | `aisha-plugin submit` validates manifest but MinIO upload not wired |
| Schedule cancel | Deklarativní | rozvrh, který plugin v init() přestane deklarovat, host při dalším běhu vypne (reconcile) |
| Schedule bootstrap | Prvním během | rozvrhy tenanta vzniknou po prvním úspěšném běhu pluginu (init deklaruje); plánovač pak běží sám (svc-plugin-system, tik 60 s) |
| LLM model selection | Hardcoded | `llm.chat()` routes through single ai-router, no per-plugin model config |
| Web plugin loading | Not wired | `web_tracking` plugins not integrated into frontend React app |
| n8n integration | Not wired | `automation_node` plugins not registered with n8n runtime |
