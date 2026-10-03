# AISHA — Master plán dofinalizace orchestrace + multilingvální RAG

> **Status:** plán k exekuci (grounded re-analýzou nad živým kódem, file:line)
> **Princip:** propojit/zautomatizovat EXISTUJÍCÍ logiku — nic nového/hardcoded;
> capability-availability + autonomní rozhodování v celku; každá instalace unikátní.
> **Sekvence:** závislostně řazeno — PR finalize → model self-discovery + OpenClaw → multilingvální RAG.

---

## Fáze 0 — Dofinalizovat rozpracované PR (HNED)

| PR | Stav | Akce |
|---|---|---|
| **#507** CLI-runtime unification | kompletní + ověřený (claude-cli + codex-cli reálně běží, admission+approval+I1, 5 DB testů, offline-green) | ověřit CI zelené → merge-ready |
| **#504** design-verified-hardening | mergeable, ale **2 lanes fail**: Blockchain Integration + AV Integration (pravděpodobně single-runner OOM — viz `ci/svc-test-lanes` serializace) | diagnostikovat reálný fail vs OOM → opravit → zelené → merge |

---

## Fáze 1 — AISHA si SAMA spravuje modely + OpenClaw systematizovaný

### A. Model self-discovery (admin-managed discovery + autonomní REAKTIVNÍ rozhodnutí)
*Princip dle korekcí majitele: discovery je admin-spravovaná/periodická (ne na každý request); AISHA NEtestuje proaktivně jestli modely fungují — REAGUJE (selže→jiný vhodný/retry later); autonomní resolver v celku JE ta inteligence, ne matice „model na co".*

- **A1 — cloud backendy self-load `/v1/models`.** `providers/openai.ts:60`, `anthropic.ts:63`, `gemini.ts:51` přestat zahazovat (`res.body?.cancel()`) → parsovat + vrátit `HealthResult.models` (jako `openai-compat.ts:170`). → admin/periodická `discoverModels` dostane AKTUÁLNÍ modely per provider dle klíčů instance (ne stale seed `20_aisha_backbone.sql:2129`). *Root fix vize A, samostatně shippable, reálně ověřitelné s klíči.*
- **A2 — propojit capability metadata + chybějící providery.** `modelDiscovery.ts:44` předat caps do `upsert_discovered_model` (signatura už je přijímá; chat=true default, reasoning/vision z model-metadata/id, admin refine v administraci) → discovered modely resolvovatelné (`aisha_resolve_clow_backend:151`). + registrovat **xAI backend** (api.x.ai/v1, OpenAI-compat, `XAI_API_KEY`) v `backendRegistry.ts` + grok větev v `resolveProvider` (`llmRouter.ts:190`).
- **A3 — napojit/zautomatizovat REAKTIVNÍ failover.** Dispatch selže → zapsat do registry (`record_provider_health`/`mark_models_unavailable`) → autonomní resolver to PŘÍŠTĚ vyloučí + re-resolvne jiný vhodný / odloží (retry later). Resolver-filtr (`:143-145`) + llmRouter fallback chain (`:420-549`) UŽ existují — propojit feedback. **Smazat hardcoded `BACKEND_FALLBACK_MODEL`** → fallback = capability-availability-derived re-resolve. **Žádný proaktivní self-test, žádná suitability matice.**

### B. OpenClaw (vlastní instance) + executory systematizované do cold-start/doctor/warmup
*Princip: nikdy manuální env — generování/doplňování to nawíruje automaticky každému deploy.*

- **B4 — cold-start derivuje + wiruje OpenClaw.** `aisha-cold-start.sh` (u `:1791`, vzor `AISHA_LLM_GATEWAY_URL`) emit `OPENCLAW_URL=http://aisha-openclaw:<port>` (interní cross-stack, jako `POSTGREST_URL`) + `LANGGRAPH_ENABLE_OPENCLAW`; `docker-compose.coolify-ai-chat.yml` env přidat `OPENCLAW_URL/API_KEY/ENABLE` + SSRF allowlist `aisha-openclaw`; post-deploy POST `/models/discover` + gate `discovered>0`. → `adapters.ts:105` true → `selfRegister.ts` self-enabluje openclaw z reálného stavu (DERIVED, ne hardcoded seed flip).
- **B5 — doctor Phase H „orchestration/executor/models".** `cold-start-doctor.sh` nová fáze (read-only, derived): OpenClaw+gateway reachability (jen když URL resolvuje z kontraktu — absent=INFO), `ai_runtime_registry.adapter_health` enabled-non-human (fail na enabled-but-unhealthy), ≥1 model `eval_status<>'pending'` mimo seed, models due self-test. + `OPENCLAW_URL` do `aisha-env-doctor.mjs` kontraktu.
- **B6 — warmup-generation derivuje interní consumer URL jako first-class topology.** `derive-domains.mjs:587` `formatShellExports` emit `<ID>_URL=http://aisha-<container>:<port>` pro catalog services s interním portem (opraví i `AGENT_RUNNER_URL` passthrough) + mirror `local-presets.mjs:471`. Durabilní obecná forma vize B.

---

## Fáze 2 — Multilingvální RAG + lifecycle embedding modelu (RFC v0.2)

> Závisí na Fázi 1 (model discovery vč. embedding modelů: registry `is_embedding`+`embedding_dimensions`, resolver routuje `rag.embedding` na backend). Pravda skrz jazykové mutace + čerpání z ostatních jazyků + ACL = §6/§7 RFC.

**Klíčová korekce (RFC §3): embedding model NENÍ chat model.** Per-call výběr je správně pro chat, ANTI-PATTERN pro embedding — embedding model je **konstanta indexu** (dotaz i všechny dokumenty týmž modelem, jinak tiché selhání). Změna modelu = **migrace** (dual-column v1/v2 vzor UŽ máme), ne runtime volba. AISHA vybírá STANDARDNÍ model pro korpus jednou **retrieval benchmarkem** (Recall@K/nDCG/MRR), ne LLM-judgem; resolver pak jen **routuje** na jeho backend.

**Cihly (pořadí dle invariantu „model = konstanta indexu"):**
1. **Retrieval-eval harness** — labeled CZ/EN set (dotaz→relevantní chunk, stratifikovaný per jazyk) + Recall@K/nDCG/MRR + p95 latence + cost → **změřit kandidáty** (bge-m3 1024 / Qwen3 2560 / text-embedding-3) → standardní model + dim (**D1**).
2. **Pin standardního modelu jako index-konstanty** — `context_profiles.embedding_model_pref` → `embedding_model`+`embedding_model_version` (enforcement, ne preference); registry `is_embedding`+`embedding_dimensions`; `knowledge_embeddings.model` FK na registry; resolver pro `rag.embedding` ROUTUJE na tento backend (`knowledge-embeddings.ts:319` dnes vždy v1). **Model-match guard** (`mcp_search_*` odmítne dotaz s modelem ≠ korpus) + **coverage gate** (flip na v2 jen při 100 % pokrytí, `fn_get_embeddings_needing_v2` prázdné) + chybějící v2 backfill route.
3. **Locale foundation** — `locale` sentinel `NOT NULL DEFAULT 'global'` na items+chunks+embeddings (dnešní chování beze změny, osa zabudovaná); všech 5+ retrieval/ingest funkcí locale-safe naráz; `source_hash` staleness; tuple-level (`source_type,source_id`) visibility+quarantine.
4. **Locale-aware ingestion** — content node → per `(source, locale)` knowledge_item; locale-aware contextual prefix (prompt v jazyce chunku, ne anglický); per-locale clear (ne smazat všechny locale).
5. **Locale-aware retrieval = pravda skrz jazyky** — `p_locale` **preference-boost** ve skóre (NIKDY hard-filter → pod-přeložené locale by vrátilo prázdno); cross-lingual fallback nese sdílený multilingvální prostor → relevantní info i z OSTATNÍCH jazyků; ILIKE jen same-language, vektor cross-lingválně; dedup `source_concept_id` grouping.
6. **Tier-ACL v retrievalu** — `minimum_tier` + RLS přes `audience_user_meets_tier_requirement` ve `WHERE` (ne v promptu — ten se obejde). Čerpá jen znalosti dle oprávnění přístupu.
7. **Persona/jazyk chat** — odpověď v jazyce tazatele z jeho-jazyk-preferovaného korpusu + provenance deep-link.

**Invarianty (trvalá pravidla):** same-model invariant · model=konstanta indexu (změna=migrace) · embedding hodnocen retrieval metrikami · locale=metadata v jednom indexu · jazyková preference v reranku ne hard-filter · bezpečnost v retrievalu ne v promptu · editorial=multilingual / story=single-language+on-demand překlad · bez hardcodu modelu · model-match guard + coverage gate (tiché porovnání napříč prostory nepřípustné).

### Re-grounding (design-verify proti živému kódu — co RFC trefil a co ne)

Před stavbou ověřeno proti realitě (ne dle dokumentu):
- **První cihla = Brick 0 (backend-agnostic embedding dispatcher + chybějící `POST /embeddings/v2-backfill` route).** RFC tvrdil „brick 0 DONE" — **ověřený misread**: `generateEmbeddings()` je jediný helper, hardcoded na `api.openai.com/v1/embeddings` text-embedding-3-small (`openai-embeddings.ts:15`); žádný Ollama `/api/embed` ani vLLM path; SQL v2 write-side (`fn_get_embeddings_needing_v2` + `insert_knowledge_embedding_v2_audited` halfvec) má **0 TS callerů** → `embedding_v2` se runtime NIKDY nezapíše. Pure TS, ZERO schema delta, reuse template = `llm-completion.ts chatCompletion`. Soft Phase-1 dep (běží na env-fallback modelu). Větev `feat/rag-brick0-backend-agnostic-embeddings`.
- **Embedding v2 (Qwen3/halfvec) je DESIGNED end-to-end ale UNWIRED** (dual-column + `v2_status` + `mcp_search_knowledge_v3` model-pref routing + `embedding_model_pref` existují, ale generation hardcoded v1, v3 má 0 live callerů, pref nečte nikdo, žádný coverage gate) — stejný „designed-but-unwired" pattern → cihly 1/2 = WIRE, ne rewrite.
- **Locale = reálná díra JEN na retrieval-core** (`knowledge_items`/chunks/embeddings + `mcp_search_v2/v3` jsou locale-blind). **NESAHAT na story tabulky** (jsou záměrně locale-agnostické) a **nevymýšlet sentinel** — „single-lang original + per-locale translations" UŽ EXISTUJE na post (`knowledge_posts`/`knowledge_post_translations`) i topic (`knowledge_topics.source_locale`/`knowledge_topic_translations`) vrstvě = reuse-template pro cihlu 3. Break-radius bounded (named-column INSERTy, 0 SELECT *) → plain nullable `ADD COLUMN locale` je non-breaking; NOT NULL DEFAULT 'global' jen pokud chceš data-quality scoping, ne kvůli (falešnému) „silent break".
- **Už hotové — NESAHAT:** v3 v1/v2 branch routing + jeho presence-guard; story_id/visibility/quarantine retrieval gating (SECURITY DEFINER + RBAC + pgTAP `02_rag_isolation_rbac.sql`); dual-column storage; translation tabulky. `aisha_resolve_clow_backend` per-call ranker mis-routing embeddingů přes `rag.embedding` je DORMANT hazard (0 prod callerů) → fix až cihla 2, ne teď.

---

## Průřezové

- **Scope:** Fáze 1+2 na NOVÝCH větvích (#507 zůstává čisté na merge; jen read-only touchpoint na `ai_runtime_registry`). Doporučené pořadí větví: nejdřív model-discovery (A) — embedding discovery je závislost RAG; pak OpenClaw (B); pak RAG (C).
- **Každá cihla:** gate + funkční + **integrační** test (async embedding producent → integrační test čeká na reálné zpracování; cross-lingual retrieval test). Reálné ověření s klíči.
- **Capability-availability + autonomní rozhodování zachováno** všude; nic hardcoded.

---

## Otevřené k rozhodnutí (D1–D5 z RFC + scope)
- **D1** standardní embedding model (změřit). **D2** vícejazyčný retrieval (jeden index+metadata). **D3** uložení locale (sentinel). **D4** RAG bezpečnost (tier-ACL retrieval). **D5** lifecycle (dual-column migrace; resolver routuje).
- Drift-Adapter jako levnější příští migrace? MRL truncation pro férové srovnání kandidátů? Kdo tvoří labeled set per jazyk?

---

# AKTUÁLNÍ STAV — re-grounded 2026-06-26 (zdroj pravdy pro reload kontextu)

> Re-grounded proti ŽIVÉMU kódu/DB (file:line), ne dle původního textu plánu. Tato sekce přepisuje stale snapshoty výše.

## Větve + co shipnuto
- **`feat/rag-brick1-2-embedding-space-resolver`** (14 commitů, `test:gates` 5235/0, **NEpushnuto** — user merguje): RAG brick-1-2 slice (embedding-space resolver) + local-stack hardening + prod-env-doctor parita + multi-IDE bring-up v0.7.0 (vsix/.mcpb/wasm/workbench) + workspace-write safe-patch + gate-regression fixy + bring-up health-reporting (preset-aware container-health + dynamic-port). Detail: [[project_public_preview_hardening_2026-06-26]].
- **`feat/phase1-model-discovery-reactive`** (z předchozí, právě vytvořena): Fáze 1A build BĚŽÍ (model-discovery A1→A2→A3).

## Klíčové korekce (závazné)
- **Eval-runner ≠ proaktivní benchmark.** Málem postaven proaktivní auto-benchmark→ai_model_benchmarks→ranking = ODMÍTNUTÁ "suitability matice" (§A3). REVERTNUTO. Správně: resolver = capability-availability + **REAKTIVNÍ** health (dispatch selže→`record_provider_health`→příště vyloučí→re-resolve) + cost. `latest_eval_score`/`ai_model_benchmarks` NEPLNIT proaktivně.
- **Knowledge = language-agnostic, jazyk = výraz** (ověřeno v kódu): retrieval cross-lingual přes sdílený multilingual embedding prostor (Qwen3 + text-embedding-3-small); `fn_resolve_embedding_model` resolvuje dle **model-id** (NE per-language); per-language osa žije jen v golden+comparison (MĚŘENÍ, ne silování). `p_locale` musí být **preference-boost ve skóre, NIKDY hard-filter**. Odpověď v jazyce tazatele (prod chat answer path: `routes/chat.ts` → `lib/recipientLanguage.ts`; eval: rag-eval.ts:93).

## Fáze 2 — re-grounded per-brick (KORIGUJE §43-60)
- **Brick 0 dispatcher** — ✅ DONE (`embed-dispatcher.ts:108` openai/ollama branch; `generateEmbeddings` = thin delegate, NE hardcoded — §57 STALE).
- **Brick 0 v2 write-side** — ✅ kód DONE / ⬜ autonomie: `POST /embeddings/v2-backfill` (knowledge-embeddings.ts:535→fn_get_embeddings_needing_v2→resolveRagBackend→embed→insert_knowledge_embedding_v2_audited) + integ testy. **Chybí:** n8n `WF_EMBEDDING_V2_BACKFILL` cron (neexistuje) + korpus 0 řádků → nikdy neproběhlo na real datech.
- **Brick 1 harness** (Recall@K/nDCG/MRR) — ✅ DONE (rag-retrieval-metrics.ts + rag-eval.ts dual-space + /rag/eval/compare).
- **Brick 1 labeled golden** — 🟡 PARTIAL: `rag_eval_golden`=24 (12cs/12en) ale **`expected_chunk_slugs={}` u VŠECH** → unscored → `insufficient_data`. **Chybí:** olabelovat 24 řádků proti real korpusu (open: kdo tvoří labeled set).
- **Brick 2 registry cols + fn_resolve_embedding_model** — ✅ DONE.
- **Brick 2 resolver routes rag.embedding** — 🟡 wired-untested (v2-backfill+eval routují; ingest v1 by-design). **Chybí:** e2e proti vLLM Qwen3 s klíči.
- **Brick 2 `embedding_model_pref` PIN enforcement** — ⬜ unwired-designed (sloupec existuje, **0 čtenářů**, write-only). **CORE deliverable:** prod search čte context pref→resolve→embed v tom prostoru→p_model_pref do v3.
- **Brick 2 `knowledge_embeddings.model` FK** — ⬜ absent (plain text default). **Chybí:** FK na ai_model_registry.
- **Brick 2 model-match guard** — ⬜ absent: v3 nemá mismatch-reject → Qwen3 vektor s p_model_pref='v1' tiše porovná proti OpenAI korpusu. **Invariant "tiché cross-space porovnání nepřípustné" NESPLNĚN.**
- **Brick 3 locale foundation** — ⬜ unwired-designed (ADD COLUMN locale na items/chunks/embeddings; reuse-template posts/topics `*_translations` POTVRZEN §59).
- **Brick 4 locale-aware ingestion** — ⬜ unwired-designed (p_locale do upsert_story_knowledge_item_audited; locale-aware contextual prefix).
- **Brick 5 cross-lingual retrieval** — ⬜ unwired-designed (p_locale SCORE-BOOST do mcp_search_v2/v3, nikdy WHERE; vektor cross-lingual, ILIKE same-lang; dedup source_concept_id). **= jádro principu příjemce.**
- **Brick 6 tier-ACL** — ⬜ ABSENT (žádný `minimum_tier` sloupec — brick 6 §49 STALE; story_id/visibility/quarantine RBAC ✅ DONE/do-not-touch, tier predikát se PŘIDÁ do týchž WHERE).
- **Brick 7 persona/jazyk chat** — ✅ prod chat answer path odpovídá v jazyce příjemce (`routes/chat.ts` → `lib/recipientLanguage.ts`: universal BCP47, Intl-derived název jazyka, knowledge ≠ jazyk), otestováno (`recipientLanguage.unit.test.ts`, 29 testů). Drobný TODO: prázdná-odpověď fallback string (`chat.ts:~1063`) je stále cs/en binary.

## RAG e2e verdikt (live, adversariálně ověřeno)
Pipeline **funkční (synthetic-probe)**: resolver→embed(real OpenAI)→retrieve(matching space)→score(1.0)→compare data-driven, language-agnostic, cs/en distinct correct. **ALE reálně:** korpus `knowledge_embeddings=0`, golden unlabeled, v2/Qwen neresolvable (vllm provider is_enabled=f), `/rag/eval/run` 503 (answer/judge models unavailable) → **závisí na Fázi 1**.

## Fáze 1 — wire-up body (capability UŽ existuje, jen propojit; nic hardcoded)
- **A1** ✅běží: providers/{openai,anthropic,gemini}.ts přestat zahazovat `/v1/models` → HealthResult.models (vzor openai-compat.ts).
- **A2** ✅běží: modelDiscovery.ts caps→upsert_discovered_model; **xAI backend** (api.x.ai/v1, XAI_API_KEY) do backendRegistry.ts + grok do resolveProvider (llmRouter.ts).
- **A3** ✅běží: REAKTIVNÍ failover (dispatch→record_provider_health→resolver vyloučí→re-resolve); **smazat BACKEND_FALLBACK_MODEL**; žádný proaktivní test/matice.
- **B4** ⬜: aisha-cold-start.sh derivuje OPENCLAW_URL + compose env + post-deploy /models/discover gate.
- **B5** ⬜: cold-start-doctor.sh Phase H (orchestration/executor/models, derived/read-only).
- **B6** ⬜: derive-domains.mjs formatShellExports emit interní `<ID>_URL` first-class + mirror local-presets.

## Sekvence (závislostně)
1. **Fáze 1A** (běží) → ověřit s klíči → 1B (OpenClaw) → finalizovat+push.
2. **Fáze 2 wire-up** (závisí na 1): labeled golden + v2-backfill cron → měřit D1 → PIN enforcement + model-match guard + FK → bricks 3-5 locale/cross-lingual → brick 6 tier-ACL → brick 7 prod chat. Každá cihla: gate + integrační test + reálné ověření s klíči.
3. **Bounded fixy do B-větve:** ragnarok `AISHA_LLM_GATEWAY_KEY` prázdný (compose `OPENAI_KEY=${AISHA_LLM_GATEWAY_KEY:-}`); mesh-ingress vs element-web host-port `:8081` kolize (port-hygiene dedup).

---

# AKTUÁLNÍ STAV — 2026-06-27 (PR-finalize wave + feedback plane; done-but-unmerged)

> Doplňuje §78 snapshot o posledních ~6 h. Tato sekce = co JE hotové (na disku / v PR) ale ještě NENÍ v gitu/nasazené. Princip beze změny: **dokončení celku + maximální reuse existujících otestovaných komponent; nic nového/hardcoded.**

## Merged do main (`03b37035`)
- #511 news-canvas (GrapesJS content nodes) · #516 polymorfní diskuse (story_entries + entry-type registry) · #517 story_entries cold-start fix · **#519+#520** heals reconcile #516/#512 onto existing DBs (benigní duplikát — `git diff` mezi nimi prázdný) · **#521** seed.compiled.sql regen + entry_type seed · **#522** runtime-block i18n gate root-class.

## Fáze 0 — coherence-audit correctness wave (A–E)
> 6-dimenzionální audit sloučeného mainu → 5 cílených fixů (korektnost/konzistence, žádná nová feature).
- **A** = #519 ✅ **MERGED** — heals reconcile (no-wipe upgrade unblock).
- **B** = #521 ✅ **MERGED** — regen `seed.compiled.sql` + entry_type seed (CI/throwaway discussion bootstrap) + gate teeth.
- **C** = lokální, ready — `web_page` diskuse za `status='published'` (authz díra: draft web_page byl diskutovatelný; sourozenci už filtrují). **baseline-toucher.**
- **D** = #522 ✅ **MERGED** — `builderI18nIntegrity` gate root-class (iteruje `RUNTIME_BLOCK_DEFINITIONS`) + discussion-thread i18n klíče ×6 jazyků + `nodeType` label restructure.
- **E** = lokální, ready — resolver `aisha_resolve_clow_backend` odstranění `LIMIT 10` (false „no backend" / truncation 11. serviceable kandidáta; realizuje A3 *fail-loud jen při skutečné 0*). **baseline-toucher.**

## Feedback plane L0–L1–T1 = #523 (realizuje §87 / A3 REAKTIVNÍ vizi)
> Recovered ze stranded uncommitted (L0 commitnut `--no-verify`, nikdy neotevřen jako PR; L0-c/L1/T1 stranded git-lockem). **Přepsáno do baseline-only** — delta-migrace padaly na ~15 baseline-only gates (`--no-verify` to skryl).
- **L0**: `runtime_dispatch` reálná latence · `fn_get_decision_outcomes` RPC (decision⋈trace⋈run, **single-SoT** nad `ai_decisions`, žádná druhá outcomes tabulka) · `ai_decisions.runtime` CHECK +`'workbench'` (fail-closed dispatch crash fix).
- **L0-c**: per-candidate skóre + `task_kind` do `decision_json` (reuse `fn_record_execution_decision` writer).
- **L1**: `fn_rollup_outcomes_to_benchmark` **REAKTIVNÍ** rollup reálných outcomes → `ai_model_benchmarks` (`source='prod_rollup'`, EWMA) přes existující `insert_model_benchmark` — **NE proaktivně** (§87 splněno; NULL když no-eval, resolver COALESCE respektován).
- **T1**: open-ended `task_kind` registry + `normalize_task_kind`/`fn_observe_task_kind` (non-ossifying — task_kind zůstává volný text, registry POZORUJE, nikdy neomezuje).
- Baseline-only: 6 SoT do baseline + heals reconcile + **0 delta migrací**. Gauntlet green, žádný `--no-verify`. **baseline-toucher.**

## #515 source-broker federation
- Hotová komponenta (5 gates green): opt-in passwordless OTP source-member federation → scoped aisha session. K rebase + merge jako **enhancer** (NEbreaking: `SOURCE_API_URL` unset = no-op).

## Zbývá k DoD (public-preview sign-off)
- **2 Proof Harnesses** (§124 dynamic model/executor decision · §168 multilanguage capability) — **stále specced, NEpostaveno.** Reuse existující test-infra (decision journal + L0-c candidates[], resolver, i18n segments). Oba green na reálném dev backendu = global DoD.
- A-Z integrace proti reálnému dev stacku + public-preview certifikace.

## Baseline-sekvence (POZOR — 3 PR regenerují baseline)
- **C, E, #523** všechny regenerují `00000000000000_baseline.sql` → mergovat **sekvenčně**, každý rebase+`db:init:generate` na aktuální main. Doporučené pořadí: **#523 → C → E** (#523 už open+CI; C/E malé, rebase za ním).

---

# PROOF — Orchestration-Decision Test Harness (NEJDŮLEŽITĚJŠÍ — důkaz že vnitřní logika celého stacku funguje)

> **Smysl (vlastník):** nestačí jednotlivé fáze zelené. Potřebujeme DŮKAZ, že AISHA **dynamicky** zvolí správný model + správný způsob/executor pro daný úkol napříč VŠEMI providery najednou, s transparentním PROČ/JAK/KDY, schematicky ověřitelně na reálném dev backendu — základ pro další tuning schopností stacku. Tím prokážeme, že VEŠKERÁ vnitřní orchestrační logika reálně funguje. **Nic hardcoded — testujeme dynamické volby, ne fixní matici.**

## Co harness dokazuje
1. **Model-volba** (`aisha_resolve_clow_backend`): pro úkol (task_kind × capability_tags × constraints) AISHA vybere model+provider z VŠECH enabled+serviceable kandidátů; vrací `top` + `reasoning` + per-candidate `score` rozpad (bench×0.55 + local_bonus + cost_match + tool/vision) + filter důvody (enabled/health/serviceable/capability/residency/embedding-gate). → assertujeme PROČ.
2. **Executor/runtime-volba** (runtime osa nad backend_kind, `ai_runtime_registry`): `direct_llm` / OpenClaw (clow) / Hermes / CLI (claude-cli/codex-cli) pro daný backend_kind + admission/approval (I1 journaling).
3. **Local vs cloud** (residency/cost/availability): `cloud_forbidden`→on-prem only; `allow_local`+local_bonus; cost_class filtr.
4. **Reaktivní failover** (Fáze 1A-A3): dispatch selže→`record_provider_health`→příště vyloučí→re-resolve (ne hardcoded fallback) — assertovat že re-resolve vybere JINÝ vhodný.
5. **RAG embedding-volba** (Fáze 2): `rag.embedding`→is_embedding model v matching space (index-konstanta, model-match guard).

## Setup — VŠICHNI provideři najednou (mezi kterými AISHA vybírá)
- Enable + serviceable v `ai_provider_registry`: **anthropic, openai, xai, google-genai, llm-gateway, llmgateway-io, local (vllm/ollama když běží)** — klíče z `.env-prod-backup`, discovery (Fáze 1A) naplní reálné modely per provider. Serviceability = `serviceable_slugs` z getAllBackends (live klíče), NE roster.
- Pokrýt i orchestrační povrchy: **n8n workflows + graphs (LangGraph/OpenClaw)** — že volí dynamicky i tam.

## Schematická decision-matice (scénář → expected → actual → trace)
Strukturovaná sada scénářů, každý se ZNÁMÝM očekáváním (známe pravidla+benchmarky), asertovaná proti živému resolveru na dev backendu:
| Osa | Hodnoty (příklady) | Expected (proč) |
|---|---|---|
| task_kind | chat · embedding · reasoning · vision · code · batch | embedding→is_embedding model; reasoning→is_reasoning; vision→is_vision |
| cost/budget | budget<$1 · max_cost>$5 | budget→cost_class=budget; premium jen >$5 |
| residency | cloud_forbidden true/false | true→jen local_ollama/local_vllm (cloud=0 invokací) |
| tools/vision | needs_tools · needs_vision | filtr na is_function_calling/is_vision |
| serviceable | [openai] · [anthropic,xai] · [] | jen providery s klíčem; prázdné=vše |
| local | allow_local true/false | false→hard-exclude local backendy |
| eval | benchmarked vs default-0.5 | bench-driven rank (až D1 labeled + reaktivní health) |

Pro každý řádek: `aisha_resolve_clow_backend(clow, context)` → zachytit `top.provider/model`, `reasoning`, candidate scores + executor/runtime resolution → **assert expected==actual + uložit trace**. Cross-provider: tatáž úloha s různými `serviceable_slugs` → jiný winner = důkaz dynamiky (ne hardcode).

## Forma + reuse
- **Executable def-of-done** stylem omni-acceptance (`OMNI_ACCEPTANCE=1`, CI-isolated) — nová suite `orchestration-acceptance` (gate + integrační, reálné klíče, real dev backend). Každý scénář = řádek matice + trace artefakt.
- Reuse transparentního výstupu resolveru (už vrací reasoning+scores) — harness ho schematicky vytěží + asertuje + agreguje do **decision-report** (pro tuning: které váhy/prahy ladit).
- Pokrýt rozhodovací cesty: `aisha_resolve_clow_backend`, runtime/executor resolver, openclaw_resolve_clow, llmRouter fallback chain, rag.embedding resolver, n8n aishaRpc nodes, graphs.

## Tuning-loop
Decision-report = vstup pro doladění rozhodovacích pravidel (skóre-váhy, cost-class prahy, local_bonus, reaktivní-health TTL). Iterace na reálném dev backendu.

## Závislosti + sekvence
- Závisí na **Fázi 1A** (všichni provideři discovered+resolvable, xAI registrován, reaktivní failover) → pak harness exercizuje NAJEDNOU.
- Eval-driven rank (bench scores) přijde s Fází 2 labeled-golden + reaktivní health — do té doby harness asertuje capability+cost+residency+executor osy (eval osa = default-0.5, asertovat až po D1).
- **TENTO HARNESS = důkaz.** Teprve jeho zelená matice + decision-report prokazují, že celá vnitřní orchestrační logika funguje napříč všemi providery/executory. Klíčový artefakt finalizace.

---

# PROOF (2. pilíř) — Multilanguage Capability Test (knowledge × výraz: jazykově-agnostické info + jazyk příjemce)

> **Smysl (vlastník):** dáme nějaké texty pro **podobu/styl komunikace** (výraz, ustálenost, jazyk příjemce) a v **jiném jazyce systémové informace k odpovědi** (knowledge, fakta) → tím zjistíme, že umíme **správně zkombinovat vše co potřebujeme dohromady podle toho KDY je co smysluplné**. Důkaz principu: **knowledge ≠ jazyk; jazyk = výraz.**

## Co dokazuje (e2e)
AISHA pro dotaz příjemce zkombinuje:
1. **KNOWLEDGE** (systémové info k odpovědi) — retrievnuté **cross-lingválně** ze sdíleného multilingual prostoru, **i když zdroj je v JINÉM jazyce** než dotaz (Brick 0 v2 multilingual + Brick 5 cross-lingual: vektor cross-lingválně, `p_locale` jen score-boost nikdy hard-filter → pod-přeložené jazyky nevrátí prázdno).
2. **VÝRAZ** (podoba/styl komunikace) — odpověď v **jazyce příjemce** s ustáleností/personou (Brick 7: prod chat answer path, ne jen eval harness).
3. **Smysluplná kombinace** — fakta z jazyka X podaná formou/jazykem příjemce Z; AISHA volí KDY je co smysluplné (kdy čerpat cross-lingválně, kdy preferovat same-locale, kdy překládat on-demand vs editorial multilingual).

## Setup
- **Knowledge korpus:** systémové info (fakta) v jazyce X (např. EN) — embeddnuto do sdíleného multilingual prostoru (v2/Qwen3); jazykově-agnostické.
- **Komunikační-forma texty:** styl/persona/ustálenost v jazyce Y (jazyk příjemce) — referenční výrazová vrstva.
- Korpus reálně embeddnutý (běh `/embeddings/v2-backfill` až bude v2 resolvable — Fáze 1 dep) + golden olabelovaný.

## Scénáře (matice jazyků příjemce: cs/en/ru/th/fr/de — vše co překládáme)
| Vstup | Test | Assert |
|---|---|---|
| dotaz v Z o info žijícím jen v X | retrieve cross-lingual (X→Z) | odpověď v Z OBSAHUJE správná X-fakta (knowledge nesmí uniknout kvůli jazyku zdroje) |
| dotaz v Z, info ve více jazycích | `p_locale=Z` boost | preferuje Z-zdroj, ale cross-lingual fallback když Z pod-přeložen (nikdy prázdno) |
| odpověď | jazyk + forma | odpověď v jazyce příjemce Z s ustáleností/personou (ne jazyk zdroje) |
| editorial vs story | invariant | editorial=multilingual, story=single-lang + on-demand překlad |
| ACL | tier-gate (Brick 6) | čerpá jen knowledge dle oprávnění (v retrievalu, ne v promptu) |

Každý scénář → trace (resolved embedding model + rag_space + retrieved chunk slugs + jejich source-locale + odpověď-jazyk) + assert kombinace.

## Závislosti + sekvence
- Závisí na: Brick 0 v2 (multilingual prostor live — v2 resolvable přes Fázi 1 vllm provider), Brick 5 (cross-lingual retrieval + locale boost), Brick 7 (prod chat jazyk příjemce), reálný embeddnutý korpus + labeled golden.
- **Dva pilíře důkazu finalizace:** (1) Orchestration-Decision harness = dynamická volba modelu/executoru napříč providery; (2) Multilanguage Capability = jazykově-agnostické knowledge × jazyk-příjemce výraz. Obě zelené na reálném dev backendu = celý stack prokázán.

---

# ZÁVAZNÉ INVARIANTY + architektura capability-exposure

## Žádné fallbacky — fail-loud (HARD, vlastník)
- **Na žádné fallbacky nehrajeme — NIKDE a NIKDY.** Fallback MASKUJE selhání (něco projde a není správně) → falešně věříme že funguje. Tím že nikde nebude, skutečně odhalíme co nefunguje. **Radši vím o chybě, než aby něco prošlo špatně. Vždy vědět na čem jsme.**
- Jediná "recovery" = **autonomní RE-EVALUACE AISHA**: dispatch selže → `record_provider_health` → AISHA PŘEHODNOTÍ / re-resolvne jiný vhodný / odloží (retry later). Dynamické rozhodnutí, NE hardcoded fallback. Smazat `BACKEND_FALLBACK_MODEL` (A3).
- Resolver na 0 kandidátů → `resolved:false` + reasoning (surfacuje), NIKDY tichý default-pass. Žádný maskující config/env default.
- **Proof harness ASERTUJE fail-loud:** nerezolvovatelný scénář → surfacovaná chyba, ne maskovaný pass. (paměť `feedback_no_fallbacks_fail_loud`)

## AISHA = capability-exposure (symetrický model)
- **AISHA stack vystavuje OpenAI-compatible `/v1`** (omni facade, `services/svc-ai-chat/src/routes/v1-chat.ts`) — konzument (CLI, app, jiná instance) ho volá jako jakéhokoliv OpenAI providera, ale **za interfacem je CELÝ orchestrovaný stack** (dynamická volba modelu/executoru, RAG, agenti, tools, multi-provider). **AISHA je ZÁROVEŇ konzument providerů I provider sám.** (Ne "model jménem aisha".)
- Stejný pattern: **CLI** (claude-cli/codex-cli) = celý agentic backend providera jako služba. "Model" = **vystavené schopnosti**: raw provider model / agentic CLI / aisha-stack-facade.
- **Runtime osa** (`ai_runtime_registry`: direct_llm/clow/openclaw/hermes/cli/workflow/human) NAD backend_kind = executor TYP. Kapabilitní osy nejsou jen chat/embed — i **text/agentic/whole-stack**.
- **Proof harness executor-TYP osa:** AISHA vybírá mezi raw-model / agentic-CLI / aisha-stack-provider dle úkolu → assert + trace. + ověřit že omni `/v1` (AISHA-as-provider) reálně routne přes CELÝ stack (konzument dostane plnou orchestraci za standardním rozhraním — rekurzivně/symetricky).

---

# FÁZE 1A — HANDOFF (stav k refreshi, větev `feat/phase1-model-discovery-reactive`)

**Build (woaiw22xp) se ZASEKL** na verifikaci (~10:53 poslední zápis transcriptu, hung `zsh source` — nejspíš real-key ověření viselo na API; ne code problém). Kód A1+A2+A3 je v tree, NEcommitnutý. Load OK. Procs visí (TaskStop je neumí adresovat — zombie).

## Hotové + zelené
- **A1** (providers self-load `/v1/models`): anthropic/gemini/openai/openai-compat. **A2** (xAI backend + caps): backendRegistry + llmRouter grok + modelDiscovery + nový `xai-backend.unit.test.ts` + `llm-resolution-contract.unit.test.ts`. → 3 test files GREEN (34 testů).
- **A3** (reaktivní failover, no-fallback): `BACKEND_FALLBACK_MODEL` konstanta **SMAZÁNA** ✓ (jen komentáře referují), reaktivní failover zapojen (14 refs `record_provider_health`/re-resolve), `resolveAvailableModel` přepsán na **capability-derived remap** (target z discovered modelů, ne roster; cold/nic-discovered → drží preferovaný = fail-loud). tsc čistý.

## REGRESE k opravě (NEcommitovat dokud red) — 5 testů `llm-capability-availability.unit.test.ts`
- **Diagnóza (ověřeno verify-before-changing):** zdroj je INTENDED design (capability-derived), testy jsou STALE — asertují staré hardcoded remap cíle (gpt-4o-mini/gemini-2.5-flash/grok-2), ale nový remap bere `discovered_models[0]` konfig. backendu; v unit testech discovery neběží → mock backendy bez discovered modelů → remap padá na preferovaný (Received claude-sonnet-4/anthropic). Remap NENÍ zakázaný fallback — je to povolená autonomní re-evaluace na dostupný provider ([[feedback_no_fallbacks_fail_loud]]).
- **Oprava = JEDEN coherentní celek** (ne 3 izolované):
  1. **non-chat-cap fix** `modelDiscovery.ts deriveModelCaps`: `is_chat_capable = !isNonChatModelId(id)` (markery z `models.ts EXCLUDED_PATTERNS`: embedding/whisper/tts/dall-e/realtime/audio/moderation/davinci/babbage) + `is_embedding=/embedding/.test(id)` → discoverModels předá `p_is_embedding`. Sdílený klasifikátor reuse v `models.ts:91`.
  2. **remap bere první CHAT-capable** discovered model (ne `models[0]` — ten může být tts-1) — propojené s 1.
  3. **5 testů přepsat** (ne zdroj): mock discovered modely (chat-capable) + `canServe` per nový design; assert capability-derived remap. Per [[feedback_no_workarounds_rewrite_dont_remove]] obsoleted-by-stack-change = rewrite.
  4. unit testy v `model-discovery.unit.test.ts`: tts-1/whisper-1/text-embedding-3-small → `is_chat_capable=false`; text-embedding-3-small → `is_embedding=true`; **gpt-4o → true (integ test zelený)**.
- Pak: full svc-ai-chat test green → commit → **no-fallback audit** (`stack-health KEYCLOAK_REALM:-aisha` → fail-loud).
