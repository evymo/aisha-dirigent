---
name: aisha-eval-harness
description: Evaluate AI answer quality in the AISHA platform — eval dataset (golden examples), LLM-as-judge scoring, faithfulness metrics, and vitest regression gates (Roadmap Fáze 3 / WP-07). Use when adding an eval case, running the judge, reading quality metrics ("kvalita odpovědí"), or wiring a regression test gate. Triggers on "evaluation", "eval dataset", "eval harness", "llm judge", "LLM-as-judge", "regression test", "faithfulness", "kvalita odpovědí", "golden examples", "rag eval", "judge model".
---

# AISHA Eval Harness Skill

Eval harness = měření kvality AI odpovědí. V tomto repu už **existují dvě běžící eval pipeline** (nejde o greenfield — Roadmap Fáze 3 je z velké části implementovaná, WP-07 ji dotahuje):

1. **Chat-quality eval** — LLM-as-judge nad chat zprávami. Route `POST /evaluate` v `services/svc-ai-chat/src/routes/evaluate.ts`, skóruje 4 dimenze (relevance, groundedness, safety, coherence), ukládá do `ai_eval_runs` / `ai_eval_results`, golden examples v `ai_golden_examples`. Admin UI: `src/pages/admin/AdminAiEvaluation.tsx` (route `/admin/ai-evaluation`).
2. **RAG eval** — RAGAS-style judge (faithfulness, answer_relevancy, context_precision, context_recall) v `services/svc-mcp-knowledge/src/lib/rag-eval-judges.ts`, orchestrace `POST /rag/eval/run` v `services/svc-mcp-knowledge/src/routes/rag-eval.ts`, golden set v `rag_eval_golden`, výsledky v `rag_eval_runs`, agregace v `rag_eval_baselines`, noční běh `n8n/workflows/WF_RAG_EVAL_NIGHTLY.json` (02:00 UTC) včetně regression detekce + alertu.

Třetí kus: **faithfulness trend** per story z `ai_runs.faithfulness_score_estimate` — hook `src/hooks/useStoryFaithfulnessTrend.ts` + RPC `aisha/db/sql/functions/fn_list_story_faithfulness_trend.sql`.

Tento skill dokumentuje: jak přidat eval case, jak spustit judge, jak číst metriky a jak napojit regression gate na vitest.

## Kdy to platí

| Scénář | Použij tento skill |
|---|---|
| Přidání golden Q/A case do RAG eval setu | **Ano** — seed `31_rag_eval_golden.sql` |
| Označení chat zprávy jako golden example / admin rating | **Ano** — `admin_rate_chat_message` |
| Spuštění LLM-as-judge (single message / RAG batch / nightly) | **Ano** |
| Čtení metrik (faithfulness, baseline, score delta) | **Ano** |
| Nový vitest regression gate pro eval | **Ano** — pattern níže |
| Nová eval tabulka nebo RPC (SECURITY DEFINER, audit) | **Ne** — viz `aisha-rpc` skill (+ `aisha-migration` pro SoT pairing) |
| Výběr/cena judge modelu, slot routing, cost dashboard | **Ne** — viz `aisha-router-tuning` skill |
| Změna nightly workflow (nové nody, schedule) | **Ne** — viz `aisha-n8n-workflow` skill |
| Nový eval HTTP endpoint ve službě | **Ne** — viz `aisha-edge-fn` skill |

## Mapa: co už existuje vs. co vznikne ve WP-07

**Existuje (ověřeno v repu):**

| Vrstva | Chat-quality eval | RAG eval |
|---|---|---|
| Tabulky (SoT) | `aisha/db/sql/tables/ai_eval_runs.sql`, `ai_eval_results.sql`, `ai_golden_examples.sql` | `aisha/db/sql/tables/rag_eval_golden.sql`, `rag_eval_runs.sql`, `rag_eval_baselines.sql` |
| Judge | `services/svc-ai-chat/src/routes/evaluate.ts` (`EVAL_SYSTEM_PROMPT`, temperature 0, JSON-only) | `services/svc-mcp-knowledge/src/lib/rag-eval-judges.ts` (přes `lib/llm-completion.ts`) |
| RPC | `get_eval_runs_admin.sql`, `get_eval_results_admin.sql`, `insert_eval_result.sql`, `create_eval_run_admin.sql` | `fn_get_rag_eval_golden_set.sql`, `fn_record_rag_eval_run_audited.sql`, `fn_compute_rag_baseline_audited.sql`, `fn_get_rag_baseline.sql`, `fn_detect_rag_baseline_regression.sql` |
| Feedback dataset | `chat_messages.user_rating` / `admin_rating` (Roadmap 3.1 hotová); RPC `rate_chat_message.sql` (user thumbs), `admin_rate_chat_message.sql` (admin + `is_golden`) | seed `aisha/db/seed/core/31_rag_eval_golden.sql` (24 Q/A) |
| UI | `src/pages/admin/AdminAiEvaluation.tsx` + `src/hooks/useAiEvaluation.ts` | `src/hooks/useRagBaseline.ts` + `src/pages/admin/AdminAiObservability.tsx` |
| Automatizace | ruční trigger z UI (`useStartEvalRun`) | `n8n/workflows/WF_RAG_EVAL_NIGHTLY.json` |

**Zatím NEEXISTUJE — vznikne ve WP-07** (viz `docs/planning/DELEGATION_PLAN.md` §5 a `docs/AI_AGENT_ROADMAP.md` §3.3):

- RPC `get_golden_examples_for_eval` a `update_message_eval_score` — `evaluate.ts` je volá, ale v `aisha/db/` nejsou (žádný SoT, nejsou ani v baseline). **Batch eval path (`eval_run_id`) je proto dnes nefunkční**; single-message path funguje (persist skóre jen soft-failne přes `.catch(() => {})`).
- Deployment-blocking regression při změně instrukcí agenta (Roadmap 3.3: „blokovat pokud overall_score klesne > 10 %") — DB trigger → enqueue → golden set → approve/rollback flow zatím neexistuje. RAG strana svůj ekvivalent MÁ (`fn_detect_rag_baseline_regression` + alert sub-flow v nightly WF).
- UI vytvoření eval runu — `useCreateEvalRun` / `useGoldenExamples` byly odstraněny při channel-centric migraci (viz komentáře v `src/hooks/useAiEvaluation.ts`); `create_eval_run_admin` SoT existuje, ale nic ho nevolá.

## Jak přidat eval case

### A) RAG golden Q/A (seed-based)

Edituj `aisha/db/seed/core/31_rag_eval_golden.sql` — `INSERT … ON CONFLICT (slug) DO UPDATE` (idempotentní re-seed). Povinná rozhodnutí:

- **`expected_chunk_slugs`**: pokud otázka má jednoznačný zdrojový chunk, vyplň `ARRAY['aisha-…']` reálnými `source_slug` z korpusu (`aisha/db/seed/core/21_aisha_knowledge.sql`) → set-based scoring (zdarma, deterministický, přeskočí 2 LLM cally). Pokud jde o multi-step otázku bez single ground-truth chunku, nech `'{}'::text[]` — to je **JUDGE-ONLY marker**, ne mezera.
- **`context_profile_slug`**: jeden ze 4 profilů (`chat_lightweight`, `repo_plus_rules`, `planning_heavy`, `evidence_strict`), `language` (cs/en), `difficulty` 1–5.

Pak: `npm run db:seed:local` a ověř gate `src/tests/gates/brick0-rag-golden-measurement.gate.test.ts` — hlídá poměr labelled/empty řádků (dnes 20 labelled / 4 judge-only) a že labely míří na reálné slugy. Přidáváš-li judge-only case, gate počty uprav vědomě v témže commitu.

### B) Chat golden example (z reálné konverzace)

Admin UI `/admin/ai-evaluation` nebo přímo hook `useAdminRateMessage` (`src/hooks/useAiEvaluation.ts`) → RPC `admin_rate_chat_message(p_message_id, p_rating, p_review_note, p_is_golden)`. User feedback (thumbs up/down) jde přes `rate_chat_message` → `chat_messages.user_rating`. Golden examples pak žijí v `ai_golden_examples` (očekávaná skóre `expected_relevance` … `expected_coherence`, `is_active` flag).

## Jak spustit judge

```bash
# 1) Single-message chat eval (admin JWT nebo service-role):
curl -X POST "$AI_CHAT_URL/evaluate" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"message_id":"<uuid>"}'
# Z FE jde totéž přes gateway alias: aisha.functions.invoke("evaluate-ai-response", …)
# (mapování: services/gateway/src/routes/functions.ts → svc-ai-chat /evaluate)

# 2) RAG eval batch (service-role only):
curl -X POST "$MCP_KNOWLEDGE_URL/rag/eval/run" -H "Authorization: Bearer $SERVICE_TOKEN" \
  -H 'Content-Type: application/json' -d '{"profile_slug":"repo_plus_rules","limit":10}'
# další endpointy: POST /rag/eval/baseline/recompute, POST /rag/eval/compare, GET /rag/eval/health

# 3) Nightly: WF_RAG_EVAL_NIGHTLY (scheduleTrigger 02:00 UTC) — Run Eval Batch →
#    Log Results → Detect Regressions → Classify → Alert (Matrix/Slack) → Audit Log
```

Judge model se NIKDY nehardcoduje: `evaluate.ts` používá `resolveDefaultModel('evaluation')` + `resolveAvailableModel()` (`services/svc-ai-chat/src/lib/defaultModel.ts`, `lib/llmRouter.ts`) — judge běží na provideru, který instance skutečně má. Každý dispatch jde přes `journalDispatch` a residency check (`detectDataSensitivity`).

## Jak číst metriky

- **Chat**: `ai_eval_results` (4 skóre 0–1 + `overall_score` + `reasoning` + `evaluator_model`), agregace per run v `ai_eval_runs` (`avg_*`, `score_delta` vůči `previous_run_id`). RPC `get_eval_runs_admin` / `get_eval_results_admin`, UI `AdminAiEvaluation.tsx`.
- **RAG**: `rag_eval_runs` per case, rolling agregace `rag_eval_baselines` přes `fn_get_rag_baseline`; regrese klasifikuje `fn_detect_rag_baseline_regression` — severity `ok`/`warning`/`critical` (warn 0.02 ≈ 2,5 %, crit 0.05 ≈ 5 % pokles; viz gate `wp-1-6-ragas-nightly-eval.gate.test.ts`).
- **Faithfulness trend**: `useStoryFaithfulnessTrend` — tiery `high ≥ 0.85`, `medium ≥ 0.6`, `low < 0.6` (`faithfulnessTierFor`). Stejné prahy drž i v nových UI (gate `wp-1-5-faithfulness-ui.gate.test.ts`).

## Napojení na vitest gates (regression pattern)

Eval gates jsou **statické** — CI běží bez živé DB, takže gate čte SoT soubory (seed, SQL, routes, workflow JSON) a vynucuje invarianty. Kanonický vzor: `src/tests/gates/rag-eval-foundation.gate.test.ts` (tabulky + RPC security pattern + route + workflow + seed + hook, vše přes `fs.readFileSync` + regex/JSON parse). Nový eval gate = `src/tests/gates/<name>.gate.test.ts`, node environment, config `vitest.gates.config.ts` (timeout 120 s, paralelní workers).

| Gate | Co hlídá |
|---|---|
| `src/tests/gates/rag-eval-foundation.gate.test.ts` | celá RAG eval infrastruktura je zapojená |
| `src/tests/gates/brick0-rag-golden-measurement.gate.test.ts` | golden set je labelled, scorer set-based matching, corpus mirror |
| `src/tests/gates/wp-1-6-ragas-nightly-eval.gate.test.ts` | regression RPC + alert sub-flow v nightly WF |
| `src/tests/gates/wp-1-5-faithfulness-ui.gate.test.ts` | faithfulness trend UI kontrakt |
| `src/tests/gates/story-self-eval.gate.test.ts`, `self-eval-e2e-contract.gate.test.ts` | story self-eval kontrakty |

Runtime proof (skutečné skórování) patří do integration testů služby, ne do gates — vzor: `services/svc-mcp-knowledge/src/tests/rag-eval-judges.unit.test.ts` (judge logika) + `services/svc-mcp-knowledge/src/tests/rag-eval-routes.integration.test.ts` (eval routes runtime). Pozor: `npm run test:integration:rag-eval` navzdory názvu spouští `rag-embedding-resolver.integration.test.ts` (embedding retrieval), NE judge/scoring path.

## Common pitfalls

❌ Spoléhat na batch path `POST /evaluate {eval_run_id}` — RPC `get_golden_examples_for_eval` zatím neexistuje, vznikne v WP-07
❌ Upgrade judge modelu bez zápisu do run metadata → „fantomová regrese" (skóre nejsou srovnatelná; viz determinism poznámka v `rag-eval-judges.ts` — temperature 0 + pinned `judge_model`)
❌ Vyplnit `expected_chunk_slugs` vymyšlenými slugy — musí existovat v korpusu, jinak recall = 0 a brick0 gate spot-check selže
❌ Považovat prázdné `expected_chunk_slugs` za chybu — u planning_heavy je to záměrný JUDGE-ONLY marker
❌ Volat judge přímo přes provider SDK — vždy `unifiedChat`/`resolveAvailableModel` (chat) resp. `chatCompletionWithRetry` (RAG), jinak chybí dispatch journal, residency check a fallback chain
❌ Nová eval tabulka/RPC bez SoT párování — viz `aisha-migration`; baseline `aisha/db/migrations/00000000000000_baseline.sql` se needituje ručně
❌ Seed bez `ON CONFLICT (slug) DO UPDATE` — re-seed pak duplikuje řádky
❌ Gate, který potřebuje živou DB — gates jsou statické; runtime ověření patří do `test:integration:*` nebo pgTAP (`aisha/db/tests/schema/`)

## Gates / validace

```bash
npm run test:gates                       # celá gate suita (AISHA_SKIP_ONLINE=1)
npx vitest run --config vitest.gates.config.ts src/tests/gates/rag-eval-foundation.gate.test.ts
npx vitest run --config vitest.gates.config.ts src/tests/gates/brick0-rag-golden-measurement.gate.test.ts
npx vitest run --config vitest.gates.config.ts src/tests/gates/wp-1-6-ragas-nightly-eval.gate.test.ts
npm run db:seed:local                    # po změně 31_rag_eval_golden.sql
npm run test:integration:rag-eval        # throwaway DB + postgrest (embedding resolver harness, ne scoring)
# runtime proof skórování (judge/eval routes) — spusť přímo v service:
# cd services/svc-mcp-knowledge && npx vitest run src/tests/rag-eval-routes.integration.test.ts
```

## Související

- **`aisha-rpc`** — nové eval RPC (SECURITY DEFINER + REVOKE/GRANT + audit) a úpravy eval tabulek
- **`aisha-migration`** — SoT párování pro schema změny (`aisha/db/sql/` ↔ migrace)
- **`aisha-router-tuning`** — cena/slot judge modelu, cost dashboard, profil budget/balanced/maxQuality
- **`aisha-n8n-workflow`** — úpravy `WF_RAG_EVAL_NIGHTLY` a nové autonomní eval smyčky
- **`docs/AI_AGENT_ROADMAP.md`** §3.1–3.3 a **`docs/planning/DELEGATION_PLAN.md`** §5 (WP-07) — co se dotahuje
