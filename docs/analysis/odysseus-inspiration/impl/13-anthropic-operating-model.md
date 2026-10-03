# Impl 13 — Jak má AISHA pracovat s Anthropicem (operating model + respect-checklist)

> Syntéza Anthropic frameworku (paths / levers / model selection / caching / context editing / thinking-billing / query()-vs-session) proti reálné AISHE. Odpovídá: **jak volat Claude Code vs. přímo API, kdy co, a respektujeme všechno?**

---

## 1. Dvě cesty, kterými AISHA volá Anthropic (obě už existují)

| Cesta | Komponenta | Architektura (lever) | Stav (≈ query/session) | Kdy použít |
|-------|-----------|----------------------|------------------------|------------|
| **Přímo Messages API** | `svc-ai-chat` → `providers/anthropic.ts` | Augmented LLM / Workflow | **Stateless per-call** — AISHA si drží stav sama (conversation history v DB, `ContextBundle`, hippocampus). „You manage the loop." | Chat odpovědi, RAG sub-tasky, judges, kompakce, research kroky — vše, co je definovaný krok |
| **Claude Code (Agent SDK)** | `svc-agent-runner` → `backends/claude-cli.ts` (Docker container per run) | Agent (self-directed) | **One-shot per run** (čerstvý container) ≈ `query()` | Autonomní tool-heavy úkoly (Dirigent delivery, kódové změny), kde Claude řídí vlastní proces |

**Mapování na query() vs ClaudeSDKClient:**
- AISHA **nepoužívá Claude session pro stav** — stav si drží ve své vrstvě (DB historie + compose_context + memory). To je úmyslné a správné pro multi-provider platformu (stav nesmí být uvězněný v jednom provideru). → odpovídá **Messages API modelu** („you manage the loop").
- **query() (stateless)** = naše per-call API volání i one-shot agent-runner běhy (CI/dávky/jeden úkol). 
- **session (stateful)** ekvivalent = naše vlastní conversation history + `ContextBundle` napříč turny; **ne** Claude-side session. Výhoda: provider-agnostické, funguje i pro vLLM/OpenAI.

**Pravidlo:** pokud další krok závisí na tom, co se naučil předchozí → drž to v **AISHA conversation history** (ne v Claude session). Pokud je úkol nezávislý → one-shot (agent-runner run nebo přímé API volání).

---

## 2. Model levers — AISHA to už dělá governed (a líp než hardcoded)

Anthropic lever „Which model? Haiku/Sonnet/Opus, start with Sonnet, eskaluj jen s důvodem" — AISHA implementuje jako **`aisha_resolve_clow_backend`**: skóruje **per (provider × task_kind)** z `ai_model_benchmarks` + cost/deadline/capability tags. Tedy:
- `task_kind: classification` (safety_scan, eval_judge, intent) → levný/rychlý model (Haiku-class). 
- `task_kind: chat` → default vyvážený (Sonnet-class).
- `task_kind: reasoning` (critic, research.reasoning) → silnější (Sonnet/Opus dle skóre a max_cost).
- `task_kind: extraction` (graph_extract, research.extract) → dle benchmarku.
→ **„Start with Sonnet, escalate to Opus only when justified"** je u nás vynuceno **skóre + cost cap**, ne lidským odhadem. Respektováno a generalizováno.

**Pozor (Anthropic insight):** prompt vyladěný na Sonnet může matnout Opus. → při eskalaci modelu **přeladit prompt + spustit eval** (viz §4 checklist „eval-before-migration").

---

## 3. Architektura — „start simple, add complexity only when needed"
AISHA má všechny tři úrovně: augmented LLM (přímé volání s RAG/tools), Workflow (`workflowEngine`, n8n), Agent (reflection/ToT, agent-runner). Default = augmented LLM; agent jen když úkol vyžaduje (reflection/Dirigent). → respektuje Anthropic doporučení. Naše impl 01 (zúžení toolů) a 03 (budget) to ještě zlevňují.

---

## 4. Respect-checklist — respektujeme všechno?

| Anthropic best-practice | AISHA stav | Kde řešeno |
|-------------------------|-----------|------------|
| **Model selection jako governed decision** | ✅ `aisha_resolve_clow_backend` (benchmark-scored per task_kind) | existuje |
| **Start simple (augmented LLM), agent jen když nutné** | ✅ tři úrovně, default augmented | existuje |
| **Path 1 respekt (ne vždy AI / ne vždy Anthropic)** | ✅ multi-provider (vLLM/OpenAI/Gemini/Maestro), local pro citlivá data | existuje |
| **Thinking-billing past (`usage.output_tokens`, ne viditelný blok)** | ✅ `anthropic.ts:195-196` čte `output_tokens` | existuje |
| **Batch pro offline (−50 %), deadline-aware** | ✅ `batchSubmitter` + `aisha_choose_execution_strategy` | existuje |
| **Self-managed state/loop (Messages API model)** | ✅ DB historie + ContextBundle + memory | existuje |
| **PHI/BAA → citlivá data mimo cloud** | ✅ `residencyCloudForbiddenMinSensitivity` (residency routing na local) | existuje — ověřit pokrytí |
| **Prompt caching (−90 % na stabilním prefixu)** | ⚠️ **nevyužito** | impl 10/11/12 (zapnout v `anthropic.ts`, stable-prefix) |
| **Context editing / 200K guard pro agenty** | ⚠️ nevyužito | impl 03/10 (Anthropic native; jinde naše kompakce) |
| **Extended thinking / effort levels (xhigh sweet spot)** | ⚠️ neplumbováno v `anthropic.ts` | **nový malý gap** — přidat `thinking`/effort do builderu |
| **Per-model prompt retuning při migraci** | ⚠️ ad-hoc | **přidat disciplínu** — prompt varianty per model-family |
| **Eval-before-migration (eval suite gate)** | ⚠️ benchmarky jsou, eval-gate na migraci modelu chybí | **přidat gate**: změna default modelu = běh eval setu |
| **Stable-prefix discipline (kvůli cache)** | ⚠️ není pravidlo | impl 10 (orchestrationBridge pořadí) |
| **Sync↔batch konzistence těla** | ⚠️ drift risk | impl 12 (`prepareAnthropicBody`) |

**Závěr:** AISHA respektuje **jádro frameworku** (model governance, architektura, multi-provider, billing, batch, self-managed state, residency) — a v lecčems ho generalizuje na multi-provider. **Gapy = přesně náš balík** (caching, context editing) + **3 malé doplňky:** extended-thinking plumbing, per-model prompt disciplína, eval-before-migration gate.

---

## 5. Tři malé doplňky nad rámec 08 (nově odhalené tímto srovnáním)
1. **Extended thinking / effort** — doplnit `thinking: { type, budget_tokens }` (resp. effort) do `prepareAnthropicBody` (impl 12); řízeno per task_kind/purpose (reasoning → vyšší effort; classification → off). Billing už čte `output_tokens` správně.
2. **Per-model prompt varianty** — system prompt/few-shot laděné per model-family; při `resolve_clow_backend` eskalaci na jinou rodinu použít odpovídající variantu (Anthropic insight: Sonnet few-shot mate Opus).
3. **Eval-before-migration gate** — změna default modelu (registry/`ai_runtime`) spustí eval set (reuse `ai_model_benchmarks` + RAGAS judges); bez green evalu se default nemění. Vynuceno gate testem.

---

## 6. Jak to celé zapadá (operating model v jedné větě)
> AISHA volá Anthropic **dvěma governed cestami** — přímé Messages API (stateless, AISHA drží stav) pro definované kroky a Claude Code v Dockeru (one-shot agentic) pro autonomní úkoly — **model vybírá `aisha_resolve_clow_backend` (benchmark-scored, cost/deadline-aware), sync vs batch vybírá `aisha_choose_execution_strategy`**, stav drží AISHA (ne Claude session), citlivá data routuje residency na local. Respektujeme jádro frameworku; dotáhnout zbývá caching + context editing (náš balík) a tři malé doplňky (thinking, per-model prompty, eval-gate).

---

## 7. Dopad na zadání
Přidat do 08 jako necessary (malé, vysoké ROI / governance):
- Extended-thinking/effort do `prepareAnthropicBody` (per purpose).
- Eval-before-migration gate na změnu default modelu.
- Per-model prompt varianty (disciplína + úložiště, reuse existujících prompt assetů).
Vše ostatní (caching, context editing, batch konzistence) už v 08/10/11/12. Žádná nová komponenta — rozšíření builderu + jeden gate + prompt-asset konvence.
