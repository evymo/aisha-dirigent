# Plugin System — Sandbox Architecture & Development Patterns

---

## Základní Princip

Pluginy jsou **sandboxované běhové prostředí** spravované AISHA platformou.
Partnerský/uživatelský vývoj probíhá **primárně uvnitř pluginů**.
AISHA poskytuje platformu, runtime a `SandboxContext` API.

**Plugin NIKDY nepřistupuje k infrastruktuře přímo** — veškerá interakce přes `SandboxContext`.

---

## 5 Druhů Pluginů

| Kind | Load Strategy | Module Interface |
|------|---------------|-----------------|
| `web_tracking` | HOT | `bootstrap()`, `ready()`, `dispose()` |
| `auth_provider` | COLD | `getProviderConfig()`, `handleCallback?()` |
| `backend_provider` | COLD | `createBackend()` |
| `automation_node` | HOT | `getNodeType()`, `execute()` |
| `full_stack` | HOT | `init(ctx)`, `handle(ctx, capability, payload)`, `dispose(ctx)` |

`full_stack` je primární development surface.

---

## SandboxContext API (injected by AISHA)

| API | Účel | Příklad |
|-----|------|---------|
| `ctx.rpc(fn, params)` | Whitelisted Supabase RPC proxy | `ctx.rpc("get_partner_stats", { p_partner_id: ctx.tenant.id })` |
| `ctx.kv.get/set/delete/list` | Plugin-scoped KV store | `ctx.kv.set("metrics:current", snapshot)` |
| `ctx.storage.get/put/delete/list` | MinIO object storage (namespaced) | `ctx.storage.put("report.pdf", data)` |
| `ctx.llm.chat(messages, opts?)` | LLM inference proxy | `ctx.llm.chat([{role: "user", content: "summarize"}])` |
| `ctx.llm.embed(text)` | Embedding generation | `ctx.llm.embed("hello world")` |
| `ctx.publish(topic, payload)` | Event bus publish | `ctx.publish("metrics.updated", snapshot)` |
| `ctx.subscribe(topic, handler)` | Event bus subscribe | `ctx.subscribe("order.created", handler)` |
| `ctx.notify(userId, payload)` | Platform notification | `ctx.notify(uid, { channel: "push", title: "Ready" })` |
| `ctx.schedule(cron, handler)` | Register cron task | `ctx.schedule("0 2 * * *", dailyRollup)` |
| `ctx.fetch(url, init?)` | Restricted outbound HTTP | `ctx.fetch("https://api.example.com/data")` |
| `ctx.log(level, msg, meta?)` | Structured logging (Langfuse) | `ctx.log("info", "Metrics refreshed", { date: today })` |

---

## Capability-Based Security

```json
{
  "capabilities": [
    "rpc.get_partner_stats",
    "http.GET./metrics",
    "http.POST./refresh",
    "cron.daily_rollup"
  ]
}
```

- `rpc.*` — každý RPC call se validuje proti capabilities
- `http.*` — route matching pro příchozí requesty
- `cron.*` — registrace scheduled tasks
- Network: outbound fetch jen na URL v `sandbox.network_allowlist`

---

## Manifest Contract

```json
{
  "id": "my-plugin",
  "version": "0.1.0",
  "kind": "full_stack",
  "trust_tier": "internal",
  "capabilities": ["rpc.my_function", "http.GET./status"],
  "config_schema": {
    "api_key": { "type": "string", "required": true }
  },
  "lifecycle": {
    "backend_entry": "src/index.ts",
    "load_strategy": "hot"
  },
  "sandbox": {
    "timeout_ms": 10000,
    "network_allowlist": ["*.example.com"],
    "max_memory_mb": 64
  }
}
```

Schema: `schemas/plugin-manifest.schema.json`
Zod: `src/lib/schemas/pluginSchemas.ts`

---

## Plugin Development Pattern (full_stack)

```typescript
// plugins/my-plugin/src/index.ts

export async function init(ctx) {
  ctx.log("info", "Plugin initialized", { version: ctx.plugin.version });
  ctx.schedule("0 */6 * * *", async () => {
    // Periodic task
  });
}

export async function handle(ctx, capability, payload) {
  switch (capability) {
    case "http.GET./status":
      return { status: "ok", plugin: ctx.plugin.id };
    case "http.POST./process":
      const result = await ctx.rpc("process_data", payload);
      await ctx.kv.set("last_result", result);
      return { processed: true };
    default:
      return { error: "Unknown capability" };
  }
}

export async function dispose(ctx) {
  ctx.log("info", "Plugin disposing");
}
```

---

## Trust Tiers

| Tier | Vývoj | Sandbox omezení | Schválení |
|------|-------|-----------------|-----------|
| `internal` | AISHA tým | Minimální | Auto-approve |
| `partner` | Partner | Network allowlist, rate limit | Staff review |
| `external` | Třetí strana | Strict (memory, timeout, network) | Admin review + pen test |

---

## Database (8 tabulek, 7 RPC)

**Tabulky:**
- `plugin_catalog` — registry (slug, kind, status, capabilities, sandbox_policy)
- `plugin_versions` — verze (artifact_sha256, artifact_url, changelog)
- `plugin_tenant_overrides` — per-tenant config + enable/disable
- `plugin_health_events` — health monitoring (load, invoke, error, timeout)
- `plugin_audit_events` — audit log (submission, transitions)
- `plugin_transition_rules` — state machine (15 přechodů s role requirements)
- `plugin_kv` — sandbox KV store (UNIQUE: plugin_id + tenant_id + key)
- `plugin_schedules` — cron tasks (UNIQUE: plugin_id + tenant_id + handler)

**RPC:**
- `get_available_plugins(p_kind, p_tenant_id)` — katalog pluginů; konfiguraci (přihlašovací údaje) nevydává nikomu
- `submit_plugin(p_manifest, p_artifact_sha256, p_artifact_url)` — submission
- `transition_plugin_status(p_plugin_id, p_new_status)` — state machine
- `register_plugin_event(...)` — health event recording
- `get_plugin_health_summary(p_plugin_id, p_hours)` — aggregace (error rate, P95)
- `sandbox_kv_op(p_op, p_key, ...)` — KV CRUD
- `register_plugin_schedule(...)` — cron registration

---

## CLI Workflow

```bash
# 1. Scaffold
aisha-plugin scaffold my-plugin --kind full_stack

# 2. Develop
# Edit plugins/my-plugin/src/index.ts

# 3. Submit
aisha-plugin submit ./plugins/my-plugin

# 4. Monitor
aisha-plugin status --plugin-id my-plugin

# 5. List available
aisha-plugin list --kind full_stack
```

---

## Edge Functions

| Function | Endpoint | Účel |
|---------|----------|------|
| `plugin-host` | POST `/functions/v1/plugin-host` | Sandbox runtime — resolve, validate, execute, audit |
| `plugin-registry` | GET `/functions/v1/plugin-registry` | Plugin discovery (list available plugins) |

**plugin-host flow:**
Auth → resolvePlugin → validateCapability → createSandboxContext → downloadArtifact → verifySHA256 → execute(timeout) → auditEvent → response

---

## Pravidla pro Plugin Development

1. **SandboxContext only** — plugin NIKDY nepřistupuje k Supabase, MinIO nebo jinému infra přímo
2. **Capabilities deklarace** — každý RPC/HTTP/cron musí být v manifest.capabilities
3. **Timeout** — plugin MUSÍ dokončit operaci v `sandbox.timeout_ms`
4. **No PII in logs** — `ctx.log()` jde do Langfuse, žádné citlivé údaje
5. **Idempotentní handle()** — musí být safe pro retry
6. **Config through manifest** — plugin config přes `config_schema`, ne hardcoded
7. **Defensive coding** — handle null/undefined z `ctx.rpc()` a `ctx.kv.get()`

---

## Soubory

| Soubor | Účel |
|--------|------|
| `schemas/plugin-manifest.schema.json` | JSON Schema manifest contract |
| `src/lib/schemas/pluginSchemas.ts` | Zod runtime validation |
| `supabase/functions/_shared/providers/plugin-types.ts` | TypeScript interfaces |
| `supabase/functions/plugin-host/index.ts` | Sandbox runtime |
| `supabase/functions/plugin-registry/index.ts` | Discovery API |
| `bin/evymo-plugin` | CLI wrapper |
| `plugins/partner-metrics/` | Reference full_stack plugin |
| `docs/PLUGIN_SYSTEM.md` | Architecture & developer guide |
