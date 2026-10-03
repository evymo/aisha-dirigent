# Odysseus → AISHA: Inspirační analýza a pre-implementation scope

> **Status:** Draft pro maintainer review · **Datum:** 2026-06-30
> **Zdroj:** `pewdiepie-archdaemon/odysseus@main` (self-hosted AI workspace, AGPL-3.0-or-later)
> **Cíl:** Najít konkrétní *patterny* (ne celé subsystémy), kde se AISHA může přiučit chytřejší přístup k jednotlivým věcem. **Nezjednodušovat celek** — AISHA zůstává enterprise multi-service platforma. Jde o bodové vylepšení s důrazem na **dynamické** (ne hardcoded) řešení.

---

## 1. Co je Odysseus a jak moc se překrývá

**Odysseus** = self-hosted *osobní* AI workspace. Jeden FastAPI monolit (`app.py`) + vanilla JS frontend. Chat/agenti, deep research, dokumenty, e-mail, notes/kalendář, „Cookbook" (lokální serving modelů), MCP, skills, memory, vault. Pro jednoho důvěryhodného uživatele na privátní síti (`THREAT_MODEL.md`: „treat it like an admin console").

| Úroveň | Překryv | Komentář |
|--------|---------|----------|
| **Produkt / idea** | **Nízký** | AISHA = enterprise B2B marketplace + autonomní delivery-lifecycle orchestrátor (Dirigent), multi-tenant, governance, PKI, observability. Odysseus = single-user desktop-ish appka. Jiný trh, jiná škála. |
| **AI engine** | **Střední** | Oba mají agent loop, tool/MCP registry, RAG, deep research, memory, prompt-injection obranu, SSRF guard. AISHA je tu často **sofistikovanější** (kontextové RAG bricky, critic loop, capability-resolver, RAGAS eval). |

**Závěr:** Odysseus pro AISHA **není** referenční architektura ani konkurent. Je to zdroj **izolovaných, dobře ohraničených patternů**. Specy níže berou Odysseus jako *seed nápadů* a reimplementaci navrhují **nativně v TS stacku AISHy** (viz licence).

### Licenční výhrada (důležité)
Odysseus je **AGPL-3.0-or-later**. Inspirace návrhem je v pořádku; **přímé kopírování kódu** vtáhne copyleft do AISHA. Všechny specy předpokládají **clean-room reimplementaci** ve `services/*` / `packages/*`, ne port Python souborů.

---

## 2. Přehledová tabulka patternů

| # | Pattern (Odysseus) | Co AISHA má dnes | Gap / příležitost | Priorita | Effort | Spec |
|---|--------------------|------------------|-------------------|----------|--------|------|
| 1 | **Dynamický top-K výběr toolů** (`tool_index.py` — RAG nad popisy toolů + keyword fallback) | Statický katalog ~42 MCP toolů, **všechny** se posílají do promptu každý turn (`svc-mcp-knowledge/src/routes/mcp.ts`); `shouldDefer` flag existuje ale není použit | Embedovat popisy toolů, retrievovat top-K dle intentu; řeší context-bloat u malých/lokálních modelů | **Vysoká** | M | [01](01-dynamic-tool-selection-rag.md) |
| 2 | **Untrusted-data wrapper + injection policy** (`prompt_security.py`, guard markery, `THREAT_MODEL.md`) | Silný **ingestion-time** scan (`ingestion-safety.ts`) + authority ranking (`knowledgeIntegrity.ts`), ale **v promptu se chunky vkládají bez delimiter guardu** (`orchestrationBridge.ts`); user message se nescanuje | Přidat runtime „data ne instrukce" wrapper + guard-marker escaping + system policy preamble jako druhou vrstvu k ingestion scanu | **Vysoká** | S | [02](02-prompt-injection-untrusted-data.md) |
| 3 | **Adaptivní context budget + auto-kompakce** (`context_budget.py`, `context_compactor.py`) | Token budget se **trackuje ale nevynucuje** (`orchestrationBridge.ts`); model context window se **nediskvouje** (`modelDiscovery.ts` nemá `context_window`); historie ořezaná hardcoded `.slice(-6)` | Odvodit budget z reálného okna modelu; auto-sumarizace staré historie při prahu; přesnější token counting | **Vysoká** | M | [03](03-context-budget-compaction.md) |
| 4 | **Iterativní deep-research smyčka** (`deep_research.py` — Think→Search→Extract→Synthesize, LLM řídí stop) | `criticLoop.ts` dělá 2–4 retrieval iterace (expand_tags / switch_profile), ale **ne** multi-step research s extrakcí faktů a stop-rozhodnutím; Ragnarok je single-shot | Nadstavba nad existující RAG: orchestrace více kol s gap-analýzou a evolving reportem | **Střední** | L | [04](04-deep-research-loop.md) |
| 5 | **Doplňkové patterny** (níže) | viz spec 05 | viz spec 05 | Mix | Mix | [05](05-additional-patterns.md) |
| 6 | **Infra: SearXNG web-search + (ne)Chroma/(ne)ntfy** | pgvector+Ragnarok (vektory), svc-push/RabbitMQ/Matrix (push); **žádný živý web-search** | SearXNG plní díru pro web search ve spec 04; Chroma/ntfy už pokryté líp | Střední | M | [06](06-infra-searxng-web-research.md) |

**Spec 05 obsahuje:** SSRF/URL guard (AISHA má silný `ssrf.ts`, jen ne univerzálně aplikovaný + DNS-rebinding pinning) · Tool-policy / plan-mode (per-turn vypnutí toolů, guide-only) · Memory provider abstrakce (pluggable recall vs. dnešní hippocampus) · Internal-tool loopback auth pattern · Hardware-aware dynamický výběr modelu (cookbook/hwfit vs. dnešní `aisha_resolve_clow_backend`).

---

## 3. Průřezový princip: „vše dynamické"

Společný jmenovatel napříč specy — nahradit hardcoded konstanty runtime-rozhodováním, ale **napojené na existující AISHA infrastrukturu**, ne nový paralelní systém:

- **Tooly** → top-K z embeddingů místo statického katalogu, ale s respektem k `accessTierMin` / `requiresConsent` z `toolBuilder.ts`.
- **Context** → budget odvozený z `ai_model_registry` (přidat `context_window`), ne fixní per-profil číslo.
- **Model selection** → už existuje `aisha_resolve_clow_backend` (RAG purposes); rozšířit princip na tool-selection a context-budgeting, ať je jeden resolver.
- **Research depth** → adaptivní počet kol dle complexity/gap-analýzy, ne fixní iteration cap.
- **Bezpečnost** → injection wrapper a SSRF guard aplikované **na každém untrusted boundary** deklarativně, ne ad-hoc per call-site.

---

## 4. Doporučené pořadí implementace

1. **Spec 02 (injection wrapper)** — nejmenší effort, nejvyšší bezpečnostní páka, čistě aditivní k ingestion scanu. Žádná regrese rizika.
2. **Spec 03 (context budget/kompakce)** — odblokuje dlouhé konverzace a malé modely; vyžaduje přidat `context_window` do model registry (sdílený prerekvizit se spec 01).
3. **Spec 01 (dynamický tool select)** — staví na embedding dispatcher, který už existuje; střední riziko (musí respektovat consent/audit gates).
4. **Spec 05 (doplňky)** — SSRF audit je rychlý a měl by jít hned (security); zbytek dle kapacity.
5. **Spec 04 (deep research)** — největší, staví na 01–03; nejlépe jako poslední, jako nadstavba nad critic loop.
6. **Spec 06 (SearXNG)** — řešit společně se spec 04 (je to jeho web-search backend), až po 05A (SSRF) + 02 (untrusted wrapper). Chroma/ntfy neadoptovat — viz spec 06.

> Každý spec má vlastní sekci **Scope / Out-of-scope / Effort / Rizika / Integrační body / Akceptační kritéria**, aby šel rovnou převést na ticket(y).
