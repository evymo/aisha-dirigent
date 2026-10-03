# Story Self-Evaluation Loop — uzavření a ověření self-* smyčky

> **Status:** DESIGN — čeká na review (autor: AISHA + maintainer, 2026-05-31)
> **Vrstva:** META-3 — integrační páteř nad META-1 ([AUTONOMOUS_DEPLOY_FLOW.md](../deploy/AUTONOMOUS_DEPLOY_FLOW.md))
> a META-2 ([AISHA_SELF_TOOLING.md](../deploy/AISHA_SELF_TOOLING.md)).
> **Navazuje na:** [dirigent-overlay-pipeline.md](dirigent-overlay-pipeline.md),
> [AISHA-Self-Managing-Organism.md](../AISHA-Self-Managing-Organism.md) (Epochy 1–2 → dokončení, Epocha 4 → seam).
>
> **Architektonický vzor:** [audience modul](../audience/) (#239) — *„evaluation je perspektiva,
> ne entita"*. Self-eval = další universal lens nad existujícími signály, postavený stejnou
> disciplínou (REUSE_VERIFICATION → minimal delta). Viz [ARCHITECTURE.md](../audience/ARCHITECTURE.md),
> [REUSE_VERIFICATION.md](../audience/REUSE_VERIFICATION.md), `aisha/db/migrations/20260523*`.
>
> **Princip:** žádná nová feature — wire-up existujících AISHA schopností do uzavřené,
> ověřitelné smyčky. Chybějící kus = explicitně označen jako AISHA-driven dev story.
> **Dokumentaci neber jako pravdu — ověř v kódu a DB, drž SoT** (viz §4 invariant 7).

---

## TL;DR

AISHA dnes **umí pozorovat sebe** (health + metriky + signály) a **umí navrhovat změny**
(`improvement_proposals`). Ale (1) **neměří, jestli její vlastní oprava zabrala**, (2) nemá
**jeden self-eval verdikt na story** (jen rozházené kusy), (3) její runtime **mozek dohledu
(n8n playbooky) není nasazený**, a (4) tyhle smyčky byly z velké části postavené na **staré
Supabase architektuře** a po migraci na `svc-*` nebyly re-ověřené.

Tento doc definuje **integrační páteř** — RPC `evaluate_story_self(story_id, backend)` — a
**sekvenci 8 malých Forgejo PRs**, které uzavřou smyčku na našem default repu, ověří ji
(gate + live + cold-start + runbook + dashboard + workbench + extension), a položí
**generický seam přes `(backend, story)`**, na který se napojí multi-repo (Epocha 4).

Cílový invariant: *„AISHA dokáže pro libovolnou story na libovolném backendu vyhodnotit
svůj vlastní provoz, navrhnout opravu, ověřit její dopad, a celé to zobrazit ve workbenchi,
extensioně i dashboardu — advisory-only, s human gate na rizikové akce."*

---

## 1. Současný stav — co existuje, co je otevřené

### 1.1 Tři pilíře (existují jako oddělené ostrovy)

| Pilíř | Klíčové artefakty | Stav |
|---|---|---|
| **Self-health** | OTel→Langfuse, Prometheus `/metrics`, `aitg_observability_health_audited`, provider health probe, `drift_state`, `rollback_history`, `coolify_app_slots`, Appsmith Ops dashboard | ✅ funkční |
| **Self-control** (runtime dohled agenta) | 7 advisory hooks + `aisha-supervisor-relay.mjs` + edge fn [`dirigent-supervisor.ts`](../../services/svc-ai-chat/src/routes/dirigent-supervisor.ts) + RPC `dirigent_dispatch_event` / `dirigent_drain_nudges` / `fn_advise_session_router` | ⚠️ **mozek (5 n8n playbooků) NENÍ nasazený** |
| **Self-evaluation** (hodnocení story) | `get_story_aisha_maturity`, `story_timeline`, `fn_list_story_faithfulness_trend`, `story_branch_deploy_rail`, `story_goal_state` | ⚠️ **nesjednoceno do verdiktu** |
| **Auto-návrh oprav** | `improvement_proposals` + `fn_create_improvement_proposal` + `fn_evaluate_proposal_risk` + `approve_improvement_proposal_admin`; `WF_SELF_LEARNING_TRIGGER`/`_LOOP`, `WF_MODEL_ADVISORY` | ⚠️ **konec smyčky (měření výsledku) chybí** |

### 1.2 Kde se smyčka přesně láme

```
Story běží (nasazené tooly/microservices, vázané přes coolify_app_slots.story_id)
   │
   ├─► metriky tečou          ✅ ai_trace_events, Sentry, drift, health, faithfulness, integration_events
   ├─► signály extrahovány      ✅ fn_log_dev_signal, fn_get_trace_anomalies_24h, aitg_drift_alerts
   ├─► EVALUACE story           ⚠️ kusy existují — NESJEDNOCENO do verdiktu  ◄── PR 1
   ├─► návrh opravy             ✅ improvement_proposals  ALE  WF_FIX_PROPOSER ❌ chybí  ◄── PR 4
   ├─► advisory / gate          ✅ advisory-only + risk gate (low=auto, high=human)
   ├─► aplikace                 ✅ auto-apply / rollback (config snapshot)
   └─► MĚŘENÍ VÝSLEDKU          ❌ CHYBÍ — nikdo neměří, jestli oprava pomohla  ◄── PR 5  ← TÍMTO se smyčka uzavírá
```

Plus dvě mozkové mezery:
- **5× `WF_DIRIGENT_*.json` existuje v repu** (`BRIEFING`, `INTENT_ADVISOR`, `COMPLIANCE_PRE_CHECK`,
  `COMPLIANCE_ENFORCEMENT`, `GOAL_EVALUATOR`) ale **není importováno/aktivní v n8n** → runtime
  self-control je dnes jen Vrstva 1 (regex hooky). ◄── PR 2
- **`WF_SENTRY_OBSERVER` je stub** — detekce prahů (`correlate_sentry_with_deploys`: fatal≥3 / errors≥50 /
  users≥100) funguje, ale skutečné zavolání rollbacku je TODO. ◄── PR 3

### 1.3 Temporální vrstvení (kritické riziko)

5-epochový [masterplán](../AISHA-Self-Managing-Organism.md) značí Epochy 0–2 ✅ DONE, ale **obsah je
z 2025-06 a míří na Supabase architekturu** (`supabase/functions/*`, `supabase.functions.invoke`,
`create_improvement_proposal_admin` + `agent_configuration_history`). Mezitím proběhla migrace
na `svc-*` microservices a Supabase je [BANNED](../../CLAUDE.md). Novější svc-era artefakty
(`fn_create_improvement_proposal` + `agent_catalog`, `dirigent-supervisor.ts`) žijí **vedle**
starých. ⇒ První PR musí tyto **reconciliovat** (zjistit, jestli `improvement_proposals` má dvě
sady RPC nad jednou tabulkou, a sjednotit na svc-era kontrakt). „DONE" v masterplánu **neznamená
„funguje na současném stacku"** — proto je re-verifikace jádro tohoto úkolu.

---

## 2. Cílový stav — uzavřená smyčka

```
                    ┌──────────────────────────────────────────────┐
                    │  evaluate_story_self(story_id, backend)       │  ◄── PR 1 (páteř)
                    │  ── jednotný self-eval VERDIKT ──             │
                    │  • maturity (webhook/speed/deploy/compliance) │
                    │  • faithfulness trend                         │
                    │  • open drift / sentry pro story apps         │
                    │  • goal_state (acceptance criteria)           │
                    │  • open + recently-applied proposals          │
                    │  → {score, level, dimensions[], findings[],   │
                    │     recommended_actions[]}                    │
                    └───────────────┬──────────────────────────────┘
            ┌───────────────────────┼───────────────────────────────┐
            ▼                       ▼                                ▼
   surfaced (PR 6/7)        drives proposals               supervises agent (PR 2)
   • workbench panel        • WF_FIX_PROPOSER (PR 4)        • goal_evaluator čte goal_state
   • aisha-dirigent ext     • WF_SENTRY rollback (PR 3)     • briefing čte verdikt na SessionStart
   • Appsmith Ops           • improvement_proposals
            │                       │                                │
            └───────────────────────┴────────────────┬───────────────┘
                                                      ▼
                              proposal applied → po okně RE-EVAL  ◄── PR 5
                              evaluate_story_self → delta(score)
                              → improvement_proposals.outcome {before, after, regressed?}
                              → regrese nad práh ⇒ rollback návrh (advisory/approval)
                                                      │
                                                      ▼
                              generic přes (backend, story)  ◄── PR 8
                              instance_endpoint_bindings / story_instances
                              ── stejná služba, jiný backend, jiná story ──
                                                      │
                                                      ▼
                                       SEAM → Epocha 4 multi-repo (NEXT, ne teď)
```

---

## 3. Architektonická páteř — self-eval jako lens (vzor: audience modul)

### 3.0 Princip: evaluation je perspektiva, ne entita

**Korekce (2026-05-31, maintainer):** nestavět bespoke `evaluate_story_self`, který znovu joinuje
maturity+faithfulness+drift. Audience modul (#239) už je **worked example** přesně téhle úlohy —
*„CRM neexistuje jako entita, je to perspektiva"* — a self-evaluation je **strukturálně totožná**,
jen „Actor" = **story** místo člověka. Self-eval je **další lens nad existující signal-aggregation
vrstvou**, ne paralelní subsystém. Ověřeno v kódu (`aisha/db/migrations/20260523*`), ne v docs.

### 3.1 Mapování univerzálních primitiv (ověřeno v kódu)

| Primitivum (audience) | Audience materializace — **ověřeno v kódu** | Self-eval ekvivalent (reuse) |
|---|---|---|
| **Actor** | `profiles` / `partner_profiles` | **story** (`partner_stories`) — subjekt pozornosti |
| **Signal** | `integration_events`(+`metadata`) → `audience_process_signal_audited()` → `story_labels` + `audit_journal` | operational signály (drift_state, sentry_issue_snapshot, `ai_trace_events` anomálie, `fn_log_dev_signal`) → **stejný pipeline**, `resource_type='story'` |
| **Signal→tag rule** | `signal_tag_rules` (jediná genuinely nová tabulka; `event_type_pattern`→tags) | **reuse** pro operational event→tag (`drift:env_var`, `sentry:fatal`) |
| **Aggregate (store)** | `user_engagement_metrics` (snapshot per `user_id`, **jen pre-computed**, nikdy raw) | story-keyed operational snapshot ve stejném tvaru — NEBO compute přes `get_story_aisha_maturity` (rozhodne REUSE_VERIFICATION) |
| **Aggregate lens (view)** | `audience_actor_aggregate_latest_v`, `audience_actor_tier_v` (derivace tier ze skóre) | `selfeval_story_verdict_v` (level z `maturity_score`) |
| **Overlay** | `story_entries`(notes)+`ai_tasks`(follow-ups)+`story_labels`(tags)+`study_consultants`(assigned) — **žádná nová tabulka** | verdikt → `story_entry`; recommended_action → `ai_task`; stav → `story_label`; **žádná nová overlay tabulka** |
| **Scope** | `study_consultants.scope_type/scope_id`, `context_profiles.data_scope_rule`, `story_ai_sessions.focus_actor_id` | (backend, story) scope přes `story_instances` + **tytéž** scope primitiva |
| **Data source** | svc-source-broker + env + `integration_events` (žádný registry) | existující observers (drift/sentry/health) jako signal sources |

### 3.2 Co z toho plyne pro „verdikt"

`evaluate_story_self` přestává být monolitická RPC a stává se **tenký lens**:
- operational signály se **napojí do existujícího signal pipeline** (`signal_tag_rules` +
  `audience_process_signal_audited`/`audience_log_event`), takže story dostává polymorfní tagy
  (`resource_type='story'`) automaticky — žádný ad-hoc join;
- **view** `selfeval_story_verdict_v` (vzor `audience_actor_aggregate_latest_v`) čte agregát + tagy +
  overlay a derivuje level (jako `audience_actor_tier_v`); `get_story_aisha_maturity` je dimenze;
- **RPC** `evaluate_story_self(story_id, backend)` je jen thin wrapper s `findings`/`recommended_actions`;
- `recommended_action` = `ai_task` (přesně jako audience followup), `finding` = `story_label`/`story_entry`.
- **Fix-at-source:** křehké měření v `get_story_aisha_maturity.sql` (ILIKE story_id; `agent_memories`
  místo `improvement_proposals`) se opraví u zdroje — ale jako dimenze v lens, ne přepis filozofie.

> **PR 1 proto začíná `SELF_EVAL_REUSE_VERIFICATION.md`** (mirror `docs/audience/REUSE_VERIFICATION.md`):
> table-by-table důkaz „co self-eval potřebuje vs co aisha už má" → přidat jen minimal delta
> (kandidát: story-keyed aggregate snapshot + verdikt lens view + `improvement_proposals.outcome`;
> možná i reuse `signal_tag_rules` pro operational signály). 3 kola verifikace jako audience.

### 3.2 Kontrakt (návrh — finalizace v PR 1)

```sql
-- aisha/db/sql/functions/evaluate_story_self.sql  (SoT)
CREATE OR REPLACE FUNCTION public.evaluate_story_self(
  p_story_id uuid,
  p_backend  text DEFAULT NULL   -- NULL = active instance ze story_instances (PR 8)
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
-- @returns {
--   story_id, backend, evaluated_at, period_days,
--   score numeric(0-100), level text,           -- novice|intermediate|proficient|expert
--   dimensions: [{ key, score, weight, evidence }],   -- maturity, faithfulness, deploy, compliance, incidents
--   findings:   [{ severity, kind, ref, summary }],    -- open drift, unresolved sentry, missing acceptance criteria
--   recommended_actions: [{ kind, target, rationale }],-- advisory — NIKDY se neaplikují samy odsud
--   open_proposals: int, applied_proposals_30d: int
-- }
```

- `GRANT EXECUTE TO authenticated, service_role` → volatelné z workbenche, extensiony i n8n.
- **STABLE + read-only** — verdikt nikdy nemutuje stav (advisory-only invariant).
- Backend resolution (PR 8): `p_backend IS NULL` → resolve z `story_instances.is_origin` /
  `instance_endpoint_bindings`; jinak explicitní backend pro cross-instance eval.

### 3.3 Outcome měření (PR 5) — co uzavírá smyčku

`improvement_proposals` rozšířit o `outcome jsonb` a flow:
1. **před** aplikací: snapshot `evaluate_story_self` → `outcome.verdict_before` (vedle existujícího
   config snapshotu v `current_value`);
2. po aplikaci + **okně** (default 24 h, řízeno n8n `WF_PROPOSAL_OUTCOME_REVIEW`): re-run
   `evaluate_story_self` → `outcome.verdict_after`, `outcome.score_delta`, `outcome.regressed bool`;
3. **regrese** nad práh (default −5 bodů nebo nový critical finding) ⇒ `fn_create_improvement_proposal`
   kategorie `rollback` → projde **stejným risk gate** (high ⇒ human approval). Advisory-only:
   smyčka navrhne rollback, neprovede ho tiše.

---

## 4. Invarianty (nesmí se porušit v žádném PR)

1. **Advisory-only** — verdikt i doporučení jsou read-only; jediná akce, která se děje „sama", je
   low-risk přes existující `fn_evaluate_proposal_risk` gate. `goal_evaluator` zůstává jediný
   playbook s `decision: "block"/"continue"`.
2. **Fix-at-source-of-truth** — opravy do `aisha/db/sql/...`, ne do `00000000000000_baseline.sql`;
   generated artefakty (CLAUDE.md, branding baseline, `.claude/*`) se needitují ručně.
3. **Wire-up, ne reinvent** — žádná nová tabulka, kde stačí sloupec; žádný nový observer, kde stačí
   aktivovat existující workflow. Chybějící kus (např. `WF_FIX_PROPOSER`) = explicitní AISHA-driven
   dev story, ne tichá improvizace.
4. **Generic-by-design** — od PR 1 vše parametrizováno `story_id` + (PR 8) backendem. Žádný hardcode
   na `is_stack_default` story ani na náš repo. „Defacto stejné, jiný backend, jiná story."
5. **Gate IS the spec** — každý PR má deterministický gate test; selhání gate = oprava kódu, nikdy
   ne snížení gate / regenerace baseline / `--no-verify`.
6. **Cold-start parita** — smyčka přežije `--wipe`, funguje bez prod hodnot, fail-open na chybějící
   token/endpoint (relay no-op, edge fn 200 `{}`).
7. **Ověř v kódu a DB, ne v docs (SoT)** — dokumentace v tomto repu je **lokálně neaktuální**
   (masterplán = Supabase-era 2025-06; audience BRAINSTORM navrhuje `signals.*`, ale shipovalo se
   `audience_*` v `public`). Každý design krok ověří reálný stav v `aisha/db/sql/` + migracích +
   service kódu + (kde lze) v živé DB. Doc je vstup k ověření, ne pravda.
8. **REUSE_VERIFICATION first (3 kola, jako audience)** — než vznikne JAKÁKOLI nová tabulka/RPC,
   předchází table-by-table důkaz, že aisha to už nemá. Cíl: „z 5 plánovaných tabulek přežije 1".

---

## 5. PR sekvence (8 PRs, Forgejo, malé a nezávisle ověřitelné)

> Pořadí respektuje závislosti (páteř první). Každý PR: **Cíl / Změny / Gate / Live / Risk / Závisí na**.

### PR 1 — Páteř: self-eval lens nad audience primitivy (REUSE_VERIFICATION first)
- **Cíl:** self-eval verdikt jako **lens** (vzor audience), ne bespoke RPC. Nejdřív dokázat reuse,
  pak minimal delta. Oprava fragile měření v `get_story_aisha_maturity` u zdroje. Reconciliace
  starých vs nových `improvement_proposals` RPC.
- **Změny (po REUSE_VERIFICATION):** `docs/audience/`-style `SELF_EVAL_REUSE_VERIFICATION.md`;
  `selfeval_story_verdict_v` view (vzor `audience_actor_aggregate_latest_v`); thin RPC
  `evaluate_story_self(story_id, backend)`; oprava `get_story_aisha_maturity.sql` (proper story_id
  join, count z `improvement_proposals`); operational signály do existujícího signal pipeline
  (`signal_tag_rules` reuse, `resource_type='story'`); **minimal nová delta** (kandidát: story-keyed
  aggregate snapshot — pouze pokud REUSE_VERIFICATION prokáže, že nestačí compute-on-fly).
- **Gate:** `src/tests/gates/story-self-eval.gate.test.ts` — lens view + RPC kontrakt, GRANT
  authenticated+service, RLS, **determinismus proti fixturám**; + gate, že **nevznikla** zbytečná
  nová tabulka (REUSE_VERIFICATION assertion).
- **Live:** `rpcService('evaluate_story_self', { p_story_id })` proti běžícímu stacku → verdikt pro default story.
- **Risk:** low (read-only lens). **Závisí na:** —

### PR 2 — Nasadit + ověřit runtime mozek (5 Dirigent playbooků)
- **Cíl:** aktivovat Vrstvu 2 self-control; re-ověřit na svc-era stacku; opravit zastaralý README.
- **Změny:** import 5× `WF_DIRIGENT_*.json` do n8n (přes self-setup/`WF_SELF_DEPLOY`); update
  [README-dirigent-supervisor.md](../../n8n/workflows/README-dirigent-supervisor.md) (supabase→svc cesty,
  `.sh`→`.mjs` relay); `goal_evaluator` čte `evaluate_story_self` pro `briefing` + acceptance criteria z `story_goal_state`.
- **Gate:** `src/tests/gates/dirigent-playbook-contract.gate.test.ts` — 5 JSON workflows validovaných proti
  dokumentovanému kontraktu (event→playbook map z `dirigent_dispatch_event`, response shape, jen
  goal_evaluator smí `block`). Plus existující `dirigent-supervisor.unit.test.ts`.
- **Live:** `curl -X POST .../webhook/dirigent/<playbook>` každý z 5; fail-open test bez tokenu.
- **Risk:** medium (goal_evaluator může `block` na Stop — gated loop_max=12). **Závisí na:** PR 1 (briefing čte verdikt).

### PR 3 — Sentry-driven rollback ze stubu na funkční
- **Cíl:** uzavřít self-healing detekce→akce; rollback přes existující approval gate.
- **Změny:** `WF_SENTRY_OBSERVER.json` — nahradit TODO za volání `request_rollback` →
  `fn_evaluate_proposal_risk('rollback')` → high ⇒ `WF_APPROVAL_GATE`, jinak řízený rollback.
- **Gate:** test rozhodovací cesty (threshold breach → request_rollback → approval požadováno).
- **Live:** simulovaný sentry payload → `correlate_sentry_with_deploys` → rollback request v `rollback_history` (pending).
- **Risk:** high (rollback = vždy human approval — invariant). **Závisí na:** —

### PR 4 — `WF_FIX_PROPOSER` (genuinely chybí → AISHA-driven dev story)
- **Cíl:** LLM patch návrh z incidentu (sentry/drift signál) → `improvement_proposals`.
- **Změny:** nový `n8n/workflows/WF_FIX_PROPOSER.json` (vzor: `AISHA_SELF_TOOLING.md` factory pattern —
  render přes Anthropic API, validace, do `improvement_proposals` kategorie `bug_fix`/`infrastructure_drift`);
  napojení z `WF_SENTRY_OBSERVER` (rollback NEdoporučen, ale incident existuje) a `WF_DRIFT_OBSERVER`.
- **Gate:** workflow contract test + unit test proposal-creation cesty (dedup, rate-limit, risk eval).
- **Live:** signál → proposal vznikne v `pending` se sane risk levelem.
- **Risk:** low (návrh, neaplikuje). **Závisí na:** PR 1 (verdikt jako kontext promptu).

### PR 5 — Outcome měření ⭐ (uzavírá self-improvement smyčku)
- **Cíl:** AISHA měří, jestli její vlastní oprava zabrala.
- **Změny:** `improvement_proposals.outcome jsonb` (migrace + SoT); `fn_record_proposal_outcome`;
  nový `WF_PROPOSAL_OUTCOME_REVIEW.json` (cron / delay po apply → re-eval → delta → regrese ⇒ rollback proposal).
- **Gate:** test outcome RPC + regrese→rollback rozhodnutí (deterministicky proti fixturám).
- **Live:** aplikuj low-risk proposal na default story → po okně se zapíše `outcome` s delta.
- **Risk:** medium (může spustit rollback proposal — gated). **Závisí na:** PR 1, PR 3.

### PR 6 — Surface ve workbenchi + Appsmith Ops dashboardu
- **Cíl:** operátor vidí verdikt a outcomes.
- **Změny:** React panel „Story Self-Evaluation" (do `AdminStoryLoop`/`AdminOverview` — zůstávají React
  per [AUTONOMY_PLAN](../AUTONOMY_PLAN.md)) volající `evaluate_story_self`; rozšíření Appsmith Ops
  ([APPSMITH_AISHA_OPS.md](../deploy/APPSMITH_AISHA_OPS.md)) o story-eval sekci.
- **Gate:** hook/komponenta unit test + i18n (de/fr/ru/th — žádný EN fallback); `test:repo:fast` scope.
- **Live:** panel renderuje verdikt pro default story; dashboard query vrací data.
- **Risk:** low. **Závisí na:** PR 1.

### PR 7 — Surface ve VS Code extensioně (aisha-dirigent)
- **Cíl:** verdikt v story panelu IDE; „request re-eval" akce.
- **Změny:** `extensions/aisha-dirigent/src/story-service.ts` + story panel — read-only verdikt přes
  live RPC (vzor `fetch-bindings.ts`), fallback na offline.
- **Gate:** extension vitest (`extensions/aisha-dirigent/__tests__/`).
- **Live:** extension v IDE zobrazí verdikt pro `.aisha/story.json` story.
- **Risk:** low (sensor + display, žádná backend duplikace — viz overlay-pipeline §Vrstva 4). **Závisí na:** PR 1.

### PR 8 — Generic přes (backend, story) — seam pro multi-repo
- **Cíl:** „defacto stejné, jiný backend, jiná story"; položit Epocha-4 seam **bez** stavby `external_repositories`.
- **Změny:** `evaluate_story_self` + workflows resolvují cílový backend z `story_instances` /
  `instance_endpoint_bindings` (ne hardcode). Verdikt funguje pro story, jejíž instance míří na jiný endpoint profile.
- **Gate:** test verdiktu pro story s ne-origin instancí (cross-backend resolution).
- **Live:** eval story navázané na druhý instance binding.
- **Risk:** medium (cross-instance auth/SSRF — použít existující SSRF-safe fetch). **Závisí na:** PR 1, PR 5.

---

## 6. Verifikace („ověřit, že to funguje")

Per tvoje zadání — **všechny čtyři osy**, plus workbench/extension/multi-story dostupnost:

| Osa | Jak | Kde |
|---|---|---|
| **Gate test** | Deterministický `*.gate.test.ts` per PR proti seedovaným fixturám | `src/tests/gates/`, CI job v [.forgejo/ci.yml](../../.forgejo/ci.yml) |
| **Live ověření** | curl/RPC proti běžícímu stacku (žádné SSH — Coolify API / n8n / `rpcService`) | `docs/architecture/STORY_SELF_EVALUATION_RUNBOOK.md` (§ live verify, vzor deploy-doc § 0) |
| **Cold-start parita** | `scripts/verify-story-self-eval.sh` po `--wipe`, bez prod hodnot, fail-open | navázat na `verify-cold-start-apply.sh` pattern |
| **Runbook + dashboard** | Runbook + viditelný stav v Appsmith Ops | RUNBOOK doc + PR 6 |
| **Workbench / extension** | Verdikt volatelný a zobrazený z obou (GRANT authenticated) | PR 6 + PR 7 |
| **Další story / backend** | E2E: stejný verdikt pro druhou story na druhém instance bindingu | PR 8 gate + live |

**Finální E2E akceptační kritérium (story_goal_state pro tuto iniciativu):**
> Pro 2 různé story (default + jednu testovací na jiném instance bindingu) AISHA vrátí verdikt,
> z low-skóre dimenze vygeneruje proposal, po aplikaci změří delta, a celé to je vidět ve
> workbenchi, extensioně i dashboardu — vše s green gate v CI a fungující po `--wipe`.

Tato iniciativa se sama řídí jako AISHA story s acceptance criteria → `goal_evaluator` (PR 2)
dohlíží na vlastní dostavbu (rekurze záměrná).

---

## 7. Most k multi-repo (Epocha 4 — explicitně NEXT, ne v této iniciativě)

PR 8 položí generický seam. Multi-repo („stejná služba pro cizí repa") pak = **samostatná
navazující iniciativa**, která na seam napojí:
- `external_repositories` jako first-class entitu (dnes je repo jen vlastnost story: `partner_stories.repo_url`);
- per-repo namespace izolaci knowledge (dnes global/story-scoped);
- push-back generovaných instrukcí přes Forgejo (vzor `WF_AISHA_TOOLING_COMMITTER` z META-2);
- odpověď na otevřenou otázku [AISHA_SELF_TOOLING.md §11.3](../deploy/AISHA_SELF_TOOLING.md) (cross-project skill catalog).

Tato iniciativa to **umožní**, ale **nestaví** — drží scope „uzavřít vlastní repo".

---

## 8. Otevřené otázky / rozhodnutí k potvrzení

1. **Reconciliace `improvement_proposals`** (PR 1): potvrdit, zda stará (`create_improvement_proposal_admin` +
   `agent_configuration_history`) a nová (`fn_create_improvement_proposal` + `agent_catalog`) sada jsou nad
   jednou tabulkou. Pokud ano → sjednotit na svc-era; pokud dvě tabulky → migrace dat.
2. **Outcome okno** (PR 5): 24 h default — dostatečné pro infra opravy? Konfigurovatelné per kategorie?
3. **Regrese práh** (PR 5): −5 bodů skóre nebo nový critical finding — kalibrovat na reálných datech.
4. **Backend auth** (PR 8): cross-instance eval potřebuje per-instance token — z `instance_endpoint_bindings`
   nebo MCP token? (SSRF-safe fetch už existuje.)

---

## 9. Reference

- META-1: [AUTONOMOUS_DEPLOY_FLOW.md](../deploy/AUTONOMOUS_DEPLOY_FLOW.md)
- META-2: [AISHA_SELF_TOOLING.md](../deploy/AISHA_SELF_TOOLING.md)
- Runtime overlay: [dirigent-overlay-pipeline.md](dirigent-overlay-pipeline.md), [README-dirigent-supervisor.md](../../n8n/workflows/README-dirigent-supervisor.md)
- Vize: [AISHA-Self-Managing-Organism.md](../AISHA-Self-Managing-Organism.md) (Epochy), [EPOCHA_2_SELF_IMPROVEMENT.md](../tasks/EPOCHA_2_SELF_IMPROVEMENT.md)
- Maturity páteř: [`get_story_aisha_maturity.sql`](../../aisha/db/sql/functions/get_story_aisha_maturity.sql)
- Story portabilita (seam): [`export_story_bundle.sql`](../../aisha/db/sql/functions/export_story_bundle.sql) (SoT) + [STORY_SYNC_RUNTIME.md](../STORY_SYNC_RUNTIME.md)
