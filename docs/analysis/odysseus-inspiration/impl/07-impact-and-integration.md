# Impl 07 — Hloubková analýza dopadů a integrace (blast radius)

> Kam každá změna sahá, jaké settings vytáhnout do administrace, jak rozšířit cold-start/doctor a všechny navázané věci. Uzemněno v reálné config/infra vrstvě AISHy.

---

## 1. Config model AISHy (ověřený) — kam co patří

AISHA má **tři config vrstvy** + feature flagy. Každý nový setting musí vědomě padnout do jedné:

| Vrstva | Mechanismus | Hot? | Úložiště | Reálný vzor |
|--------|-------------|------|----------|-------------|
| **Cold** | `process.env.X ?? default` v `config.ts`, sealed `as const` | ne (redeploy) | Compose env, `.env.coolify`, `.env-prod-backup` | `svc-ai-chat/src/config.ts` (`ssrfHostAllowlist`, `omniDispatchBudgetMs*`) |
| **Warm** | `get_system_config(p_key)` RPC + TTL cache, DB přebíjí env, fail-safe na env | ano (~30 s) | `system_config` tabulka | `svc-agent-runner/src/runtime-config.ts` (`getRunnerCaps`, key `agent_runner`) |
| **Hot** | audited RPC, bez cache | okamžitě | `aitg_automation_settings` | n8n WF_AITG_* + Appsmith `aitg-automation-control` |
| **Feature flag** | env bool, fail-safe default (`!== 'false'` on / `=== 'true'` off) | ne | Compose env | `reflectionConfig.budgetEnforcement`, `enableOpenclaw` |

**RPC kontrakt warm vrstvy:** `get_system_config(p_key)` (čtení) + `set_system_config_admin(...)` (audited admin zápis, `is_admin_or_staff`). To je cesta, jak settings zpřístupnit administraci bez redeploy.

**Admin surfacing:** Appsmith template číta/píše přes audited SECURITY DEFINER RPC (vzor `aitg-automation-control.template.json`, `spend-governance.template.json`); NocoDB umí editovat `system_config` přímo.

---

## 2. Settings matrix — co vytáhnout a kam (per impl)

> Pravidlo: **bezpečnostní/provozní prahy = warm** (admin ladí bez redeploy), **endpointy/secrety = cold** (redeploy), **kill-switch = feature flag**.

| Impl | Setting | Vrstva | Default | Kde deklarovat | Admin-editable? | Degraded chování |
|------|---------|--------|---------|----------------|-----------------|------------------|
| 02 | `untrusted_wrapper_enabled` | feature flag | on | env | ne | off = staré chování |
| 02 | `runtime_rescan_profiles` (které profily re-scanují) | warm (`system_config['ai_runtime']`) | `['critical_flow','high_risk']` | system_config | ano (Appsmith) | scan vynechán → jen wrapper |
| 02 | `injection_rescan_threshold` | warm | 0.7 | system_config | ano | — |
| 03 | `adaptive_context_budget` | feature flag | off→on | env | ne | off = fixní per-profil budget |
| 03 | `context_budget_headroom` / `hard_max` | warm | 0.85 / 200k | system_config | ano | — |
| 03 | `compact_threshold` / `keep_last_turns` / `summary_max_tokens` | warm | 0.85 / 6 / 1024 | system_config | ano | bez kompakce = riziko overflow |
| 03 | model `context_window` / `max_output_tokens` | **DB data** | — | `ai_model_registry` (migrace) | ano (NocoDB/Appsmith model admin) | undefined → konzervativní budget |
| 01 | `dynamic_tool_selection` | feature flag | off | env | ne | off = celý katalog (dnešek) |
| 01 | `tool_select_k_by_window` (mapa K) | warm | {16k:6, 32k:10, >:16} | system_config | ano | fallback K=8 |
| 01 | `tool_select_min_score` | warm | (lad.) | system_config | ano | — |
| 01 | `TOOL_INDEX_EMBED_MODEL` | cold | — | env + `external-secrets.required.env` | ne | bez modelu → index rebuild fail-loud |
| 05A | `SSRF_HOST_ALLOWLIST` | cold (už existuje) | provider hosts | env (`config.ts`) | ne | host mimo allowlist → blok |
| 05A | `ssrf_pinning_enabled` | feature flag | on pro web cesty | env | ne | off = re-resolve (slabší) |
| 04 | `deep_research` | feature flag | off | env | ne | off = jen interní KB |
| 04 | `research_max_rounds` / `research_budget_tokens` / `_ms` | warm | (lad.) | system_config | ano | cutoff zastaví research |
| 06 | `SEARXNG_URL` | cold | "" | env + `external-secrets.required.env` (@required false, @degraded) | ne | prázdné → web search off, API fallback |
| 06 | `web_search_provider` (searxng\|api fallback) | warm | searxng | system_config | ano | fallback při výpadku |

**Doporučení:** založit **jeden warm klíč `system_config['ai_runtime']`** (JSONB) sdružující prahy 02/03/01/04/06 → jeden `getAiRuntimeConfig()` loader (vzor `getRunnerCaps`, TTL 30 s, fail-safe na env). Jeden admin panel místo deseti roztroušených.

---

## 3. DB dopady (migrace, baseline, types, RPC, grants)

> **OVĚŘENO (08-final-zadani §0):** `ai_model_registry.context_window`/`max_output_tokens` **už existují** → žádná migrace pro 03/01-core. `agent_tool_embeddings`/`match_agent_tools` jsou **deferred v2** (01-core jede přes intent routing, žádná DB). V **nutném jádru tedy NEvzniká žádný DB objekt** → baseline/types řetězec se nespouští.

| Změna | Soubor (SoT) | Stav |
|-------|--------------|------|
| `context_window`, `max_output_tokens` | `ai_model_registry.sql` | **už existuje — žádná migrace**, jen čtení |
| `agent_tool_embeddings` + `match_agent_tools` RPC + grants | nové soubory | **DEFERRED v2** (jen při nedostatku recall) |
| `system_config` řádek `ai_runtime` | seed pipeline | data, ne migrace (reuse get/set RPC) |

**Post-migrace řetězec — spustit JEN když vznikne DB objekt (tj. pouze 01 v2, jinak vynechat):**
1. `db:migration:register` (registrace delta migrace)
2. `db:init:generate` (regenerace baseline z SoT)
3. `db:types:gen` (**TS typy** — nové sloupce/tabulky/RPC se musí promítnout do `src/types` a service typů, jinak typecheck spadne)
4. `db:rpc:inventory` (RPC inventář — `match_agent_tools`, případně `get/set ai_runtime`)
5. `db:convergence:verify` (throwaway DB schema-equivalence) + cold-start apply
6. `security.gate` (anon grants / PHI / SSRF) — nové grA­nty nesmí dát anon write (konzistence s dokončeným auditem)

> **Pozor na sdílenou migraci `ai_model_registry`** — impl 01 i 03 ji potřebují. Udělat **jednu** migraci, ne dvě.

---

## 4. Cold-start dopady (rozšíření)

### 4.1 `cold-start-verify.mjs` (HTTP probes)
- Přidat **curated probe pro SearXNG** (impl 06) — vzor stávajících `{ group, name, url, expect }`:
  ```js
  if (env.SEARXNG_DOMAIN && !env.SEARXNG_DOMAIN.endsWith('.invalid')) {
    checks.push({ group: 'optional', name: 'SearXNG', url: httpsUrl(env.SEARXNG_DOMAIN, '/healthz'), expect: [200] });
  }
  ```
  → SearXNG je tier:optional (jako ws-gateway) — probe jen když je doména přítomná. Domain-coverage gate to uzamkne.

### 4.2 `cold-start-doctor.sh` (7 fází preflight)
- **Fáze C (env contract)** — nové cold klíče (`SEARXNG_URL`, `TOOL_INDEX_EMBED_MODEL`) projdou přes `aisha-env-doctor.mjs`.
- **Fáze D (compose interpolation)** — nová služba `searxng` v compose se musí renderovat.
- **Fáze E (manifest ↔ compose)** — `config/services.json` entry pro `searxng` musí matchovat compose.

### 4.3 `config/services.json` — nová služba SearXNG s capability gate
```json
"searxng": {
  "role": "web-search", "tier": "optional", "subdomain": "search",
  "public": false, "compose": "docker-compose.coolify-searxng.yml", "placement": "backend",
  "capabilities": { "requires_any_of": [ { "env_flag": "DEEP_RESEARCH_ENABLED" } ] }
}
```
→ Deploy jen když je deep research zapnutý (žádná zbytečná služba).

### 4.4 `config/external-secrets.required.env` — anotované klíče
```
# @required false
# @purpose SearXNG meta-search endpoint pro deep research (spec 04/06)
# @source self-hosted SearXNG host
# @degraded Deep research přes web nedostupné; jen interní KB
SEARXNG_URL=
# @required false
# @purpose Embedding model pro dynamický tool-index (spec 01)
# @degraded Tool-index rebuild fail-loud; fallback na statický katalog
TOOL_INDEX_EMBED_MODEL=
```

### 4.5 `config/cold-start-timeouts.env` — nové tunable (pokud SearXNG pomalý start)
`AISHA_SEARXNG_READY_TIMEOUT_S=120` (volitelně).

---

## 5. Doctor / diagnostics dopady

| Skript | Rozšíření |
|--------|-----------|
| `aisha-env-doctor.mjs` (`env:doctor`) | validovat nové cold klíče (`SEARXNG_URL`, `TOOL_INDEX_EMBED_MODEL`) proti `external-secrets.required.env`; respektovat `@degraded` (chybějící = warn, ne fail) |
| `stack-health.sh` (`stack:health`) | přidat SearXNG do health matrixu (optional) |
| `models-check.mjs` (`models:check`) | **rozšířit o `context_window`/`max_output_tokens`** discovery — dnes ukazuje modely/pricing/capabilities; přidat sloupec okna (zdroj pro impl 03 budget). Validace `--validate` pinguje providery → doplnit čtení okna z `/models`. |
| `evymo:health` (dirigent cli) | volitelně surface stavu deep-research / tool-index |
| **degraded-state reporting** | navázat na existující `service_health` / `aitg_observability_health` vzor: SearXNG, tool-index a embed backend hlásit degraded (toto je přesně Odysseus ROADMAP položka „degraded-state reporting pro ChromaDB, SearXNG, email, ntfy" — u nás přes existující health RPC, ne ad-hoc) |

---

## 6. Gates / CI dopady

| Gate | Účel | Impl |
|------|------|------|
| `ssrf-no-bare-fetch.gate.test.ts` (nový) | žádný bare `fetch` v untrusted/LLM cestách (~177 dnes) | 05A |
| prompt-boundary gate (nový, do `security.gate` rodiny) | žádný KB/memory text mimo untrusted guard blok v assembled promptu | 02 |
| tool-select parity gate (nový) | flag-off = identický katalog jako dnes; security: low-tier nikdy nedostane gated tool | 01 |
| `security.gate` (stávající) | **regrese** — nové grants nesmí dát anon write; PHI; SSRF | 01/05A |
| `db-convergence-schema-equivalence` (stávající) | baseline ↔ SoT po migracích | 01/03 |
| `pre-deploy:check` (stávající) | `test:gates` + domain doctor — přidat nové gaty sem | všechny |

---

## 7. Observability (Langfuse) dopady
`tracer.ts` dělá dual-write (DB + REST). Přidat spany/atributy:
- **01:** zvolené tooly vs. skutečně volané (precision/recall výběru) → ladění prahu.
- **03:** kdy proběhla kompakce, kolik tokenů ušetřeno, budget vs. okno.
- **04:** počet research kol, budget spend, stop důvod (LLM vs. cutoff).
- **02:** kolik chunků re-scan zahodil (critical_flow).
Tyto metriky jsou **vstup pro ladění warm settings** z §2 — proto warm, ne hardcoded.

---

## 8. Admin dashboard dopady (kam do administrace)

**Doporučený minimální zásah:** jeden nový Appsmith panel **„AI Runtime Config"** (vzor `aitg-automation-control.template.json`):
- čte `get_system_config('ai_runtime')`, píše přes nový **`set_system_config_admin`** (už existuje, audited, `is_admin_or_staff`).
- Sekce: Prompt safety (02 prahy), Context budget (03 prahy), Tool selection (01 K/score), Deep research (04 budget/rounds), Web search provider (06).
- Feature flagy (kill-switche) zůstávají **cold/env** (bezpečnější — nejsou hot-toggleable přes UI), ale panel je **zobrazí read-only** s indikací stavu.

**NocoDB:** `ai_model_registry` (okna modelů, 03) a `system_config` editovatelné přímo pro power-userы.

**Audit:** každá změna přes `set_system_config_admin` → `audit_journal` (existující kontrakt).

---

## 9. Per-impl blast radius (souhrn)

- **02 untrusted wrapper:** `packages/security` (+modul) · `orchestrationBridge` · system_config(`ai_runtime`) · nový gate · Langfuse · Appsmith panel. **Bez migrace.** Nejmenší radius.
- **03 context budget:** **migrace `ai_model_registry`** → types/rpc/baseline · `modelDiscovery`+`models-check` · `orchestrationBridge`/`chat` · system_config · hippocampus · Langfuse · admin panel.
- **01 tool selection:** **migrace (tabulka+RPC+grants)** → types/rpc/baseline/**security.gate** · `mcp.ts`/`resolveToolSet` · embed-dispatcher · build-tool-index skript (deploy) · system_config · parity gate · Langfuse · admin.
- **05A SSRF:** `packages/security/ssrf` · ~177 fetch call-sites audit · nový gate · cold/feature env. **Bez DB.**
- **04+06 deep research + SearXNG:** **nová služba** (compose + services.json + capability gate) · cold-start probe + doctor + env-doctor + external-secrets · `svc-web-search`/`svc-ai-chat` · system_config · degraded-state health · Langfuse · admin. Největší radius — proto poslední.

---

## 10. Doporučená sekvence vs. infra práce

1. **Sdílená DB migrace** `ai_model_registry` (+okna) — odblokuje 01 i 03; protáhnout celým řetězcem §3.
2. **02** (bez DB, jen `packages/security` + bridge + 1 warm klíč + gate).
3. **03** (využije migraci #1 + warm prahy + models-check rozšíření).
4. **01** (migrace tabulka/RPC + security.gate + parity gate).
5. **05A** (SSRF gate + pinning) — prerekvizit pro 06.
6. **04+06** (služba + cold-start/doctor/services.json + degraded health) — poslední, nejširší radius.

Každý krok uzavřít: `db:init:generate` (kde DB) → `db:types:gen` → `test:gates` → `cold-start:verify` (kde infra).
