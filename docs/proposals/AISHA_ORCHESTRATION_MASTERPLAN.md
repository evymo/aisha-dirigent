# AISHA Orchestration Masterplan — finální implementační zadání

> **Status:** ZADÁNÍ / IMPLEMENTATION BRIEF — konsolidace analýzy do akceschopného plánu (2026-06-13)
> **Zdroj analýzy a zdůvodnění:** [TREE_OF_THOUGHTS_REFLECTION.md](./TREE_OF_THOUGHTS_REFLECTION.md) (Části A–E).
> **Princip:** *žádný greenfield* — sjednotit a zapnout to, co Aisha už z velké části má. Každá
> chybějící část je explicitně označená a má acceptance criteria. **Dokumentaci neber jako pravdu —
> ověř v kódu a DB, drž SoT.**
>
> Tento dokument je **jediný autoritativní plán** pro implementaci. Části A–E jsou zdůvodnění; sem se
> sbíhá vše do epoch, invariantů a definition-of-done. Co je zde, se zpracuje jako zadání.

---

## 1. Vize v jedné větě

**Aisha je dirigent, který drží otěže; modely, agenti, Claude CLI i lokální výkon jsou zaměnitelný
„sval" — Aisha ho vybírá, řídí (i nákladově), učí se z výsledků a celé to dělá průhledně a dokazatelně,
jako svou prodlouženou součást.**

Čtyři schopnosti, jedna páteř (reflection engine + `clow` kontrakt):

1. **Deliberace** — uvažování jako prohledávání stromu (ToT), ne lineární generování.
2. **Škálování** — paralelní podstromy jako flotila runů (bestie).
3. **Výkon** — libovolný executor (cloud / gateway / lokální offline / Claude CLI / kontejner) za jedním kontraktem.
4. **Samo-řízení + důkaz** — adaptivní volba dle měnících se proměnných, a transparentní, dokazatelné učení.

---

## 2. Jednotná architektura

```
                        ┌──────────────── AISHA — DIRIGENT (otěže) ────────────────┐
   clow (jednotka  ────▶│  CO:    aisha_choose_execution_strategy (sync/batch/mode) │
   delegované práce)    │  KTERÝ: aisha_resolve_clow_backend (skóre+reason)         │
                        │  KOLIK: admission (pre) + budget gate (post) + cancel     │
                        │  PROČ:  decisionProvenance (autorita) + audit             │
                        └───────────────────────────┬──────────────────────────────┘
        resolved = {backend_kind, model_id, strategy, endpoint}        ▲ signály (benchmarks/health/cost/capacity)
   ┌───────────┬───────────┬───────────┬───────────┬───────────┐       │
   ▼           ▼           ▼           ▼           ▼           ▼       │
 llm_sync   llm_batch   local_*    agent_      claude_cli   mcp_      │  ADAPTIVNÍ SMYČKA (Epocha 4)
 (cloud/    (−50 %)     (offline)  container   (kontejner)  server    │  telemetrie → insert_model_benchmark
  gateway)                                                            │  → get_adaptive_model_tiers → routing
   └───────────┴───────────┴───────────┴───────────┴───────────┘       │
                       „SVAL" / hrubá síla → výsledek + tokeny/cost ───┘
                                         │
                                         ▼
        TRANSPARENTNOST & DŮKAZ (Epocha 5): ai_workflow_node_runs (strom vč. prořezaných větví)
        + ai_trace_events (participant RLS) + decisionProvenance → fn_get_run_tree → „vidět dovnitř"
        + ai_model_benchmarks history → fn_compare / champion-challenger → „dokázat učení"
```

Deliberace (ToT) běží **uvnitř** runu (Epocha 1) nebo napříč flotilou runů (Epocha 2); každý
myšlenkový krok i každá větev je **`clow`**, který dirigent nasměruje na sval a zaplatí pod otěžemi.

---

## 3. Kontrakt `clow` — jediný zdroj pravdy

`clow` = jednotka delegované práce. Je to **vstup** `aisha_resolve_clow_backend` (už existuje) a
**společný kontrakt** pro generator, ToT větev, externí executor i adaptivní rozhodnutí.

```ts
interface Clow {
  purpose: string;                 // co se má udělat
  capability_tags: string[];
  task_kind: 'chat'|'analyze'|'report'|'eval'|'code'|'deploy'|…;
  expected_tokens: number;
  deadline_hours: number;          // < 1 urgent (sync) · ≥ 24 batch-eligible
  max_cost_usd: number;            // tvrdý strop nákladu jednotky (Epocha 3 admission)
  allow_batch: boolean;
  allow_local: boolean;            // smí na offline lokální sval
  needs_tools: boolean;
  needs_vision: boolean;
  criticality: 'low'|'medium'|'high'|'critical';
}
// odpověď resolveru: { backend_kind, model_id, strategy, endpoint_url, auth_env_var, score, reasoning, candidates[] }
```

**Pravidlo:** každé volání svalu v platformě prochází `clow` resolucí. `generator` = `clow_dispatch(executor=llm)`;
`tot_expand` = `clow_dispatch × k`; Claude CLI = `clow_dispatch(executor=agent_container)`.

---

## 4. Invarianty & guardrails (best-practices by design)

Nepřekročitelná pravidla; každé má gate test. Platí napříč všemi epochami.

| # | Invariant | Vynucení |
|---|---|---|
| **I1** | **Autorita rozhodnutí** — ToT/routing = `model_heuristic`; **nikdy nepřebije** `core_values`/`compliance_policy` | `decisionProvenance` hierarchie + gate test |
| **I2** | **Resolver je autoritativní** — `clow_backend` ctěn end-to-end; drift (chose≠called) detekován | `LLM_GATEWAY_DISPATCH_INVARIANTS` gate testy |
| **I3** | **Otěže nákladů úplné** — žádný sval neutrácí mimo metering (vč. **Claude CLI**); pre-flight admission u velkých uzlů + post-paid halt + kooperativní abort | `fn_admit_clow`, `fn_check_and_consume_ai_budget_audited`, abort token |
| **I4** | **Quality floor** — levný/lokální se nevybere pod práh kvality pro daný `task_kind` | resolver gate + benchmark |
| **I5** | **Vše auditní** — každý node run + rozhodnutí + dispatch persistován | `ai_workflow_node_runs`, `ai_trace_events`, `decision_provenance` |
| **I6** | **Participant transparentnost** — RLS (vidí jen svou story), PII redakce | RLS policy + `fn_get_run_tree` |
| **I7** | **Vratná autonomie** — změny routingu přes `improvement_proposals` risk gate (low=auto, high=human) + rollback na regresi | `fn_record_proposal_outcome` |
| **I8** | **Žádná tajemství v kódu**; vše za feature-flagem do splnění DoD | `.gitleaks.toml` gate, flag infra |
| **I9** | **Deterministické testy** — mock LLM, žádné flaky | `vitest.gates` |
| **I10** | **Reuse > rebuild** — rozšiřovat (`clow`/resolver/`node_runs`/batch machinery), neforkovat | review |
| **I11** | **Izolace stories** — každý run/cost/trace/viditelnost je per `story_id` + RLS přes `story_participants`; Aishina sebe-správa = `is_stack_default` story na **téže** mašinérii; projekt nevidí cizí data | RLS policies + `story_instances`/`instance_endpoint_bindings` |

---

## 4a. Multi-tenancy & izolace stories (cross-cutting)

**Celý stack běží stejně pro Aishinu vlastní story (sebe-řízení) i izolovaně pro každý projekt/story —
a to je už v architektuře záměrně.** Aishina „vlastní" story = `partner_stories.is_stack_default = true`
(singleton, `partner_id IS NULL`), běží na **téže** mašinérii (`fn_create_workflow_run`, tentýž runner,
tytéž grafy, tentýž `evaluate_story_self`). „Aisha sama na sobě" vs. „Aisha na projektu X" = **jen jiný `story_id`**.

**Izolované per story (vynuceno Postgres RLS přes `ai_runs.story_id` ↔ `story_participants`):**

| Rovina | Mechanismus |
|---|---|
| Runs + strom + traces | `ai_runs.story_id` → `ai_workflow_node_runs`/`ai_trace_events` (přes `run_id`) |
| Náklady | `ai_runs.cost_total_json` + `ai_trace_events.cost_json` per story |
| Rozpočet | `ai_budget(scope_type='story', scope_id=story)` + tvrdý admission gate ve `fn_create_workflow_run` |
| Viditelnost | `participant_read_ai_runs`/`_ai_trace_events`/budget policies; `story_timeline`/`evaluate_story_self` re-check |
| Kontext / pravidla | `story_contexts` (ruleset / MCP endpoint / build / active instance), `story_rulesets` |
| Cíl výpočtu | `story_instances` + `instance_endpoint_bindings` — „stejná služba, jiný backend, jiná story" |

Projekt A **nevidí** runy/náklady/traces projektu B — zeď je join na `story_participants`
(`is_stack_default` je jediná veřejná výjimka: self-management story je čitelná všem přihlášeným).

**Sdílené (globální „mozek") — důležitý nuance:** `ai_model_benchmarks` (učení model×task),
`ai_model_registry`, `ai_provider_registry`, `agent_catalog`, `ai_workflow_definitions` (knihovna grafů)
a rozhodnutí `aisha_resolve_clow_backend`. → **Učení „který model je nejlepší" je jeden globální mozek,
ne per-tenant.** Resolver `story_id` v kontextu dnes **přijímá, ale ignoruje** (řádek je jen v komentáři).

**Design decision:**
- *Default = sdílené učení* je **feature** — každý projekt těží z toho, co se Aisha naučila jinde (efektivní).
- *Ale projekt dnes nemůže izolovat/přebít routing* (např. „jen lokální / EU modely", „vlastní benchmarky",
  „zakázané modely"). Pro **compliance / data-residency / privátní model-set** je to potřeba.

**Volitelná capability „per-story override routing/učení"** (opt-in, mimo základní DoD) = 3 kusy:

1. **Honor `story_id` v resolveru** + **per-story allowlist/preference** tabulka (povolené `backend_kind`/modely,
   vynucené `allow_local`), kterou `aisha_resolve_clow_backend` konzultuje → **Epocha 0/3**.
2. **Scope dimenze na `ai_model_benchmarks`** (`scope`/`story_id`; NULL = globální, jinak per-tenant) →
   per-projektové učení s fallbackem na globál → **Epocha 4**.
3. **Dotáhnout `(backend, story)` seam** — `evaluate_story_self(p_backend)` + `story_instances`/
   `instance_endpoint_bindings` resolver (dnes staged = self-eval PR 8) → izolace cíle výkonu per projekt.

**Doporučení:** default ponech **sdílené učení** (efektivní), per-story override zapni jako **opt-in** pro
projekty s compliance/residency požadavky. Override **nikdy nepřebije** core_values/compliance (I1).

> **Známá mezera (drobná):** `ai_workflow_node_runs` nemá participant RLS policy → per-node detail je dnes
> admin/staff-only i pro vlastní story. Pro „vidět dovnitř" (Epocha 5, `fn_get_run_tree`) je nutné doplnit
> participant policy (zrcadlo `participant_read_ai_trace_events`). Není to únik dat, jen asymetrie viditelnosti.

---

## 5. Konsolidovaná roadmapa — epochy 0–5

Závislosti: **E0 → E1 → { E2, E3 } → E4 → E5** (E2 a E3 částečně paralelně; E5 čerpá z E1/E2/E4).
Vše za feature-flagem; každá epocha má Definition of Done (DoD = akceptační kritéria).

### Epocha 0 — Základy & otěže *(must-do-first)*

**Cíl:** otěže autoritativní, kontrakt formalizovaný, hygiena.
**Deliverables:** dotáhnout wire resolver→executor (`generator`/`clow_dispatch` čtou `state.clow_backend`);
formalizovat `clow` kontrakt (typy + Zod validace) jako SoT; **rotace `AISHA_LLM_GATEWAY_KEY`** + přesun
do secret store + gitleaks gate; zvednout `LANGGRAPH_MAX_ITERATIONS`; feature-flag infrastruktura.
**DoD:** každá dispatch cesta ctí `clow_backend` (gate test; drift < 1 %); žádný `*_KEY=` v `.env.*`
(gitleaks gate zelený); `clow` schema validuje vstup resolveru; flagy fungují.
**Zdroj:** C-PR15, D-PR25(secret), A(config).

### Epocha 1 — Deliberace: single-run ToT *(Část A)*

**Cíl:** uvažování jako prohledávání stromu ve `state.tot`.
**Deliverables:** `ToTState`/`ThoughtNode` typy + Zod enum + registr nodů; **`clow_dispatch`** node
(executor-agnostic spine); `tot_planner` + `tot_expand` (`Promise.all` × k); `tot_evaluate`
(Sure/Maybe/Impossible nad `critic`); `tot_search` (BFS+beam, pak DFS+backtracking); seed
`reasoning-tree-reflect.json`; cost asymetrie (levné na šířku / `verify·maxQuality` na hodnocení) + batch expanze.
**DoD:** ToT graf vyřeší referenční úkol s ověřitelně lepším výsledkem než lineární smyčka; cena řízená
přes `policy.max_expansions` + budget gate; deterministické gate testy (mock LLM); za feature-flagem.
**Zdroj:** A-PR1…PR7, C-PR16(`clow_dispatch`).

### Epocha 2 — Škálování: flotila (Variant B) *(Část B)*

**Cíl:** paralelní podstromy jako child runy řízené dirigentem.
**Deliverables:** parent/child schema (`parent_run_id`/`root_run_id`/`wave_id`, `kind` reasoning_*,
status `waiting_children`); `tot_fanout` (spawn vlny) + child graf `reasoning-branch-reflect.json`;
`tot_join` + `children_suspend` + `waiting_children` suspend/resume (**mirror batch machinery**);
`WF_BRANCH_JOINER` + `persist_branch_results_and_resume` + `/resume-children`; **`WF_BRANCH_SCHEDULER`
+ `fn_admit_branch` (concurrency cap)**; volitelně sandbox dispatch.
**DoD:** dirigent rozjede vlnu K větví, počká (`waiting_children`), složí, prořeže beam, pokračuje;
**concurrency cap drží** (nikdy > `max_concurrent_branches`); sdílený `ai_budget(story)` = fleet strop;
celé resumovatelné po pádu.
**Guardrail:** concurrency cap **musí** být hotový před produkčním během `dispatch≠inproc`.
**Závisí na:** E1. **Zdroj:** B-PR9…PR14, A-PR8.

### Epocha 3 — Výkon: executor plane (externí sval) *(Část C)*

**Cíl:** `clow` → libovolný executor, pod otěžemi.
**Deliverables:** executor `backend_kind` (`agent_container`, `claude_cli`) + řádky v `ai_provider_registry`
+ `Dockerfile.claude-cli` (headless `claude-code` v kata kontejneru); propojit reflection ⇄
`svc-agent-runner` (dispatch branch + join na `agent_runs`); **CLI usage capture → `appendCost`**
(otěže nákladů na CLI); **`fn_admit_clow` prediktivní admission** (odhad `tokens×price` před dispatchem,
tvrdě odmítne nad `max_cost`/budget) + **kooperativní abort** (`AbortSignal` do HTTP / `docker stop`);
offline prod preset + gateway/local batch passthrough.
**DoD:** `clow` poběží jako Claude CLI v izolaci; **usage z CLI je metrováno** (I3); admission odmítne
drahý uzel **před** útratou; `cancel_ai_run` skutečně **přeruší** běžící volání/kontejner; offline preset funkční.
**Závisí na:** E0 (`clow_dispatch`), E2 (join na `agent_runs`). **Zdroj:** C-PR16…PR20, D-PR25(CLI, admission, abort).

### Epocha 4 — Samo-řízení: adaptivní orchestrace *(Část D)*

**Cíl:** Aisha volí sval sama dle měnících se proměnných; preferuje vlastní výkon kde to jde.
**Deliverables:** **feeder produkční telemetrie → `insert_model_benchmark`** (rolling window + EWMA);
spare-capacity signál (lokální `/metrics` → `ai_provider_registry.spare_capacity`) + **adaptivní
`local_bonus`** gated `quality_floor`; **`aisha_decide_execution_mode(clow, signals)`** (per-clow
`local`/`hybrid`/`cloud`, env jako override); **ε-greedy explorer** (balancuje `sample_count`) +
auto-apply low-risk routing přes `improvement_proposals`; autonomy guardrails (quality_floor, budget
ceiling, hysteréze proti oscilaci).
**DoD:** benchmarky se plní z **produkce** (ne jen benchmark běhů); routing se prokazatelně posune s daty;
mód je per-clow dynamický; lokál se preferuje, **když je volný a nad `quality_floor`**; auto-apply jen
low-risk + rollback na regresi (I7).
**Závisí na:** E0 (resolver), E3 (z čeho vybírat). **Zdroj:** D-PR21…PR24, PR26.

### Epocha 5 — Transparentnost & důkaz *(Část E)*

**Cíl:** vidět dovnitř + dokázat učení.
**Deliverables:** `fn_get_run_tree(run_id)` (participant RLS, PII redakce) + **tree/fleet UI**
(prořezané větve = šedé, `parallel_fanout` = flotila); **perzistovat `decisionProvenance`** + panel
„proč model X, autorita Y, co přebil"; **first-class `model_id`/`backend_kind`** na `ai_trace_events`
+ Langfuse deep-link; **`fn_compare_model_benchmarks`** + surface `fn_record_proposal_outcome`
(before/after panel); volitelně **champion/challenger A/B** (`routing_variant` na `ai_runs` + split).
**DoD:** uživatel vidí strom vč. prořezaných větví + flotilu + atribuci „**$X · model Y · via Z**, autorita Z";
before/after panel ukáže delta („tato změna pohnula maturity o +N"); (volitelně) A/B dá kauzální důkaz.
**Závisí na:** E1 (strom), E2 (flotila), E4 (co dokazovat). **Zdroj:** E-PR27…PR31.

---

## 6. Traceability — epocha → původní PR (nic se neztratí)

| Epocha | Konsolidované PR (původní značení) | Dedup poznámka |
|---|---|---|
| E0 | C-PR15, D-PR25(secret), A(config) | secret rotace přesunuta dopředu (hygiena) |
| E1 | A-PR1…PR7 + C-PR16 (`clow_dispatch`) | `clow_dispatch` je spine i pro ToT i pro executory |
| E2 | B-PR9…PR14, A-PR8 | A-PR8 byl „v2 bridge" → splynul do E2 |
| E3 | C-PR16…PR20 + **D-PR25(CLI, admission, abort)** | **CLI usage + admission/abort byly v C i D → sloučeno sem** |
| E4 | D-PR21…PR24, PR26 | bez D-PR25 (přesunut do E0/E3) |
| E5 | E-PR27…PR31 | PR31 (A/B) volitelný |

**Vyřešené překryvy:** CLI usage capture (C-PR18 ∪ D-PR25) → **1× v E3**; prediktivní admission +
kooperativní abort (C-PR19 ∪ D-PR25) → **1× v E3**; secret rotace (D-PR25) → **E0**.

---

## 7. Definition of Done — celý program

Hotovo = všech 6 epoch za splněnými DoD **a** všech 10 invariantů má zelený gate test **a**:

- Aisha **mění výsledek** prokazatelně (ToT větev + adaptivní routing) a změna je **vidět** ve stromu/atribuci.
- **Otěže nákladů jsou úplné** — žádný sval (vč. CLI) neutrácí mimo metering; admission + abort + budget halt fungují.
- **Vlastní zdroje** se používají, když jsou volné a dost dobré (offline mód funkční, lokál preferován pod quality_floor).
- **Učení je dokazatelné** — before/after panel + (volitelně) champion/challenger.
- **Uživatel vidí dovnitř** — strom, flotila, rozhodnutí (proč/autorita), náklady (kolik/jaký sval).
- **Autonomie je vratná** — auto-apply jen low-risk, rollback na regresi, vše auditní.
- **Izolace drží** (I11) — projekt nevidí cizí runy/náklady/traces; Aishina vlastní story = `is_stack_default` na téže mašinérii; (opt-in) per-story override routingu/učení pro compliance/residency.

---

## 8. Top rizika & mitigace (napříč programem)

| Riziko | Epocha | Mitigace |
|---|---|---|
| Necapovaná concurrency položí event-loop | E2 | `WF_BRANCH_SCHEDULER` + `fn_admit_branch` **před** produkcí |
| Slepé místo nákladů (CLI utrácí mimo metering) | E3 | CLI usage capture → `appendCost` (I3) |
| Post-paid přestřelení / nezastavitelný běh | E3 | `fn_admit_clow` pre-flight + kooperativní abort |
| Oscilace adaptivního routingu | E4 | EWMA + hysteréze + `min sample_count` |
| Degradace kvality lokálem kvůli úspoře | E4 | tvrdý `quality_floor` per `task_kind` |
| Auto-apply routingu bez dohledu | E4 | risk gate (low auto / high human) + rollback (I7) |
| Tajemství v repu (`AISHA_LLM_GATEWAY_KEY`) | E0 | rotace + secret store + gitleaks gate (I8) |
| Transparentnost prozradí cizí data | E5 | participant RLS + PII redakce (I6) |
| „Dokázané" učení je jen korelace | E5 | champion/challenger A/B (concurrent) pro kauzalitu |
| Globální „mozek" učení — projekt nemůže izolovat/přebít routing | 4a | default sdílené (feature); opt-in per-story override (scope na benchmarks + allowlist + resolver ctí `story_id`) pro compliance/residency |
| Per-node detail neviditelný i pro vlastní story | E5 | doplnit participant RLS policy na `ai_workflow_node_runs` (zrcadlo trace_events) |

---

## 9. Glosář

- **clow** — jednotka delegované práce; vstup resolveru; společný kontrakt pro každé volání svalu.
- **dirigent / conductor** — Aisha jako řídicí rovina (rozhodnutí + náklady + governance); v Části B i konkrétní `reasoning_conductor` run.
- **executor / „sval"** — zaměnitelný výkon: cloud/gateway model, lokální offline model, Claude CLI, kontejner, MCP.
- **otěže** — řídicí rovina: routing (`resolve_clow_backend`) + strategie (`choose_execution_strategy`) + náklady (admission/budget/cancel) + governance (provenance/audit).
- **bestie** — paralelní flotila runů (Část B): dirigent + branch runy + join bariéra.
- **`waiting_children`** — suspend stav dirigenta čekajícího na vlnu větví (mirror `waiting_batch`).
- **ToT (Tree of Thoughts)** — uvažování jako prohledávání stromu (planner/expand/evaluate/search).
- **quality_floor** — minimální naměřená kvalita modelu pro `task_kind`, pod níž se nevybere ani při tlaku na cenu.
- **champion/challenger** — souběžné A/B routingu pro kauzální důkaz zlepšení.
- **story** — izolovaná jednotka projektu/práce; hranice izolace (runs/cost/traces/budget/viditelnost) přes `story_id` + RLS.
- **stack-default story** — Aishina vlastní story (`is_stack_default = true`, singleton) pro sebe-řízení; běží na téže mašinérii jako tenant stories.
- **per-story override** — opt-in izolace/přebití routingu a učení pro daný projekt (allowlist + scope na benchmarks + resolver ctí `story_id`).

---

> *Toto zadání konsoliduje [TREE_OF_THOUGHTS_REFLECTION.md](./TREE_OF_THOUGHTS_REFLECTION.md) (Části A–E).*
> *Před implementací každé epochy ověř aktuální stav v kódu/DB (SoT); kde se realita liší od analýzy, vyhrává kód.*
