# Spec 04 — Iterativní deep-research smyčka (Think→Search→Extract→Synthesize)

> **Priorita:** Střední · **Effort:** L (≈ 2–3 sprinty) · **Riziko:** Střední
> **Odysseus zdroj:** `src/deep_research.py` (IterResearch-style; clean-room návrhový vzor)

---

## 1. Problém

AISHA má **iterativní critic loop pro retrieval**, ale **ne plnou research orchestraci** s extrakcí faktů, gap-analýzou a LLM-řízeným stop-rozhodnutím.

Evidence (current state):
- `services/svc-ai-chat/src/lib/criticLoop.ts` — když `critic_enabled`: initial retrieval → LLM-judge faithfulness → re-retrieve s `expand_tags` / `switch_profile`, iteration cap ~5. **Re-invokuje stejný `compose_context()` s upraveným dotazem/profilem.**
- `services/svc-mcp-knowledge/src/routes/ragnarok.ts` — hybrid BM25+KNN, **single round-trip**, žádné iterativní re-search.
- `rag-eval-judges.ts` — RAGAS metriky (faithfulness, relevancy, precision, recall), ale **pro eval, ne pro live re-ranking**.

**Co chybí (gap):** multi-step výzkum, kde LLM (a) rozloží otázku na podotázky, (b) hledá přes víc kol/zdrojů, (c) **extrahuje klíčová fakta**, (d) identifikuje **mezery** a doptá se, (e) **syntetizuje evolving report**, (f) **sám rozhodne, kdy přestat**. Critic loop je „zlepši jeden retrieval", deep research je „zodpověz komplexní otázku přes N kol".

---

## 2. Jak to řeší Odysseus (návrhový vzor)

`deep_research.py` — třída `DeepResearcher`, IterResearch-style smyčka (inspirace Alibaba IterResearch):
- **LLM řídí každé rozhodnutí:** co hledat, co je relevantní, co chybí, kdy skončit.
- Cyklus: Think (plán/podotázky) → Search → Extract (relevantní z top pages) → `_synthesize()` (LLM aktualizuje evolving report) → **stop rozhodnutí** (`STOP_PROMPT` — „máš dost na zodpovězení?").
- `current_date_context()` — uzemní generování dotazů na reálné datum (jinak model generuje „best X 2025" když je 2026).
- Veškerý fetchnutý obsah jde přes `untrusted_context_message()` (viz spec 02) — research konzumuje web = untrusted.
- Quality gate: `strip_thinking`, `is_low_quality` filtrují šum.

---

## 3. Best-practice cílový design pro AISHA (dynamický)

**Princip:** **nadstavba nad existující RAG**, ne náhrada. Deep research = orchestrátor, který volá `compose_context()` / Ragnarok / web-fetch jako „search tooly" napříč koly.

### 3.1 Orchestrátor (nový, tenký)
- `runDeepResearch(question, context)` ve `svc-ai-chat` (sedí k reflection vrstvě — ToT/deliberation už tam je):
  1. **Decompose** — LLM rozloží otázku na podotázky (reuse `aisha_resolve_clow_backend('reasoning')`).
  2. **Search kolo** — pro každou mezeru zavolej dostupné zdroje: interní KB (`compose_context`/Ragnarok), volitelně web (přes SSRF guard — spec 05).
  3. **Extract** — LLM vytáhne klíčová fakta z top-K (reuse RAGAS faithfulness jako quality filtr).
  4. **Gap analysis** — co ještě chybí pro zodpovězení? → další kolo.
  5. **Synthesize** — evolving report (auditovaně ukládaný).
  6. **Stop** — LLM-řízené rozhodnutí + **adaptivní hloubka** (dynamický počet kol dle complexity, ne fixní cap).

### 3.2 Dynamičnost (cíl uživatele)
- **Hloubka adaptivní** — jednoduchý dotaz = 1 kolo, komplexní = N kol; rozhoduje gap-analýza + budget, ne konstanta.
- **Zdroje pluggable** — KB / web / specifické MCP tooly jako „research zdroje" vybírané dynamicky (synergie se spec 01).
- **Rozpočet** — research má token/cost/time budget (Langfuse tracking), zastaví se i na limitu, ne jen na „LLM říká dost".

### 3.3 Reuse, ne duplikace
- `criticLoop.ts` se stává **jedním krokem** uvnitř research kola (quality re-retrieval), ne paralelní mechanismus.
- Veškerý externí obsah přes untrusted wrapper (spec 02).
- Date-grounding preamble (Odysseus `current_date_context`) povinně.

---

## 4. Scope

**In-scope:**
- `runDeepResearch()` orchestrátor (decompose → search → extract → gap → synthesize → stop).
- Adaptivní hloubka + research budget (token/cost/time) s Langfuse tracingem.
- Reuse `compose_context`/Ragnarok jako search zdroje + critic loop jako sub-krok.
- Evolving report perzistence (auditovaně).
- Date-grounding + untrusted wrapper na fetchnutý obsah.

**Out-of-scope:**
- Nový web-search subsystém (použít existující/MCP web fetch + SSRF guard).
- Náhrada critic loopu (integruje se jako sub-krok).
- Unified tool+knowledge embedding space (overview gap — samostatně).

---

## 5. Integrační body
- `services/svc-ai-chat/src/lib/criticLoop.ts` (sub-krok)
- `services/svc-mcp-knowledge` `compose_context` / `ragnarok.ts` (search zdroje)
- `services/svc-ai-chat` reflection vrstva (ToT/deliberation — kam research patří)
- `aisha_resolve_clow_backend('reasoning'/'rag.*')` (LLM volby)
- `packages/security` untrusted wrapper (spec 02) + SSRF (spec 05)
- Langfuse (budget/trace research kol)

## 6. Rizika
- **Cost/latence** — multi-kolo = drahé a pomalé. Mitigace: tvrdý budget, adaptivní hloubka, default off / opt-in pro „research" intent.
- **Runaway smyčka** — LLM nikdy neřekne stop. Mitigace: hard cap kol + budget cutoff (Odysseus má i runaway-call detekci v agent loopu — viz spec 05).
- **Injection přes web** — research konzumuje untrusted web. Mitigace: povinný untrusted wrapper (spec 02) + SSRF guard.
- **Halucinace v syntéze** — Mitigace: RAGAS faithfulness gate na extrahovaná fakta, citace zdrojů v reportu.

## 7. Akceptační kritéria
- Komplexní multi-fakt otázka → ≥ 2 kola s gap-driven follow-up; jednoduchá → 1 kolo (adaptivní hloubka prokázána).
- Každé tvrzení v reportu má dohledatelný zdroj (citace).
- Research se zastaví na budget cutoff i když LLM neřekl stop (test).
- Fetchnutý web obsah je obalený untrusted wrapperem (test).
