---
name: aisha-tool-registry
description: Tool Registry + Tool Executor pro AISHA agenty (Roadmap Fáze 2, WP-06) — registrace toolu v agent_tools tabulce, executor v svc-ai-chat, iterativní tool loop ve workflowEngine, channel-centric allowed_tools. Use when adding a new agent tool, wiring function calling into a chat route, or debugging tool dispatch. Triggers on "tool registry", "tool executor", "tool call", "agent tools", "nový tool", "function calling", "tool loop", "agent_tools", "toolExecutor", "allowed_tools".
---

# AISHA Tool Registry & Executor Skill

Tool systém = **Roadmap Fáze 2** (`docs/AI_AGENT_ROADMAP.md` §2.1–2.4). Agenti nevolají jen text — LLM dostane OpenAI-compatible tool specs a executor bezpečně dispatchne každý `tool_call` na RPC nebo webhook. **Většina Fáze 2 už JE implementovaná** — registry tabulka, executor, tool loop i první vlna 6 toolů existují v repu.

> ⚠️ **Rozpor s DELEGATION_PLANem:** `docs/planning/DELEGATION_PLAN.md` §5 definuje WP-06 jako „Tool Registry v DB + Tool Executor (první vlna toolů)" — tedy celou Roadmap F2. Ta už je ale v repu implementovaná, takže řádek plánu je zastaralý. **Navrhovaný zbývající scope WP-06** (viz stavová tabulka níže): admin UI, list RPC a migrace deprecated `edge_function` toolů. Tento skill scope work-package NEpředefinovává — korekce se musí před vytvořením zadání `WP-06-*.md` propsat do plánu přes ground-truth revizi (DELEGATION_PLAN §2 bod 2, human-in-the-loop approval gate).

Tento skill dokumentuje **kde co žije**, jak zaregistrovat nový tool end-to-end a co je jen plán vs. realita.

## Kdy to platí

| Scénář | Použij tento skill |
|---|---|
| Registrace nového toolu do `agent_tools` (seed / admin RPC) | **Ano** |
| Zpřístupnění toolu kanálu/agentovi (`allowed_tools`) | **Ano** |
| Debug tool dispatch (tier, consent, audit, timeout) | **Ano** |
| Ladění tool loop (`max_tool_iterations`, followup calls) | **Ano** |
| Nová Fastify route jako webhook handler toolu | **Ne** — viz `aisha-edge-fn` skill |
| Nová RPC funkce jako handler toolu (SECURITY DEFINER + audit) | **Ne** — viz `aisha-rpc` skill |
| Nová tabulka / změna schématu `agent_tools` | **Ne** — viz `aisha-migration` skill (SoT pairing) |
| n8n workflow volající tooly | **Ne** — viz `aisha-n8n-workflow` skill |

## Stav: co existuje vs. co vznikne ve WP-06

| Vrstva (Roadmap §) | Stav | Kde |
|---|---|---|
| §2.1 Registry tabulka `agent_tools` + RLS + policies | ✅ existuje | `aisha/db/sql/tables/agent_tools.sql`, `aisha/db/sql/rls/agent_tools.sql`, `aisha/db/sql/policies/service_select_agent_tools.sql` |
| §2.1 Enum `tool_handler_type` (`rpc` \| `edge_function` \| `webhook`) | ✅ existuje | `aisha/db/sql/enums/tool_handler_type.sql` |
| §2.1 Vazba `agent_tool_bindings` | ❌ **DROPPED** — nahrazeno channel-centric `allowed_tools`; NEVYTVÁŘET znovu | `aisha/db/seed/core/20_aisha_backbone.sql` (komentář „REMOVED") |
| §2.2 Registry RPC (`get_agent_tool`, `upsert_agent_tool_admin`, `delete_agent_tool_admin`) | ✅ existuje | `aisha/db/sql/functions/get_agent_tool.sql`, `aisha/db/sql/functions/upsert_agent_tool_admin.sql`, `aisha/db/sql/functions/delete_agent_tool_admin.sql` |
| §2.2 Tool Executor | ✅ existuje | `services/svc-ai-chat/src/lib/toolExecutor.ts` (`createToolExecutor`) |
| §2.2 Fail-closed builder/validátor | ✅ existuje | `services/svc-ai-chat/src/lib/toolBuilder.ts` (`buildTool`, `validateToolDefinition`) |
| §2.3 Tool call loop | ✅ existuje | `services/svc-ai-chat/src/lib/workflowEngine.ts` (while-loop, `max_tool_iterations` default 5) + wiring v `services/svc-ai-chat/src/routes/chat.ts` |
| §2.4 První vlna 6 toolů | ✅ seedováno | `aisha/db/seed/core/20_aisha_backbone.sql` (sekce `agent_tools`) |
| Admin CRUD hook | ✅ existuje | `src/hooks/useAgentTools.ts` (`useAgentTool`, `useUpsertAgentTool`, `useDeleteAgentTool`) |
| Admin UI stránka pro správu toolů | ❌ zatím neexistuje — vznikne ve WP-06 (hook existuje, žádná stránka v `src/pages/` ho nepoužívá) | — |
| List RPC pro admin přehled všech toolů | ❌ zatím neexistuje — vznikne ve WP-06 (`get_agent_tool` umí jen lookup by name) | — |
| Migrace `edge_function` toolů na `webhook` + svc-* URL | ❌ zbývá — executor pro `edge_function` throwuje (deprecated ve v2) | `services/svc-ai-chat/src/lib/toolExecutor.ts` (`dispatch()`) |
| Zadání `docs/planning/zadani/WP-06-*.md` | ❌ zatím neexistuje — vznikne z `docs/planning/zadani/_TEMPLATE.md` | — |

## Kanonický workflow: nový tool end-to-end

### 1. Handler musí existovat dřív než registrace

`handler_ref` odkazuje na REÁLNOU RPC (pro `handler_type = 'rpc'`) nebo svc-* URL (pro `'webhook'`). Nikdy neregistruj tool s neexistujícím handlerem — executor selže až za runtime. Read-tool = obyčejná RPC; write-tool = RPC se sufixem `_audited` (viz `aisha-rpc` skill). Bezpečnostní invariant z `docs/AI_AGENT_ROADMAP.md`: **read a write tooly jsou oddělené kategorie** — write tool vždy `audit_action` + zváženě `requires_consent`.

### 2. Registrace řádku v `agent_tools`

Dvě cesty:

**a) Seed SoT (preferováno pro core tooly)** — přidej INSERT do `aisha/db/seed/core/20_aisha_backbone.sql` do sekce `agent_tools` (vzor = existující první vlna, `ON CONFLICT (name) DO NOTHING`). Modelový příklad: **nový** tool name (jméno už seedované by kvůli `ON CONFLICT DO NOTHING` bylo no-op), handler = **existující** RPC `get_my_lab_results_audited(p_limit integer)`:

```sql
INSERT INTO public.agent_tools
  (name, display_name_key, description, parameters_schema, handler_type, handler_ref,
   access_tier_min, requires_consent, audit_action) VALUES
  (
    'get_recent_lab_results',                                 -- unique slug, anglicky — NOVÉ jméno
    'admin.tools.getRecentLabResults',                        -- i18n klíč
    'Retrieve the user''s most recent laboratory test results.',  -- popis PRO LLM
    '{"type":"object","properties":{"p_limit":{"type":"integer","description":"Max results"}},"required":[]}',  -- JSON Schema argumentů
    'rpc',                                                    -- tool_handler_type
    'get_my_lab_results_audited',                             -- REÁLNÁ RPC v aisha/db/sql/functions/
    'health_data',                                            -- min. access tier
    true,                                                     -- requires_consent
    'HEALTH_DATA_READ'                                        -- audit_action → audit_journal
  )
ON CONFLICT (name) DO NOTHING;
```

Klíče v `properties` = názvy argumentů RPC 1:1 — executor posílá args beze změny do `pgrestUser.rpc(handler_ref, args)` (viz `dispatch()` v `toolExecutor.ts`).

**b) Runtime přes admin RPC** — `upsert_agent_tool_admin(p_name, p_handler_type, p_handler_ref, ...)` (guard `is_admin_or_staff()`), z UI přes `useUpsertAgentTool()` v `src/hooks/useAgentTools.ts`. Frontend NIKDY `.from('agent_tools')` — RPC-only.

### 3. Zpřístupnění toolu — channel-centric `allowed_tools`

Roadmap §2.1 počítal s `agent_tool_bindings` — ta byla **dropnuta**. Tool se agentovi zpřístupňuje přes:

- `public_chat_channels.allowed_tools` (jsonb array) — `aisha/db/sql/tables/public_chat_channels.sql`
- `agent_catalog.allowed_tools` (text[]) — `aisha/db/sql/tables/agent_catalog.sql`

`services/svc-ai-chat/src/routes/chat.ts` pak čte `channelConfig.allowed_tools`, načte definice přes `toolExecutor.loadToolsByNames(channelToolNames)` a převede na specs přes `toolExecutor.toOpenAIToolSpecs(toolDefs)`. Metoda `loadToolsForAgent()` je **deprecated** (vrací `[]`) — nepoužívat.

### 4. Executor pipeline (co se děje s každým tool_call)

`createToolExecutor(pgrestService, pgrestUser, userId, tracer, config)` v `services/svc-ai-chat/src/lib/toolExecutor.ts` provede pro každý call:

1. **Resolve** — `get_agent_tool` RPC (per-request cache) + `validateToolDefinition()` z `toolBuilder.ts` doplní **fail-closed defaulty** (chybějící `requires_consent` → `true`, chybějící `audit_action` → `TOOL_<NAME>` uppercase — `TOOL_DEFAULTS.auditRequired = true`)
2. **Access tier** — `access_tier_min` vs. uživatelův `ChatAccessLevel` (ordered: `none` → `basic` → … → `partner_premium`)
3. **Validace argumentů** proti `parameters_schema` (JSON Schema subset: type/required/properties)
4. **Consent** — `has_data_sharing_consent` RPC pokud `requires_consent = true` (`aisha/db/sql/functions/has_data_sharing_consent.sql`)
5. **Audit** — `insert_audit_journal_entry` RPC; po backfillu v kroku 1 je `audit_action` u validního toolu vždy vyplněná, takže audit je **efektivně bezpodmínečný** — `NULL` v DB řádku (`search_knowledge_base`, `get_study_info`) auditování NEVYPNE. Loguje POUZE `param_keys`, nikdy hodnoty (PII)
6. **Dispatch** — `rpc` přes `pgrestUser.rpc()` (user JWT → RLS platí!), `webhook` přes SSRF-guarded `safeFetch`, `edge_function` → throw (deprecated)

Vše traced do `ai_trace_events` přes `tracer.span("tool_call", ...)`. Chyba toolu NIKDY neshodí turn — vrací se LLM jako `{"error": ...}` content.

### 5. Tool loop (function calling smyčka)

Loop žije ve `services/svc-ai-chat/src/lib/workflowEngine.ts` (ne v routě!): dokud `finalResponse.isToolCall` a `toolIterations < maxToolIterations`, executor spustí `executeAll(toolCalls)`, výsledky se pošlou jako `toolResults` do followup LLM callu. Limity: `node.config.max_tool_iterations` (default **5**) capnutý přes `routePlanHint.maxToolIterations`. Po dokončení se `last_tool_context` uloží do session memory a route vrací `tool_iterations` v response metadata.

## První vlna toolů (§2.4 — seedováno)

| Tool | handler_type | handler_ref | consent |
|---|---|---|---|
| `search_knowledge_base` | rpc | `get_knowledge_topics_localized` | ne |
| `get_my_lab_results` | rpc | `get_my_lab_results_audited` | ano |
| `get_longevity_score` | rpc | `get_longevity_score_audited` | ano |
| `get_study_info` | rpc | `get_study_detail` | ne |
| `create_reminder` | rpc | `create_story_reminder_audited` | ne (audit `REMINDER_CREATED`) |
| `get_dosage_plan` | rpc | `get_my_dosage_plans` ⚠️ **dangling** | ano (audit `HEALTH_DATA_READ`) |

Zdroj pravdy: `aisha/db/seed/core/20_aisha_backbone.sql`.

> ⚠️ **Známý seed bug (pre-existing):** RPC `get_my_dosage_plans` v repu NEEXISTUJE — v `aisha/db/sql/functions/` není a repo-wide ji zmiňuje jen seed INSERT a `docs/AI_AGENT_ROADMAP.md`. Tool `get_dosage_plan` má tedy dangling `handler_ref` a jeho dispatch za runtime selže. Náprava (mimo scope tohoto skillu): buď chybějící RPC vytvořit (skills `aisha-rpc` + `aisha-migration`), nebo seedovaný tool deaktivovat (`is_active = false`) / odstranit ze seedu.

## Anti-patterns (NEDĚLAT)

❌ Znovu vytvářet `agent_tool_bindings` — dropnutá; použij `allowed_tools` na kanálu/agentovi
❌ `handler_type = 'edge_function'` pro nový tool — deprecated, executor throwuje; použij `webhook` + svc-* URL
❌ Registrovat tool s `handler_ref` na neexistující RPC — ověř `ls aisha/db/sql/functions/ | grep <name>`
❌ Write-tool bez `audit_action` a bez `_audited` RPC — chybí audit trail
❌ Health-data tool bez `requires_consent = true` — obchází consent model
❌ Logovat hodnoty argumentů toolu — POUZE `param_keys` (PII safety)
❌ Dispatch `rpc` přes service-role klienta — musí jít přes `pgrestUser` (RLS)
❌ Webhook fetch bez SSRF guardu — `dispatch()` v `toolExecutor.ts` je vzor
❌ Kopírovat pseudo-kód z `docs/AI_AGENT_ROADMAP.md` §2.2/§2.3 doslova — je psaný pro starý Supabase stack (`SupabaseClient`, `functions.invoke`); reálná implementace je orchestrator-native v `toolExecutor.ts` + `workflowEngine.ts`
❌ Frontend `.from('agent_tools')` — RPC-only (`get_agent_tool` / `upsert_agent_tool_admin` / `delete_agent_tool_admin`)

## Gates & validace

```bash
npm run type-check          # tsc --noEmit
npm run lint                # eslint .
npm run test:gates          # celá gate sada (offline)
npm run func:validate       # SQL SoT validace (nový handler RPC / registry RPC)
npm run test:services       # service testy vč. svc-ai-chat
```

Cílené gates relevantní pro tool systém:

```bash
npx vitest run --config vitest.gates.config.ts src/tests/gates/sql-type-consistency.gate.test.ts       # RPC typy vs. DB schema
npx vitest run --config vitest.gates.config.ts src/tests/gates/audited-function-integrity.gate.test.ts # _audited RPC má audit INSERT
npx vitest run --config vitest.gates.config.ts src/tests/gates/service-security.gate.test.ts           # svc-ai-chat security vrstvy
npx vitest run --config vitest.gates.config.ts src/tests/gates/silent-degradation.gate.test.ts         # žádné empty catch v executoru
```

Checklist před commitem nového toolu:

- [ ] Handler RPC existuje v `aisha/db/sql/functions/` (nebo webhook route v `services/svc-*`)
- [ ] INSERT v `aisha/db/seed/core/20_aisha_backbone.sql` s `ON CONFLICT (name) DO NOTHING`
- [ ] `parameters_schema` je validní JSON Schema (`type: "object"` + `required`)
- [ ] Write-tool má `audit_action` + `_audited` handler; health-data tool má `requires_consent = true`
- [ ] Tool přidán do `allowed_tools` cílového kanálu/agenta
- [ ] Gates výše zelené

## Související

- **`aisha-rpc`** — handler RPC pro tool + registry RPC (SECURITY DEFINER, REVOKE/GRANT, audit)
- **`aisha-edge-fn`** — webhook handler jako Fastify route (7 povinných vrstev, SSRF guard)
- **`aisha-migration`** — změna schématu `agent_tools` (SoT pairing, baseline se NEEDITUJE)
- **`docs/AI_AGENT_ROADMAP.md`** Fáze 2 — původní návrh; Fáze 4 (ReAct loop) na tool systému staví
- **`docs/planning/DELEGATION_PLAN.md`** §5 WP-06 — delegační kontrakt (Tier A→B)
