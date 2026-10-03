# Impl 09 — Závěrečný bezpečnostní review (ztratili jsme něco? rozbijeme něco? je to dynamické a řízené AISHou?)

> Kritický průchod finálního zadania (08) proti reálnému kódu. Odpovídá na tři otázky: (A) neztratili jsme minimalizací něco potřebného, (B) nerozbíjí reuse něco funkčního, (C) jsou nové věci stejně dynamické a řízené AISHou (jaký model, kdy, proč).

---

## A. Neztratili jsme něco potřebného? (re-check deferred položek)

| Odložené | Verdikt | Podmínka, kdy to budeme potřebovat |
|----------|---------|-------------------------------------|
| Embedding tool-index (01 v2) | **Bezpečné odložit** | Jen pokud intent-routing (v1) má nízký recall na eval setu toolů (měří Langfuse: zvolené vs. volané). Do té doby zbytečná infra. |
| Pinned SSRF guard (undici) | **Bezpečné odložit** | Jen při reálné hrozbě sub-sekundového DNS rebindingu na high-stakes cestě. `safeFetch` single-lookup pokrývá typické útoky. |
| Přesný tokenizer (js-tiktoken) | **⚠️ ČÁSTEČNĚ ztráta — mitigovat** | `estimateTokens` (chars/4) **podhodnocuje** kód/JSON/CJK → riziko **overflow** při budgetingu. NEZ­tratit tiše: viz §B-3 (bezpečnostní margin). Plný tokenizer zůstává doporučený deferred pro přesnost. |
| Nový admin panel | **Bezpečné odložit** | NocoDB nad `system_config` stačí na start; Appsmith panel až když to operátoři budou chtít vizuálně. |

**Závěr A:** jediná reálná „ztráta" je přesnost token-countu → řešeno marginem (ne novou dependency). Vše ostatní je legitimně odložené s jasnou měřitelnou podmínkou návratu.

---

## B. Nerozbíjí reuse/minimalizace něco funkčního? (breakage risks + fixy)

### B-1. Tool selection — ŠPATNÝ integrační bod (oprava nutná) 🔴
- **Riziko:** impl 01 původně navrhoval hook v `mcp.ts listToolsForUser`. **Ale to je MCP `tools/list` = protokolová discovery pro klienty.** Dynamické filtrování per-zpráva by **rozbilo** MCP klienty (tool, který se stane relevantní později, by nebyl v jednou-staženém katalogu).
- **Realita (ověřeno):** svc-ai-chat staví LLM tool set **jinde** — `chat.ts:592` `channelConfig.allowed_tools` → `loadToolsByNames` → `toOpenAIToolSpecs`. MCP `tools/list` se pro LLM call vůbec nepoužívá.
- **Fix:** `resolveToolSet()` zúží **`channelToolNames` v `chat.ts` před `loadToolsByNames`**. **`mcp.ts tools/list` zůstává netknutý** (full katalog, discovery v pořádku). → správné A non-breaking. (Opraveno v impl/01.)

### B-2. `context_window` může být NULL → neregredovat 🟠
- **Riziko:** sloupec existuje, ale mnoho řádků `ai_model_registry` může mít `context_window = NULL`. Dnes není žádné vynucení (posílá se celá historie). Kdyby `computeInputBudget` při NULL spadl na `DEFAULT_BUDGET=6000`, **zkrátil by víc než dnes** → regrese pro modely s neznámým oknem.
- **Fix:** vynucení budgetu/kompakce **jen když je okno známé**; při NULL ponechat dnešní chování (žádné agresivní ořezání). Backfill známých modelů (vLLM Qwen, OpenAI, Anthropic) do registry. Feature flag `adaptive_context_budget` default off → zapnout po backfillu.

### B-3. `estimateTokens` podhodnocuje → bezpečnostní margin 🟠
- **Riziko:** chars/4 podhodnocuje kód/JSON/CJK → budget si „myslí", že se vejde, a přeteče.
- **Fix:** při hrubém odhadu použít **nižší headroom** (např. 0.7 místo 0.85) a/nebo +15 % margin na odhad. Žádná nová dependency. Přesný tokenizer = deferred upgrade, ne blocker.

### B-4. `story-consult.ts .slice(-6)` → mimo scope 🟢
- **Riziko:** odstranění hardcoded ořezu v `story-consult` by změnilo chování specifického flow (latence/cost).
- **Fix:** budget-driven trim aplikovat **jen na hlavní chat** (`orchestrationBridge`/`chat.ts`); `story-consult` ponechat beze změny (separátní rozhodnutí), aby se nic nerozbilo.

### B-5. Untrusted wrapper vs. `decision-provenance` gate 🟠
- **Riziko:** existuje `src/tests/gates/decision-provenance-correctness.gate.test.ts` — může asertovat `[source: …]` provenance labely v promptu. Obalení KB/memory nesmí ty labely ztratit.
- **Fix:** `wrapUntrusted` obaluje blok, ale **provenance labely zůstávají uvnitř** (chunk text si nese `[source: …]`). Po změně spustit tento gate; přidat prompt-boundary gate, který kontroluje obojí (label přítomen ∧ uvnitř guard bloku).

### B-6. MCP `tools/list` číselník v `/health` 🟢
- `mcp.ts` reportuje `tools: TOOL_DEFINITIONS.length` v health/initialize. Protože 01 fix nech­ává `tools/list` netknutý, **žádný dopad** na health/initialize. (Potvrzeno B-1.)

**Závěr B:** jeden tvrdý fix (B-1 integrační bod) + tři měkké guardrails (B-2/3/5). Žádná z minimalizací nerozbíjí nic, pokud se aplikují tyto fixy — všechny jsou už zapracované do 01/03/08.

---

## C. Jsou nové věci stejně dynamické a řízené AISHou? (model: co, jak, kde, kdy, proč)

**Princip (ověřeno):** model NIKDY není hardcoded. Každý LLM call jde přes `aisha_resolve_clow_backend(p_clow, p_context)`, který vrací nejvhodnějšího **healthy** providera+model pro daný **purpose** (s `task_kind` a kontextem: tokeny, deadline, max cost, capability flagy, zbývající budget). Resolver je health- i cost-aware a má TTL cache. Komentář v `capability-resolver.ts`: *„RAG-layer purposes — extend as new LLM call sites."* → **přidat purpose = nativní dynamický mechanismus**, ne nová komponenta, ne hardcode.

### Matice model-governance pro nové LLM cally
| Impl | LLM call | Purpose (clow) | task_kind | Proč ten tvar | Kdy se volá |
|------|----------|----------------|-----------|---------------|-------------|
| 01 v1 | výběr toolů | **žádný LLM** (reuse `analyzeChatQueryIntent`, heuristika) | — | levné, deterministické, bez modelu | každá zpráva |
| 02 | runtime injection re-scan | **`rag.safety_scan`** (už existuje) | classification | malý klasifikátor, levný, rychlý | jen `critical_flow`/`high_risk` profily |
| 03 | kompakce historie | **`chat.history_compaction`** (nový purpose) | chat | sumarizace = chat, malý output (≤1024 tok) | při překročení prahu okna |
| 04 | decompose otázky / gap / synthesis | **`research.reasoning`** (nový) | reasoning | plánování/usuzování | jen `deep_research` on, per kolo |
| 04 | extrakce faktů | **`research.extract`** (nový) | extraction | strukturovaná extrakce z top-K | per kolo |
| 04 | faithfulness gate | **`rag.critic_judge`** (už existuje) | reasoning | reuse existujícího critic | per extrahované fakty |
| 06 | (embedding, pokud 01 v2) | **`rag.embedding`** (už existuje) | embedding | index toolů stejným invariantem jako KB | jen při rebuildu indexu (deploy) |

**Důsledek pro zadání:** „nové purpose-y" (`chat.history_compaction`, `research.reasoning`, `research.extract`) jsou **bezpodmínečně nutné** — bez nich by nové LLM cally nebyly governed/dynamické. Ale je to **data/config rozšíření resolveru** (vzor stávajících `rag.*`), ne nová komponenta. Tím je splněno „stejně dynamické a řízené AISHou jako zbytek".

**Kde se to nastavuje (dynamicky):** purpose → CLOW shape v `capability-resolver.ts` (task_kind, expected tokens, deadline, max cost, capabilities) + DB `aisha_resolve_clow_backend` rozhoduje za běhu dle health/cost/budget. Prahy (kdy re-scan, kdy kompakce, hloubka research) jsou ve `system_config['ai_runtime']` (warm, admin-laditelné). → **AISHA rozhoduje co/kdy/proč; operátor ladí meze; nic není zadrátované.**

---

## D. Dopad na finální zadání (08) — co se mění
1. **Net-new doplnit (nutné):** 3 nové clow purposes (`chat.history_compaction`, `research.reasoning`, `research.extract`) jako entries v `capability-resolver.ts` PURPOSE_SHAPES. Data, ne komponenta. Bez nich nejsou nové LLM cally governed.
2. **Oprava integračního bodu 01:** `chat.ts` `channelToolNames` (NE `mcp.ts tools/list`). Zapracováno v impl/01.
3. **Guardrails (do impl 03):** budget jen při známém okně (B-2), margin na hrubý token-count (B-3), `story-consult` mimo scope (B-4).
4. **Gate (do impl 02):** po obalení spustit `decision-provenance` gate; prompt-boundary gate kontroluje label∧blok (B-5).

Vše ostatní z 08 platí beze změny. Žádná nová komponenta nad rámec 3 purpose-entries; vše ostatní reuse.

---

## E. Závěr
- **(A)** Minimalizací jsme neztratili nic kritického; jediná reálná ztráta (přesnost token-countu) je pokrytá marginem, ne novou dependency.
- **(B)** Reuse nerozbíjí nic za předpokladu jednoho fixu (tool-selection integrační bod) + tří guardrails — vše zapracováno.
- **(C)** Nové věci jsou stejně dynamické a řízené AISHou: každý LLM call přes `aisha_resolve_clow_backend` s explicitním purpose+task_kind; model vybírá AISHA za běhu (health/cost/budget); prahy ve `system_config` (admin-laditelné). Hardcoded model nikde.
