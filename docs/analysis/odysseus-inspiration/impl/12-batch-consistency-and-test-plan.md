# Impl 12 — Sync↔Batch konzistence (Anthropic) + test-first acceptance plán

> Dvě věci: (A) ověření a zajištění konzistence batch ↔ sync pro Anthropic rozšíření; (B) na co myslet při vývoji + **jaké testy potřebujeme PŘED vývojem**, aby bylo měřitelné, že záměr byl naplněn (test-first / DoD předem).

---

## ČÁST A — Batch ↔ Sync konzistence (Anthropic)

### A.1 Ověřený stav a risk
- **Sync** (`anthropic.ts`): tělo (model/max_tokens/messages/system/tools) se staví **inline v `chat()`**. Žádný extrahovaný builder.
- **Batch** (`batchSubmitter.ts`): `BatchRequestItem.request` je **předpřipravené tělo od volajícího**; `submitAnthropicBatch` ho jen zabalí `{ custom_id, params: r.request }`. Tělo se staví **jinde** (reflection/generator-batch-dispatch atd.).
- **Vzor existuje jinde:** `openai-compat.ts` má `prepareRequest(request)` sdílené `chat()` (ř.282) i `chatStream()` (ř.321). Anthropic to nemá.
- 🔴 **Drift risk:** přidáme-li `cache_control`/`jsonMode`/structured do sync builderu, **batch je nedostane** → sync a batch produkují různá těla → nekonzistentní caching/JSON/tools mezi okamžitým a dávkovým během.

### A.2 Fix — jeden sdílený builder (mirror openai-compat)
> **TŘETÍ call site (ověřeno, viz 15 §K2):** reflection `reflection/nodes/generator.ts:97–181` staví Anthropic/OpenAI batch tělo **inline** — taky musí přejít na `prepareAnthropicBody`. Gate A-3 ho musí pokrýt.

Extrahovat v `anthropic.ts` čistou funkci a použít ji **na všech třech cestách** (sync `chat()`, `chatStream()`, **batch — vč. `generator.ts` node**):
```ts
export function prepareAnthropicBody(request: ChatRequest): { body: Record<string, unknown>; betas: string[] } {
  // model, max_tokens, messages, system(+cache_control), tools(+cache_control), jsonMode/output_config …
  // vrací i seznam potřebných anthropic-beta flagů (per capability)
}
```
- `chat()` (sync) → `prepareAnthropicBody` + POST `/v1/messages`.
- `chatStream()` (nový) → tentýž `prepareAnthropicBody`, jen `stream:true`.
- **Batch** → volající staví `BatchRequestItem.request = prepareAnthropicBody(req).body`. Tím je tělo **identické** sync i batch.

### A.3 Beta-header konzistence
- Batch dnes posílá `anthropic-beta: message-batches-2024-09-24` (transport-level). 
- Capability beta flagy (např. context editing) musí být přidané **konzistentně** na obou transportech. `prepareAnthropicBody` vrací `betas[]` → sync je dá do hlavičky, batch je sloučí s `message-batches-*`. Jeden zdroj pravdy o tom, které capability vyžadují který beta flag.
- **Pozn.: caching nepotřebuje beta** (GA); structured output / context editing mohou — udržovat v jedné mapě `CAPABILITY_BETAS`.

### A.4 Caching stackuje s batchem
- `cache_control` v `params` funguje i v batchi → **cached batch read = −90 % z už −50 % batch ceny**. Sdílený builder to zařídí automaticky. Cost tracking (cacheReadTokens) musí číst i z batch výsledků (`WF_BATCH_POLLER` → cost accrual).

### A.5 Konzistenční invariant (do zadání)
> **Invariant:** Anthropic request body se staví VÝHRADNĚ přes `prepareAnthropicBody`. Žádná cesta (sync/stream/batch) nesmí stavět tělo ručně. Vynuceno testem A-1 (níže).

---

## ČÁST B — Na co myslet + testy PŘED vývojem (test-first DoD)

> Pro každou položku: **Dev considerations** (gotchas) + **Acceptance testy psané PŘED kódem** (když jsou zelené, záměr je naplněn). Typ: U=unit, C=contract, G=gate, I=integration, M=measurement.

### B-0. Průřezově (platí pro vše)
- Každá změna za **feature flagem**; **parity test** „flag off = bajt-identické chování jako dnes".
- Žádný hardcoded model — každý nový LLM call přes `aisha_resolve_clow_backend` (purpose).
- SoT → `db:init:generate` → `db:types:gen` jen kde vznikne DB objekt (v jádru nikde).
- Před mergem: `test:gates` zelené + `security.gate` bez regrese.

---

### B-1. Anthropic body builder + sync↔batch konzistence
**Dev:** extrahovat builder bez změny chování; betas mapa; cost čte cache tokeny i z batche.
**Testy předem:**
- **A-1 (U/invariant):** `prepareAnthropicBody(req)` volané sync i batch cestou → **hluboká rovnost** těl pro tentýž `ChatRequest`. (Zabrání driftu.)
- **A-2 (U):** golden snapshot těla pro reprezentativní request (system+tools+jsonMode+cache_control) — odhalí nechtěné změny.
- **A-3 (G):** grep-gate „žádné ruční stavění Anthropic těla mimo `prepareAnthropicBody`".
- **A-4 (U):** `betas[]` obsahuje správné flagy per capability; batch je slučuje s `message-batches-*`.
**Záměr naplněn když:** A-1–A-4 zelené → sync a batch produkují identické tělo i hlavičky.

### B-2. Prompt caching
**Dev:** stable-prefix (instrukce/pinned/tools/preamble nahoře → breakpoint → KB/historie/dotaz dole); cache jen Anthropic-family; cost přes `cached_input_price_per_m`.
**Testy předem:**
- **U:** `cache_control: ephemeral` se přidá na poslední stabilní blok system+tools.
- **C:** mock Anthropic response s `usage.cache_read_input_tokens` → `ChatResponse.usage.cacheReadTokens` naplněno; `ModelUsage` agreguje.
- **G (prompt-order):** assembled prompt má stabilní prefix před variabilní částí (KB/historie za breakpointem).
- **M (cache-hit):** ve dvou po sobě jdoucích requestech se stabilním prefixem 2. platí cache_read > 0 (integration proti Anthropicu nebo recorded fixture); **úspora měřitelná** vs. baseline.
**Záměr naplněn když:** 2. request čte z cache (cache_read>0) a cost report ukazuje −90 % na cachovaných tokenech.

### B-3. Structured output (jsonMode → grammar)
**Dev:** Anthropic backend doplnit `jsonMode` (vzor openai.ts); grammar `output_config` jen kde `provider_metadata.structured_output != 'none'` (Haiku 4.5 = beta); **nekompatibilní s citations**.
**Testy předem:**
- **U:** `request.jsonMode` → správné pole v Anthropic těle (parita s openai-compat).
- **C:** model bez structured → fallback na json_mode (degrade, ne fail).
- **G:** žádný call nemá současně structured output ∧ citations.
- **I:** judges/safety-scan vrací **vždy** validní JSON dle schématu (100 % na eval setu).
**Záměr naplněn když:** judge/extract nikdy nevrátí nevalidní JSON; fallback funguje na ne-structured modelech.

### B-4. Streaming (Anthropic parity)
**Dev:** nativní Anthropic SSE eventy (`message_start`/`content_block_delta`/`message_stop`) → `UnifiedStreamChunk`; error PŘED prvním yieldem (vzor openai-compat); `unifiedChatStream` fallback.
**Testy předem:**
- **U:** Anthropic SSE fixture → správná sekvence `UnifiedStreamChunk` + `finishReason` normalizace.
- **C:** chyba před prvním tokenem → fallback chain (ne commit half-streamu).
- **I:** dlouhý výstup (>2K tok) nestreamovaně by timeoutoval; streamovaně projde.
**Záměr naplněn když:** Anthropic streamuje s paritou k openai-compat; žádné HTTP timeouty na dlouhých výstupech.

### B-5. impl 01 — wire `toolsAllowlist`
**Dev:** zúžit `channelToolNames` o `aishaRoutePlan.toolsAllowlist` PŘED `loadToolsByNames`; **`mcp.ts tools/list` netknutý**; bezpečnost = zúžení je vždy podmnožinou channel práv; caching-aware (na Anthropic zvážit, zda nevariovat tooly kvůli cache).
**Testy předem:**
- **U:** `allowed_tools ∩ toolsAllowlist` = výsledná množina; prázdný/absent allowlist → dnešní chování (parity).
- **G (security):** výsledek je vždy ⊆ `channelConfig.allowed_tools` (nikdy nerozšiřuje práva).
- **C:** `mcp.ts tools/list` vrací plný katalog (nezměněno) — MCP discovery test.
- **M:** průměrný počet toolů poslaných do LLM klesl vs. baseline (Langfuse), bez poklesu success rate.
**Záměr naplněn když:** méně toolů v promptu, žádná regrese práv, MCP discovery intaktní.

### B-6. impl 03 — enforce `ContextBundle` budget + kompakce
**Dev:** akce nad existujícím `tokensUsed/tokenBudget`; budget jen při známém `context_window` (NULL→dnešní chování + backfill); margin na hrubý `estimateTokens` (headroom 0.7); `story-consult .slice(-6)` mimo scope; sumarizace přes `chat.history_compaction` purpose.
**Testy předem:**
- **U:** `computeInputBudget` — 16k vs 128k → různý budget; explicit cap; `contextWindow=undefined`→ dnešní chování (žádné agresivní ořezání).
- **U:** kompakce — historie>okno → tail zachován + summary; pod prahem → beze změny.
- **I:** dlouhá konverzace (>okno malého modelu) nepřeteče; klíčové entity ze summary zachované.
- **G:** při NULL okně se NEzapne agresivní ořez (anti-regrese).
**Záměr naplněn když:** dlouhé konverzace nepřetečou a malé modely nejsou bezdůvodně ořezané při NULL okně.

### B-7. impl 02 — untrusted wrapper
**Dev:** stabilní preamble do cachovaného prefixu; KB/memory obal za breakpointem; provenance `[source:]` labely zůstávají uvnitř bloku; re-scan jen critical_flow/high_risk přes `rag.safety_scan`.
**Testy předem:**
- **U:** marker-breakout (`<<<END…>>>` uvnitř chunku) neutralizován; prázdný segment vynechán.
- **G (prompt-boundary):** žádný KB/memory text v system roli mimo guard blok; `[source:]` label přítomen ∧ uvnitř bloku.
- **G:** spustit existující `decision-provenance` gate — bez regrese.
- **I (red-team):** role-hijack věta v KB chunku nezmění chování na eval setu.
**Záměr naplněn když:** prompt-boundary + decision-provenance gaty zelené; red-team injection neprojde.

### B-8. Warm config `ai_runtime` + CLOW purposes
**Dev:** kopie `getRunnerCaps` (TTL, DB>env, fail-safe); nové purposy = union + `PURPOSE_TO_CLOW` entry (0 DB změn).
**Testy předem:**
- **U:** `getAiRuntimeConfig()` — DB hodnota přebíjí env; DB nedostupná → env fallback; TTL cache.
- **U:** nový purpose `chat.history_compaction`/`research.*` → `resolveRagBackend` vrátí provider/model (mock RPC); cache per-purpose.
- **C:** `set_system_config_admin('ai_runtime',…)` admin-only (non-admin odmítnut) + zápis do `audit_journal`.
**Záměr naplněn když:** operátor změní práh v DB → projeví se do TTL bez redeploy; nové purposy routují bez DB migrace.

### B-9. impl 05A — SSRF univerzální
**Dev:** untrusted/web fetch přes existující `safeFetch`; gate na bare fetch.
**Testy předem:**
- **G (`ssrf-no-bare-fetch`):** žádný bare `fetch(` v untrusted/web modulech (mimo allowlist).
- **I:** SearXNG/web fetch přes guard; metadata/rebinding payload odmítnut.
**Záměr naplněn když:** gate zelený; žádná LLM-driven outbound cesta neobchází guard.

---

## ČÁST C — Pořadí test-first vývoje
Pro každou položku: **napsat acceptance testy (B-x) → ty selžou (red) → implementovat → green → flag-off parity → gate.** Doporučené pořadí dle 11 §6: B-5 (01 wire) → B-8 (warm/purposes) → B-6 (03) → B-1+B-2+B-3+B-4 (Anthropic parity balíček) → B-7 (02) → B-9 (SSRF) → batch směrování.

> **Gate na konzistenci batch/sync (A-1, A-3) je blokující pro celý Anthropic parity balíček** — bez něj se sync a batch rozejdou.
