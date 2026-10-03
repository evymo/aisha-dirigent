# Impl 10 — Anthropic API capabilities → AISHA (caching, context editing, streaming, batch, citations, structured outputs)

> Jak s těmito 6 schopnostmi pracovat v AISHE. Uzemněno v kódu. Princip stejný jako 08/09: **reuse-first, dynamicky řízené AISHou (resolver/strategy), provider-aware** (každá schopnost je vázaná na konkrétní providery/modely — nesmí se aplikovat naslepo).

---

## 0. Shrnutí — co už máme vs. co je nevyužitá příležitost

| Schopnost | Stav v AISHE (ověřeno) | Akce | Maps to |
|-----------|------------------------|------|---------|
| **Prompt caching** | **Nevyužito.** `anthropic.ts` posílá `system`/`tools` jako plain (žádný `cache_control`). ALE registry **už má `cached_input_price_per_m`** + `provider_metadata` | **ADOPT — největší cost win.** Malá změna v `anthropic.ts` | průřezově 01/02/03 |
| **Context editing** | Nevyužito (žádný `context-management` beta) | ADOPT pro Anthropic agent loops; jinak naše kompakce | impl 03 + agent-runner |
| **Streaming** | **Hotovo** pro OpenAI-compat (`streaming.ts`/`parseOpenAISSE`). Nativní Anthropic SSE eventy (message_start/content_block_delta) — **pravděpodobně mezera** | OVĚŘIT/doplnit jen Anthropic SSE větev | provider vrstva |
| **Batch processing** | **Hotovo a governed!** `batchSubmitter` (Anthropic+OpenAI batch), routováno `aisha_choose_execution_strategy` (deadline-aware), `ai_batch_jobs` + `WF_BATCH_POLLER` | REUSE — nové offline workloady tam směrovat | RAG eval, embeddings, tool-index rebuild, research |
| **Citations** | Home-grown `decisionProvenance` + `knowledgeIntegrity` (`source_slug`, gate) | Anthropic Citations = **volitelné** augmentace pro Anthropic research odpovědi | impl 04 |
| **Structured outputs** | `json_mode: true` u judges + safety-scan (ne grammar-constrained) | UPGRADE json_mode → `output_config.format` kde dává smysl | judges, safety, research.extract |

**Headline:** AISHA má streaming i **dynamicky řízený batch** hotové. Reálné nové výhry: **prompt caching** (netknuté, největší úspora) a **structured-output upgrade**. Context editing + citations = cílené doplňky. Vše provider/model-aware přes existující registry flagy.

---

## 1. Prompt caching — největší cost win (ADOPT)

### 1.1 Jak zapnout (malá, izolovaná změna)
V `services/svc-ai-chat/src/lib/providers/anthropic.ts`: `system` a `tools` poslat jako bloky s `cache_control: { type: 'ephemeral' }` na posledním STABILNÍM bloku (caching je GA, beta header netřeba; 1h TTL volitelně přes beta):
```ts
body.system = [{ type: 'text', text: request.systemPrompt, cache_control: { type: 'ephemeral' } }];
if (request.tools?.length) {
  body.tools = request.tools.map(/* … */);
  body.tools[body.tools.length - 1].cache_control = { type: 'ephemeral' }; // cache celý tool blok
}
```
Reuse: registry **už má `cached_input_price_per_m`** → cost se počítá správně, jakmile začnou chodit cache_read tokeny.

### 1.2 Design rule: STABLE PREFIX (dopadá na pořadí promptu)
Cache je **prefixová**. Cache breakpoint musí být **za** stabilním obsahem a **před** variabilním:
```
[STABLE → cacheable]  system instrukce · pinned rulesets · tool schémata · UNTRUSTED_POLICY_PREAMBLE (02)
        ── cache_control breakpoint ──
[VARIABLE → necacheable]  KB retrieval (02 wrap) · conversation history · user message
```
`orchestrationBridge` skládání musí tohle dodržet: pinned/instrukce/preamble nahoře (stabilní), KB/historie/dotaz dole. → **stabilní prefix je nově návrhové pravidlo**, ne jen optimalizace.

### 1.3 Interakce s našimi impl (důležité tenze)
- **impl 01 (dynamický výběr toolů) ⚠️ TENZE:** měnit tool set per zpráva = **busting cache** tool bloku. Pro ~27 toolů může být **cachovaný plný katalog (−90 %) levnější** než dynamický výběr s cache-miss. → **provider-aware:** na **Anthropic preferovat stabilní plný katalog + caching** (nevariovat tooly); dynamický výběr (01) nasadit hlavně na **lokální/non-caching providery** (vLLM/Qwen, malá okna) a kvůli accuracy. Rozhoduje resolver (který provider). → 01 se nestává zbytečným, ale **podmíněným providerem**.
- **impl 02 (untrusted wrapper):** stabilní `UNTRUSTED_POLICY_PREAMBLE` patří do **cachovaného prefixu**; variabilní KB chunky jsou stejně **za** breakpointem → jejich obalení caching nepoškozuje. Soulad.
- **impl 03 (context budget):** kompakce mění historii (variabilní část, za breakpointem) → cache prefixu nerozbíjí. Soulad. Naopak stabilní prefix + caching sníží cenu opakovaných tokenů.

### 1.4 Governance (dynamicky, ne naslepo)
Caching jen na Anthropic-family. `aisha_resolve_clow_backend` cost odhad má **zohlednit cached pricing** (`cached_input_price_per_m`): Anthropic s cachovaným prefixem může porazit „levnějšího" providera bez cache. `provider_metadata` flag `supports_prompt_caching`. → přesnější model selection, ladí AISHA za běhu.

---

## 2. Context editing — provider-aware kompakce (doplňuje impl 03)

- **Anthropic native context editing** (clears old tool_results/thinking nad prahem) + SDK client-side compaction řeší přesně „agent po 40–80 tool callech narazí na 200K".
- **Reuse vs build:** na **Anthropic** preferovat **native context editing** (beta `context-management` header) místo naší kompakce — méně kódu, server-side. Na **OpenAI/Gemini/vLLM/Maestro** zůstává naše `computeInputBudget` + kompakce (impl 03). → **impl 03 je provider-aware:** Anthropic → context editing; ostatní → naše glue.
- **Kde to nejvíc pomůže:** tool-heavy agent loops — **Dirigent / svc-agent-runner / reflection** (ToT, mnoho tool callů). Tam je context editing vysoká hodnota; náš kompaktor cílil chat.
- Governance: zapnout dle `provider_metadata.supports_context_editing`; práh ve `system_config['ai_runtime']`.

---

## 3. Streaming — z velké části hotovo (OVĚŘIT Anthropic větev)
- `streaming.ts`/`parseOpenAISSE` + `chatStream` existují (OpenAI-compat SSE). Chat UX streamuje.
- **Pravděpodobná mezera:** nativní Anthropic SSE má jiné eventy (`message_start`/`content_block_delta`/`message_stop`) než OpenAI-compat. Ověřit, zda `anthropic.ts` má stream větev; pokud ne, doplnit parser (malé). Prevence HTTP timeoutů > ~2K tokenů.
- Žádná governance změna — UX vrstva.

---

## 4. Batch processing — hotovo a governed (REUSE, rozšířit pokrytí)
- `batchSubmitter` (Anthropic `message_batches` + OpenAI batch) **už routuje `aisha_choose_execution_strategy`** (deadline-aware, NE statický pattern) → `ai_batch_jobs` + `WF_BATCH_POLLER` + audit. **−50 %**, stackuje s cachingem (cached batch read −90 % z už slevněné ceny).
- **Akce = reuse, ne build:** nové **offline** workloady směrovat přes execution-strategy chooser:
  - RAGAS eval (`rag.eval_*`), embeddings backfill (`rag.embedding`), **tool-index rebuild** (01 v2), případně **dávkové research sub-úkoly**.
  - Interaktivní chat zůstává sync/stream; rozhoduje deadline-aware chooser (už existuje).
- Governance: žádná nová — `aisha_choose_execution_strategy` je ten dynamický mozek.

---

## 5. Citations — volitelný doplněk k existující provenance (impl 04)
- AISHA má **vlastní** provenance (`decisionProvenance`, `knowledgeIntegrity` `source_slug`, `decision-provenance` gate) — **provider-agnostické a governance-tied**. To zůstává primární.
- **Anthropic Citations** (char-level, **cited text se nebilluje**) lze použít jako **augmentaci pro Anthropic-backed research odpovědi** (impl 04) — přesné char-level reference do zdrojů.
- **Pozor:** Citations jsou **nekompatibilní se structured output** (§6) — nelze v jednom callu obojí. Proto provider/režim-aware: research synthesis s citacemi (Anthropic) vs. extract se structured outputem (jiný call). → necpat do jednoho callu.
- Verdikt: **nenahrazovat** vlastní provenance; Citations jen jako volitelné obohacení výstupu research na Anthropic.

---

## 6. Structured outputs — upgrade json_mode (cílený)
- Dnes: `rag-eval-judges` + `ingestion-safety` používají **`json_mode: true`** (model „obvykle" vrátí validní JSON). 
- **Upgrade:** kde model/provider podporuje, přepnout na **grammar-constrained `output_config.format`** (JSON schema) → fyzicky nelze vyrobit nevalidní JSON. Vhodné pro: RAGAS judges, safety-scan skóre, **research.extract** (impl 04), případně strukturovanou intent klasifikaci.
- **Caveaty (provider/model-aware, dynamicky):**
  - Haiku 4.5 structured output = **beta** → flag `provider_metadata.structured_output: 'beta'|'ga'|'none'`; pro high-volume/produkci testovat.
  - **Nekompatibilní s Citations** (§5) → nikdy v jednom callu.
  - První request s novým schématem je pomalejší (grammar kompilace) → cachovat schéma/akceptovat warm-up.
- Governance: resolver/volající vybírá structured-output jen pro modely s `structured_output != 'none'`; jinak fallback na `json_mode`. → degraduje, nepadá.

---

## 7. Dopad na finální zadání (08) — co přibývá (vše reuse-first)
1. **Prompt caching enablement** v `anthropic.ts` (system+tools `cache_control`) + **stable-prefix pravidlo** v `orchestrationBridge`. **Nutné, vysoké ROI, malý zásah.** Reuse `cached_input_price_per_m`.
2. **impl 01 provider-aware:** na Anthropic preferovat cachovaný plný katalog; dynamický výběr hlavně pro lokální/non-caching providery. (Korekce hodnoty 01.)
3. **impl 03 provider-aware:** Anthropic → native context editing; ostatní → naše kompakce.
4. **Structured-output upgrade** json_mode → `output_config.format` u judges/safety/research.extract, gated `provider_metadata.structured_output`.
5. **Batch:** nové offline workloady přes `aisha_choose_execution_strategy` (reuse, žádný build).
6. **Citations:** volitelné u Anthropic research; nikdy s structured outputem.
7. **Cost/capability governance:** `aisha_resolve_clow_backend` zohlední cached pricing + `provider_metadata` flagy (`supports_prompt_caching`, `supports_context_editing`, `structured_output`). Data v registry, ne nová komponenta.

**Princip zachován:** žádná nová komponenta — provider-vrstva změny (`anthropic.ts`), data flagy v `ai_model_registry.provider_metadata`, reuse `batchSubmitter`/`aisha_choose_execution_strategy`/`cached_input_price_per_m`. Vše dynamicky řízené AISHou (resolver = model, strategy chooser = sync/batch), provider/model-aware (nic naslepo).

---

## 8. Závěr: co/jak/kdy/proč (governance pohled)
- **Co se kde použije:** caching+structured+citations jen na providerech/modelech, které je mají (`provider_metadata`); context editing jen Anthropic; batch dle deadline.
- **Jak se rozhoduje:** `aisha_resolve_clow_backend` (model+provider, cost-aware vč. cached ceny) + `aisha_choose_execution_strategy` (sync vs batch). Oba **už existují** a jsou dynamické.
- **Kdy:** caching při stabilním prefixu (každý opakovaný request); batch při ne-urgentním deadline; context editing při tool-heavy dlouhých bězích; structured output u JSON call sites.
- **Proč:** −90 % na cachovaných tokenech, −50 % na batchi (stackuje), garantovaně validní JSON, ověřitelné citace, žádný 200K fail u agentů. Vše bez hardcodu — meze ve `system_config['ai_runtime']`, výběr v resolveru.
