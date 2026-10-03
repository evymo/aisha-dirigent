# Self-Eval — REUSE_VERIFICATION

> **Status:** VERIFIED (2026-05-31) — code+DB audit, NOT docs.
> **Vzor:** [docs/audience/REUSE_VERIFICATION.md](../audience/REUSE_VERIFICATION.md) — *„z 5 plánovaných tabulek přežila 1".*
> **Pro:** PR 1 of [STORY_SELF_EVALUATION_LOOP.md](STORY_SELF_EVALUATION_LOOP.md). Žádné schéma nevznikne, dokud tato verifikace neprokáže, co aisha už má.
> **Metoda:** každý řádek ověřen `rg`/`Read` ve `aisha/db/sql/` + `aisha/db/migrations/`. Doc je vstup, ne pravda.

## Verdikt

**PR 1 = 0 nových tabulek.** Genuine delta: **1 view + 1 thin RPC + 1 fix u zdroje.** (`improvement_proposals.outcome` je +1 sloupec, ale až PR 5.)

## Table-by-table

| Self-eval potřeba | Aisha už má? (ověřeno v kódu) | Reuse / Delta |
|---|---|---|
| **Actor** (subjekt evaluace) | `partner_stories` ✓ | **reuse** |
| **Aggregate compute** (skóre) | `get_story_aisha_maturity(p_story_id)` ✓ (`aisha/db/sql/functions/`) | **reuse + fix u zdroje** (ILIKE story_id → proper join; `agent_memories` → `improvement_proposals`). Compute-on-fly. |
| **Aggregate snapshot store** | `user_engagement_metrics` (per `user_id`, ne story) | **NEPOTŘEBA pro MVP** — compute-on-fly stačí. Story-keyed snapshot jen pokud perf vynutí (future, ne PR 1). |
| Dimenze: **faithfulness** | `ai_runs.faithfulness_score_estimate`, `fn_list_story_faithfulness_trend` ✓ | **reuse** |
| Dimenze: **drift** | `drift_state` (story-scoped přes `coolify_app_slots.story_id`) ✓ | **reuse** — read direct |
| Dimenze: **incidents** | `sentry_issue_snapshot`, `correlate_sentry_with_deploys` ✓ | **reuse** — read direct |
| Dimenze: **deploy health** | `story_branch_deploy_rail()`, `coolify_app_slots` ✓ | **reuse** |
| Dimenze: **goal** | `story_goal_state` (acceptance_criteria, loop_iterations) ✓ | **reuse** |
| **Signal pipeline** | `signal_tag_rules` + `audience_process_signal_audited()` (čte `integration_events`) ✓ | **reuse pattern** — ⚠️ drift/sentry **NEjsou** `integration_events` (ověřeno: grep prázdný) → PR 1 čte přímo; bridge na integration_events odložen (viz Delta D3) |
| **Finding/tag na story** | `story_labels` (`resource_type` extensible string) + `audience_tag_resource()` ✓ | **reuse** — `resource_type='story'` |
| **Verdikt záznam** | `story_entries` (`story_id` FK, `entry_type`, `content`, `metadata jsonb`) ✓ | **reuse** — `entry_type='self_eval_verdict'` |
| **Recommended action** | `ai_tasks` (`user_id`, `task_type`, `input jsonb`) ✓ — vzor `audience_admin_create_followup` (assigned→`user_id`, detaily→`input`) | **reuse** — `task_type='self_eval_action'` |
| **Proposal** | `improvement_proposals` — **JEDNA tabulka**, RPC `fn_create_improvement_proposal` + `*_admin` ✓ | **reuse** (reconciliace vyřešena: 1 tabulka, 2 RPC vrstvy) |
| **Outcome opravy** | `improvement_proposals` — sloupec `outcome` **chybí** | **DELTA (PR 5):** `+ outcome jsonb` |
| **Scope** (backend, story) | `study_consultants.scope_type/scope_id`, `context_profiles.data_scope_rule`, `story_instances` ✓ | **reuse** (PR 8) |
| **Verdikt lens** | — neexistuje | **DELTA (PR 1):** `selfeval_story_verdict_v` VIEW (vzor `audience_actor_aggregate_latest_v`) |
| **Verdikt RPC** | — neexistuje | **DELTA (PR 1):** `evaluate_story_self(story_id, backend)` thin RPC |

## Genuine delta (úplný seznam)

| # | Delta | PR | Typ |
|---|---|---|---|
| D1 | `selfeval_story_verdict_v` | PR 1 | VIEW (ne tabulka) |
| D2 | `evaluate_story_self(story_id, backend)` | PR 1 | RPC (thin wrapper, STABLE, read-only) |
| D3 | fix `get_story_aisha_maturity.sql` u zdroje | PR 1 | oprava existující fn |
| D4 | `improvement_proposals.outcome jsonb` | PR 5 | +1 sloupec |
| (deferred) | bridge drift/sentry → `integration_events` (signal pipeline uniformita) | future | rozhodnuto: NE v PR 1 (read direct = menší delta) |

## Ověřovací stopa (code+DB)

- `ai_tasks` SoT NEMÁ `assigned_to`/`due_at` (přestože `MARKETER_FLOW_WALKTHROUGH.md` to tak píše) → `audience_admin_create_followup` packuje do `user_id` + `input jsonb`. **Důkaz, proč ověřovat v kódu, ne v docs.**
- drift/sentry/rollback funkce **neobsahují** `integration_events` zápis (grep prázdný) → signal pipeline je automaticky nezachytí.
- `improvement_proposals` = 1 tabulka (`aisha/db/sql/tables/improvement_proposals.sql`); `fn_create_improvement_proposal` + `*_admin` RPC nad ní.
- `is_admin_or_staff()` existuje (baseline) — RLS dep OK.
- žádná `story_*(metric|aggregate|health|score)` tabulka neexistuje → potvrzeno compute-on-fly.

## Gate důsledek

`story-self-eval.gate.test.ts` ověří mj. **že PR 1 nepřidal žádnou novou tabulku** (assertion proti migracím) — REUSE_VERIFICATION je tím vynucena, ne jen doporučena.
