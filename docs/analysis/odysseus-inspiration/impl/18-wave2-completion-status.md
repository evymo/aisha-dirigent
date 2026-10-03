# Impl 18 — Wave 2: dokončení + přesné specifikace zbytku

> Navazuje na [17-implementation-status.md](17-implementation-status.md). Toto je SoT pro **stav dokončení vlny 2**.
> Ověřeno proti kódu na `origin/main` (2532592d) a dodáno na branchi `feat/odysseus-wave2-complete`.
> Kde se liší od 00–17, platí tento dokument.

---

## 1. Ověřený stav vlny 2 (cross-check dokumentů vs. kód)

Verdikty ověřené čtením kódu (ne jen dle dokumentů):

| Položka (impl/17 §4) | Doc tvrdil | Skutečný kód (origin/main) | Verdikt |
|---|---|---|---|
| K2 generator fencing | hotovo, čeká merge | `wrapUntrusted()` je na PR #574 (`feat/reflection-generator-untrusted-fence`), **ne na main** | ⚠️ čeká merge PR #574 |
| 05A `ssrf-no-bare-fetch` vitest gate | zbývá | semgrep pravidlo běží diff-aware; vitest gate chyběl | ✅ **dodáno** (viz §2.1) |
| G1c cached-token cost accrual | zbývá | `cacheReadTokens` teče v `ChatResponse.usage`, ale `costAggregator`/`appendCost` ho ignorovaly (plná sazba / 0) | ✅ **dodáno** (viz §2.2) |
| G1b stable-prefix wiring | zbývá | `systemPromptStable` + `prepareAnthropicBody` cache_control existují; **žádný caller je nenastavuje** | ✅ helper+flag dodán; wiring specifikován (§2.3 + §3.1) |
| G5 per-model prompt varianty | zbývá | `model_family` je sloupec registru; prompt-variant resolver chyběl | ✅ resolver+testy dodány; DB seam specifikován (§2.4 + §3.2) |
| 8b batch routing offline KB workloadů | zbývá | `aisha_choose_execution_strategy` existuje; KB (RAG eval/embeddings/tool-index) jde sync | ⏳ spec §3.3 |
| G2 context editing / 200K guard | zbývá | jen cost-budget gate (`orchestrator.ts:305–346`); žádná cross-iteration kompakce | ⏳ spec §3.4 |
| 04+06 deep research + SearXNG | opt-in, default off | pouze dokumenty; nula kódu | ⏳ spec §3.5 |

---

## 2. Dodáno a **validováno** v této vlně (branch `feat/odysseus-wave2-complete`)

Vše validováno spuštěním v izolovaném worktree (Node 22, vitest 3.2.6). **27 zelených testů.**

### 2.1 SSRF universal gate (05A) — ✅ hotovo
- `src/tests/gates/ssrf-no-bare-fetch.gate.test.ts` — prochází `services/*/src`, hledá bare `fetch(` (detektor ignoruje `safeFetch(`, `.fetch(`, komentáře, stringy), **fail na NOVÝ un-guarded odchozí povrch**.
- `src/tests/gates/ssrf-known-exemptions.ts` — ratchetující baseline **82** existujících call-sitů (fixní/operátorem konfigurované hosty; ne URL z untrusted vstupu) + `FORBIDDEN_EXEMPTION_PATTERNS` (deep-research/web-search/searxng **nikdy** nesmí být exemptované).
- **Testy (5):** detektor (pozitivní/negativní kontrola), no-new-violation, no-stale (baseline jen klesá), forbidden-pattern, baseline-má-důvod. Ověřeno i **fail-injekcí** (dočasný bare-fetch → gate spadl).
- **Vztah k semgrepu:** semgrep `aisha-raw-fetch-outside-ssrf-guard` běží diff-aware v CI (blokuje jen nové); tento gate přidává stejný invariant do běžné (semgrep-less) test-lane.

### 2.2 Cached-token cost accrual (G1c) — ✅ hotovo
- `services/svc-ai-chat/src/lib/costAggregator.ts` — `ModelPricing` rozšířen o `cachedInputPer1M?` / `cacheWritePer1M?`; `record()`/`estimateCost()`/`estimateCostUsd()` berou volitelný `CacheTokenUsage { read?, write? }`. Cache-read se účtuje cached sazbou (~−90 %), cache-write write sazbou. **Aditivně** (Anthropic `input_tokens` cache tokeny už NEobsahuje). Bez známé cached sazby → fallback na `inputPer1M` (**nevymýšlíme slevu**).
- `services/svc-ai-chat/src/reflection/checkpointer.ts` — `appendCost` bere `tokens_cache_read`/`tokens_cache_write`, účtuje je a persistuje do `cost_total_json` (jen když nastanou).
- `services/svc-ai-chat/src/reflection/orchestrator.ts` — caller předává cache tokeny z `output.output_data` (bezpečné optional čtení; 0 pro nodes bez cachingu).
- **Testy (8):** backward-compat (bez cache = původní math), −90 % cached read, write sazba, aditivita 3 tříd, no-invented-discount fallback, agregace počtů v summary, `estimateCostUsd` s cache, `loadPricingFromEnv` parsuje cache sazby.
- **Poznámka:** aby se −90 % projevilo v reportu, musí `pricingTable` (z registru `cached_input_price_per_m`) nést cached sazbu — jinak se cache-read účtuje plnou vstupní sazbou (bezpečný overcount, ne undercount).

### 2.3 Stable-prefix helper (G1b) — ✅ helper+flag; wiring viz §3.1
- `services/svc-ai-chat/src/lib/promptCache.ts` — čistý helper: `isStablePrefixCacheEnabled()` (flag `STABLE_PREFIX_CACHE`, default **OFF**), `splitSystemPrompt(segments)` → `{ stable, dynamic }` (všechny stable vrstvy před dynamickými, zachová pořadí uvnitř třídy), `flattenSplit()` pro důkaz bezztrátovosti.
- **Testy (5):** flag jen na `'true'`, stable-first reorder, bezztrátovost obsahu, drop prázdných segmentů, all-stable → prázdný dynamic.
- **Proč jen helper + flag:** stable/dynamic split vyžaduje **reorder** system promptu (instrukce před vs. po kontextu) v horké chat cestě → behaviorálně citlivé. Dle eval-before-migration disciplíny se wiring zapíná flagem a před zapnutím se ověří benchmark harnessem. Přesný wiring v §3.1.

### 2.4 Per-model prompt varianty (G5) — ✅ resolver+testy; DB seam viz §3.2
- `services/svc-ai-chat/src/lib/promptVariants.ts` — `deriveModelFamily(modelId, registryFamily?)` → coarse bucket (`anthropic-opus|anthropic-sonnet|anthropic-haiku|anthropic|openai|google|local|default`); `selectPromptVariant(variants, family)` s broadening chain (specific → base → default); `resolvePromptForModel(...)` s dědičností nenastavených polí z code-fallbacku. **Nikdy nefailuje** — chybí varianta → default.
- **Testy (9):** derivace rodiny (vč. registry-precedence), lookup chain, exact/broaden/default selekce, null-map bez pádu, partial-inherit, code-fallback.
- **Reuse-first:** klíčováno registrovým `model_family`; store dle vzoru `*_template_versions` — SQL v §3.2.

**Soubory dodané v této vlně:**
```
src/tests/gates/ssrf-no-bare-fetch.gate.test.ts        (nový)
src/tests/gates/ssrf-known-exemptions.ts               (nový)
services/svc-ai-chat/src/lib/costAggregator.ts         (změna)
services/svc-ai-chat/src/lib/promptCache.ts            (nový)
services/svc-ai-chat/src/lib/promptVariants.ts         (nový)
services/svc-ai-chat/src/reflection/checkpointer.ts    (změna)
services/svc-ai-chat/src/reflection/orchestrator.ts    (změna)
services/svc-ai-chat/src/tests/costAggregator.unit.test.ts    (nový)
services/svc-ai-chat/src/tests/promptCache.unit.test.ts       (nový)
services/svc-ai-chat/src/tests/promptVariants.unit.test.ts    (nový)
```

---

## 3. Zbývá — přesné implementační specifikace (ready-to-apply)

### 3.1 G1b — dotažení stable-prefix wiringu (flag-gated)
**Soubory:** `services/svc-ai-chat/src/routes/chat.ts` (~ř. 839–884), `services/svc-ai-chat/src/lib/workflowEngine.ts` (`WorkflowContext` ~ř. 86–96 a main_agent větev ~ř. 559–561).
**Kroky:**
1. `chat.ts`: místo `systemPromptBase = promptLayers.join('\n\n')` sestavit segmenty a rozdělit helperem:
   ```ts
   import { isStablePrefixCacheEnabled, splitSystemPrompt } from '../lib/promptCache.js';
   const segs = [
     { text: personalityPrompt ?? '', stable: true },
     { text: composedContextAvailable ? aishaContextSection : '', stable: false },
     { text: mainAgent.instructions, stable: true },
     { text: languageInstruction + callerContext, stable: false },
   ];
   const useSplit = isStablePrefixCacheEnabled();
   const { stable, dynamic } = splitSystemPrompt(segs);
   const systemPromptBase = useSplit ? dynamic : segs.map(s=>s.text).filter(Boolean).join('\n\n');
   const systemPromptStable = useSplit ? stable : undefined;
   ```
2. `WorkflowContext`: přidat `systemPromptStable?: string;` a předat z chat.ts do `workflowCtx`.
3. `workflowEngine.ts` main_agent větev: `systemPrompt = ctx.systemPromptBase + ctx.memoryContext + '\n\n' + ctx.restrictionPrompt;` beze změny; do `chatOpts` přidat `systemPromptStable: ctx.systemPromptStable` (llmRouter/unifiedChat už `systemPromptStable` na `ChatRequest` má — ověřit proplumbování přes `unifiedChat`).
**Testy předem:** U helper (hotovo); C `unifiedChat` s `systemPromptStable` → `prepareAnthropicBody` dá cache_control na konec stable bloku (rozšířit `anthropic-body-builder.gate`); M 2. identický turn → `cache_read_input_tokens>0`. **DoD:** při `STABLE_PREFIX_CACHE=true` 2. turn cache-hituje stable prefix; při OFF beze změny chování.
**Eskalace:** zapnout až po benchmark-eval (reorder mění pořadí instrukce↔kontext).

### 3.2 G5 — DB store variant (reuse `*_template_versions`)
**SQL (nová tabulka + RPC), dle vzoru `consent_template_versions`:**
```sql
create table if not exists ai_prompt_variants (
  id uuid primary key default gen_random_uuid(),
  prompt_key text not null,                 -- který prompt (např. 'main_agent.system')
  model_family text not null default 'default',
  system_text text,
  few_shot_text text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (prompt_key, model_family)
);
```
RPC `get_prompt_variants(p_prompt_key text)` → řádky pro daný klíč. Resolver v kódu (`promptVariants.ts`, hotový) dostane `Record<model_family, {system, fewShot}>` + `model_family` z `aisha_resolve_clow_backend`/registru a vybere variantu.
**Testy předem:** pgTAP: unique(prompt_key,model_family), default řádek existuje; U resolver (hotovo); C chybí varianta → fallback (hotovo). **DoD:** eskalace Sonnet→Opus nese Opus variantu; bez varianty se nic nerozbije.
**Governance:** nový zdroj promptů → přes Source Onboarding klasifikaci (viz CLAUDE.md Enterprise Source Onboarding) není třeba (interní config), ale změny variant logovat do audit journalu.

### 3.3 8b — batch routing offline KB workloadů
**Soubory:** `services/svc-mcp-knowledge/src/lib/embed-dispatcher.ts`, RAG eval a tool-index cesty.
**Krok:** offline/n-blokující workloady (embeddings backfill, RAG eval, tool-index refresh) směrovat přes `aisha_choose_execution_strategy` → při `strategy='batch'` použít batch submit (viz `batchSubmitter.ts`) místo sync `unifiedChat`. Online (user-facing) zůstává sync.
**Testy předem:** U strategy resolver vrací `batch` pro `task_kind ∈ {embeddings, rag_eval, tool_index}`; I batch submit → `batch_jobs` řádek; C online zůstává sync. **DoD:** offline KB workloady nejedou sync (nezabírají latency budget), účtují se batch sazbou.

### 3.4 G2 — cross-iteration context kompakce (orchestrator node boundary)
**Soubor:** `services/svc-ai-chat/src/reflection/orchestrator.ts` (budget gate ~ř. 305–346), reuse `soulforge.optimizePayload`.
**Krok (provider-aware):** na node boundary, když `composed_context`+`checkpoint.state` překročí práh (`system_config['ai_runtime'].context_compaction_threshold`):
- Anthropic → native context editing (clears staré tool_results/thinking) za `CAPABILITY_BETAS`;
- ostatní → `computeInputBudget()` (impl 03, `contextBudget.ts`) + kompakce přes `soulforge.optimizePayload` rozšířený o cross-iteration slot.
Stabilní prefix (G1b) držet **mimo** soulforge slot-variaci (caching↔soulforge tenze, impl/15 §4).
**Testy předem:** I agent s >threshold tool cally nepřeteče (Anthropic clears / non-Anthropic kompaktuje); U práh z `ai_runtime`; G žádný 200K fail na long-run fixture. **DoD:** dlouhý agentní běh nespadne na context window u žádného provideru.

### 3.5 04+06 — deep research loop + SearXNG (opt-in, default OFF)
**Nové moduly (izolované):** `services/svc-mcp-knowledge/src/lib/webSearch.ts` (SearXNG klient) + `deepResearch.ts` (Think→Search→Extract→Synthesize→Stop smyčka).
**Bezpečnost (prerekvizit):** SearXNG dotaz i fetch výsledných stránek **MUSÍ** přes `@aisha/security/ssrf` `createSsrfGuard().safeFetch()` (host allowlist = SearXNG instance + povolené domény). Nové moduly **nesmí** být v `ssrf-known-exemptions.ts` (viz `FORBIDDEN_EXEMPTION_PATTERNS` — gate to vynutí).
**Flag:** `DEEP_RESEARCH_ENABLED` (default OFF) + `SEARXNG_URL` v `system_config`.
**Testy předem:** U research loop stop-podmínky (max rounds, gap-analysis); C SSRF guard odmítne metadata/loopback (mock lookup); I mock SearXNG → syntéza s citacemi; G modul chytne `ssrf-no-bare-fetch` gate (žádný bare fetch). **DoD:** default OFF beze změny; při ON web research přes guard, s citacemi, bounded rounds.

---

## 4. Jak aplikovat

Práce je na branchi `feat/odysseus-wave2-complete` (worktree `.claude/worktrees/odysseus-wave2`, base `origin/main`) a jako patch v `outputs/odysseus-wave2/`.

```bash
# varianta A — z patch bundle
git checkout -b feat/odysseus-wave2-complete origin/main
git apply outputs/odysseus-wave2/odysseus-wave2.patch

# spustit dodané testy
node scripts/test/run-vitest.mjs --config vitest.gates.config.ts src/tests/gates/ssrf-no-bare-fetch.gate.test.ts
cd services/svc-ai-chat && npx vitest run \
  src/tests/costAggregator.unit.test.ts \
  src/tests/promptCache.unit.test.ts \
  src/tests/promptVariants.unit.test.ts

# před merge: plný typecheck + gate lane + service tests (CI)
npm run test:gates
npm run test:services
```

---

## 5. Provozní poznámky

- **Validace:** dodané položky (§2) jsou spuštěné a zelené v sandboxu (27 testů). Integrace vyžadující živou infra (DB/PostgREST/služby/real LLM) — §3 položky — se musí ověřit v CI (`test:gates`, `test:db`, `test:services`, reflection integration lanes).
- **Sdílený repo:** práce probíhala v izolovaném worktree, aby branch-switche v hlavním stromě neshodily untracked soubory. Doporučení: aplikovat na čistém worktree, ne do rozpracovaného stromu.
- **PR #574 (K2 fencing):** samostatně zmergovat — je mimo tuto branch.
- **`updated_at` / heals:** žádná SQL funkce se v této vlně neměnila (jen G5 spec §3.2 přidá tabulku → cold-start baseline + heal pro live DB dle impl/17 §3 pravidla).
- **Flag přehled (přírůstek):** `STABLE_PREFIX_CACHE` (off), `DEEP_RESEARCH_ENABLED` (off, spec), `AISHA_MODEL_PRICING` nyní může nést `cachedInputPer1M`/`cacheWritePer1M`.
