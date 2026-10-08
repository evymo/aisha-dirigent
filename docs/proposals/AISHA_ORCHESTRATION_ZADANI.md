# AISHA Orchestrator — Zadání (Unified Specification)

> **Status:** Authoritative SoT — supersedes the doc corpus below.
> **Owner:** platform owner. **Author:** lead architect (convergence pass).
> **Verified against code:** the full **E0 governance layer (E0.1–E0.7) is merged on `main`** (PR #442) — `decision.ts`, `fn_admit_clow.sql` (4-axis admission), `ai_decisions.sql` + `fn_record_execution_decision.sql` (decision journal), `decision_id` on `ai_trace_events.sql:19`, journaled dispatch in `workflowEngine.ts`, per-graph cap `orchestrator.ts:201`, gitleaks CI. file:line audit.
> **Rozsah ověření:** `[merged]` citace na `decision.ts` / `generator.ts` byly **nezávisle ověřeny** proti committed stavu této větve (`AishaExecutionDecisionSchema` `decision.ts:78`, `mapBackendKindToProvider` `:133`, `resolveModelWithClow` `:175`, `runtime` enum vč. `cli` `:41–48`, generator resolver-first `generator.ts:5,43`). Ostatní odkazy na RPC/tabulky/služby pocházejí z auditovaného korpusu — **potvrď je v kódu při tvorbě příslušného PR** (pravidlo: *verify in code, not docs*).
> **Legend:** `[wire-up]` = extend an existing AISHA capability · `[missing]` = genuinely new, must be flagged, never silently built · `[merged]` = already shipped on `main`.
> **Language convention:** Czech narrative, English technical identifiers preserved (clow, Dirigent, StoryLoop, runtime, ExecutionDecision, …).

---

## 1. Účel & rozsah (Purpose & scope)

Tento dokument konverguje desítky překrývajících se a místy protichůdných analýz/plánů/proposalů do **jediného zdroje pravdy** pro rozšíření AISHA orchestrátoru ve třech osách: **(a) orchestrace agentů**, **(b) evaluační/reflexní grafy**, **(c) učení**. Řídí se vlastní technicko-intent tezí platformy: **AISHA rozhoduje / OpenClaw vykonává / Hermes se učí; žádný node si nevybírá vlastní model.** Severní hvězda: *AISHA je orchestrační AUTORITA nad zaměnitelnými runtime adaptéry — každé dispatch projde rozhodnutím, každé rozhodnutí je zažurnálováno, učení zůstává advisory a člověkem schvalované.*

**Supersedované dokumenty** (jejich tělo se stává historickým; níže uvádím, co z nich zůstává platné):

| Doc | Stav | Co přežívá |
|---|---|---|
| `docs/proposals/TREE_OF_THOUGHTS_REFLECTION.md` | partial | Mapování ToT na reflection graf, batch-mirror fleet pattern, clow contract |
| `docs/architecture/LLM_GATEWAY_DISPATCH_INVARIANTS.md` | **stale** | Pouze provider-catalog tabulka + scoring vzorec + drift-detection idea (tělo „wire broken" je obsolete) |
| `docs/proposals/AISHA_ORCHESTRATION_MASTERPLAN.md` | partial | Epoch struktura E0–E5, 11 invariantů, per-story isolation (executor model nahrazen 3-axis decision.ts) |
| `docs/AISHA_ORCHESTRATION_PLAN.md` | **stale** | nic strukturálního (n8n GPT-4o-as-brain superseded) |
| `docs/AI_AGENT_ROADMAP.md` | **stale** | reflexion/critic vize (už shipnuto), memory-table koncept |
| `docs/N8N_AGENT_ARCHITECTURE.md` | partial | n8n agent topologie + autonomy ladder (Supabase substrate stale) |
| `docs/deploy/AISHA_SELF_TOOLING.md` | shipped | observed-pattern→render→human-gate→commit loop (template pro Hermes) |
| `docs/architecture/dirigent-overlay-pipeline.md` | partial | dispatch seam, goal_evaluator loop, „nepřestavuj brain" zákon |
| `docs/analysis/STORYLOOP_MODULE_ANALYSIS.md` | shipped | product-story datový model (verdict sink) |
| `docs/architecture/STORY_SELF_EVALUATION_LOOP.md` | partial | learning loop master design (PR1/PR5 už LANDED) |
| `docs/architecture/SELF_EVAL_REUSE_VERIFICATION.md` | shipped | reuse-as-lens contract (0 nových tabulek) |
| `docs/architecture/STORY_SELF_EVALUATION_RUNBOOK.md` | partial | E2E verifikační runbook |
| `docs/AISHA-Self-Managing-Organism.md` | vision | dlouhodobá vize (single-n8n-brain superseded) |
| `docs/tasks/EPOCHA_{0,1,2}_*.md` | **stale** | „DONE" = DONE na starém Supabase stacku, ne svc-* |
| `docs/architecture/CAPABILITY_GATES.md` | partial | deploy-time admission DAG (jen Phase 1 shipped) |
| `docs/governance/GOVERNANCE_INDEX.md` | partial | 6 governance principů (paths stale: supabase→aisha/db/sql) |
| `docs/security/OWASP_ORCHESTRATOR.md` | shipped | @aisha/security primitiva (admission je composuje) |
| `docs/planning/global-ai-batch-abstraction.md` | vision | execution-strategy osa (reconcile s ai_batch_jobs, ne greenfield) |
| `docs/v2-specification/*`, `docs/proposals/AGENTIC_BUYERS.md` | adjacent | **JINÝ produkt** (consumer health/commerce) — mimo rozsah orchestrátoru; reuse jen PII-redact + idempotency vzory |

---

## 2. Cílová architektura (Target architecture)

### 2.1 Orchestrační autoritní model

AISHA = **governance/control-plane**, která rozhoduje pro každý unit-of-work (`clow`): WHAT (`aisha_choose_execution_strategy`), WHICH model+transport (`aisha_resolve_clow_backend`), HOW-MUCH (admission + budget gate), WHY (decision journal). „Muscle" je zaměnitelná za **runtime adaptéry**. Tři **ortogonální osy** rozhodnutí (`[merged]` — `decision.ts:41–66`):

| Osa | Hodnoty | Význam |
|---|---|---|
| **runtime** (executor) | `direct_llm` · `openclaw` · `hermes` · `workflow` · `human` · `cli` | KDO úkol vykoná (`cli` = generický driver pro externí CLI — claude-cli i budoucí; konkrétní nástroj nese `agent`/`cli_slug`) |
| **backend_kind** (transport) | `direct_cloud` · `llm_gateway` · `local_ollama` · `local_vllm` · `mcp_server` | JAK se k modelu doručí (jen pro `direct_llm`) |
| **LlmProvider** (model) | anthropic / openai / google-genai / gateway / ollama / vllm | KTERÝ model |

> `llm_gateway` je transport, NE runtime — volání přes gateway je stále `direct_llm`. Tuto disjunkci drží `decision.ts:15–17`; `mapBackendKindToProvider()` (`decision.ts:133`) mapuje transport→provider.

### 2.2 Tok (Task → Learning)

```
                    ┌──────────────────────── AISHA (orchestration authority) ───────────────────────┐
 Task / clow ─────▶ │ ADMISSION COMPOSER          EXECUTION DECISION            DECISION JOURNAL      │
 (purpose,          │ ┌───────────────────┐       ┌────────────────────┐       ┌──────────────────┐  │
  capability_tags,  │ │ spend   [merged]  │       │ aisha_choose_      │       │ ai_decisions     │  │
  criticality,     ─┼▶│ runtime [merged]  │──ask─▶ │   execution_strategy│──────▶│  (decision_id)   │  │
  max_cost)         │ │ internet[merged]  │ allow │ aisha_resolve_     │ persist│ + decision_id on │  │
                    │ │ write   [merged]  │       │   clow_backend     │       │   ai_trace_events│  │
                    │ │ content/consent ✓ │       │ → AishaExecution   │       │  [merged]        │  │
                    │ └─────────┬─────────┘       │     Decision (Zod) │       └──────────────────┘  │
                    │           │deny→blocked     └─────────┬──────────┘                             │
                    └───────────┼───────────────────────────┼────────────────────────────────────────┘
                                ▼                            ▼
                          status='blocked'         ┌─── RuntimeAdapter (runtime axis) ───┐
                          awaiting approval         │ direct_llm | openclaw | hermes |    │
                                                    │ workflow   | human    | cli         │  [interface: missing,
                                                    │ (cli carries cli_slug)              │   adapters lift from RunnerBackend]
                                                    └──────────────┬──────────────────────┘
                                                                   ▼
                                            ┌──────── EVALUATION GRAPH (reflection engine) ────────┐
                                            │ generator → critic → convergence_gate → corrector    │ [merged engine]
                                            │ + ToT v1: tot_planner/expand/evaluate/search          │ [wire-up]
                                            │ + ToT v2: tot_fanout/join, waiting_children fleet      │ [missing]
                                            └──────────────┬───────────────────────────────────────┘
                                                           ▼ close_story event [missing]
                                            ┌──────── LEARNING (Hermes runtime) ───────────────────┐
                                            │ evaluate_story_self → fn_search_learnings →           │ [merged rails]
                                            │ fn_maybe_promote_learning → improvement_proposals →   │
                                            │ (human gate) expert_rules → publish_agent →           │
                                            │ install_agent_as_story                                │
                                            │ DRIVEN BY: HermesAdapter + close_story driver         │ [missing]
                                            └───────────────────────────────────────────────────────┘
```

> **Pozn. (Q5):** nad tímto tokem běží **centrální feedback plane** (§6.4) — výstupy execution/eval/learning ze VŠECH runtimes (`direct_llm`/`openclaw`/`hermes`/`cli`) tečou do `insert_model_benchmark` / `fn_record_proposal_outcome` a zpět do příští `AishaExecutionDecision`; v ASCII diagramu vynecháno pro čitelnost.

### 2.3 Co je ALREADY BUILT vs to-build

**Already built (`[merged]`):**
- `AishaExecutionDecision` Zod SoT + 3 osy + `resolveModelWithClow()` + `mapBackendKindToProvider()` (`decision.ts`).
- Všechny 4 reflection LLM nodes resolver-first: generator/critic/corrector/occipitum (ověřeno `generator.ts:5,43`).
- Reflection graf engine: `NodeTypeSchema` + `NODE_HANDLERS`, `RunRecord.status`, `NodeOutput` (interrupt/batch_suspend), batch suspend/resume.
- Decision SQL surfaces STABLE: `aisha_resolve_clow_backend.sql`, `aisha_choose_execution_strategy.sql`; `governedOrchestration.ts` `GovernanceDecision`.
- Učící rails end-to-end: `evaluate_story_self` → `fn_search_learnings` → `fn_maybe_promote_learning` → `improvement_proposals` → `expert_rules` → `publish_agent` → `install_agent_as_story`.
- Spend admission: `fn_authorize_task_spend` → `status='blocked'`.
- **E0 governance layer (`[merged]` — PR #442, on `main`):**
  - Persisted decision journal: `ai_decisions` table + `fn_record_execution_decision` (VOLATILE wrapper) + `decision_id` on `ai_trace_events` (`ai_trace_events.sql:19`). The `decisionProvenance` id now lands in a durable row instead of going nowhere.
  - Admission Layer composer: `fn_admit_clow` over **4 derived axes** — spend (reuse `fn_authorize_task_spend`) + runtime-availability (`fn_runtime_available` + `ai_runtime_registry`) + capability-match + risk (`fn_compute_clow_risk` + `ai_risk_policies`). Capability-availability, **zero membership allow-lists** (see [[feedback_no_allowlists_capability_availability]]).
  - E0.2b journaled dispatch across `workflowEngine.ts` (every `unifiedChat` site journals); E0.6 per-graph iteration cap (`orchestrator.ts:201` `graph.max_iterations ?? config.maxIterationsPerRun`, schema `types.ts:52`); E0.7 gitleaks secret-scan CI (`.github/workflows/ci.yml`, PR-delta scoped).
- **E1/E3 execution layer (`[merged]` on `main`, sync 2026-06-21):**
  - Single-run ToT v1: `tot_planner` / `tot_expand` / `tot_evaluate` / `tot_search`, `ToTState`, `reasoning-tree-reflect.json`, generated seed row and fullenv tests.
  - RuntimeAdapter registry: `direct_llm`, `openclaw`, `hermes` adapters in `reflection/runtime/adapters.ts`; `runtime-execute` graph derives runtime+model, dispatches, traces, and fails loud on unavailable adapters.

**To-build (net-new stories + wire-up backlog):**
- `[missing]` generic CLI driver + workflow/human adapter hardening (§3.6) — RuntimeAdapter base + direct_llm/openclaw/hermes are already on `main`.
- `[missing]` Distributed child-run fleet (ToT v2: `waiting_children`/`children_suspend` = 0 hits, runner je striktně sekvenční).
- `[missing]` `close_story` driver — the learning rails exist end-to-end; the per-closure trigger (vs today's per-run `evaluate_story_self`) does not.

### 2.4 AISHA jako capability-availability infrastructure (rozhodnutí Q4)

AISHA je **systémová / infrastrukturní vrstva**, která podle **dostupných možností** (registr capabilities × backendů × runtimes) ví, zda a JAK umí naložit s požadavkem nebo výsledkem úkolu. Když žádná dostupná capability nevyhoví → admission **deny / escalate**, ne tichý fallback. Důsledek: execution-strategy (sync · batch · fleet · cli · …) je **capability-availability driven**, ne hardcoded per-provider. `ai_batch_jobs` se proto narovnává na provider-neutral + `decision_id` FK a strategie se vlastní v `aisha_choose_execution_strategy` jako mapování *task requirement → co dostupné backendy umí* (viz §7.2).

---

## 3. Orchestrace agentů (Agent orchestration) — the extension

### 3.1 Generalizace decision SoT na VŠECHNY run loops `[wire-up]`

Dnes je resolver-first vynucený jen ve 4 reflection nodes. Autorita je ale fragmentovaná přes 3 run loops; `workflowEngine.ts` má 14 `unifiedChat` sites s 0 `clow_backend` referencemi.

**Kontrakt (E0.2b):** každý `unifiedChat` call MUSÍ projít `resolveModelWithClow({ clowBackend, cfg, fallbackModel })` z `decision.ts` před voláním — žádný node ani workflow site si nevybírá model přímo. Implementace: extrahovat helper `dispatchLlm(ctx, clow)` který obalí `resolveModelWithClow` + emisi `resolution_source` a nahradit jím všech 14 sites. Gate: `llm-gateway-dispatch.gate.test.ts` rozšířit o assert „0 raw `unifiedChat({ model: … })` mimo `dispatchLlm`".

### 3.2 RuntimeAdapter interface `[merged]` (direct_llm/openclaw/hermes; CLI pending)

Runtime osa má jednotný executor kontrakt v
`services/svc-ai-chat/src/reflection/runtime/adapters.ts`. Současný kontrakt je
runtime-level adapter nad existujícími surfaces:

```ts
// services/svc-ai-chat/src/reflection/runtime/adapters.ts  [merged shape]
export interface RuntimeAdapter {
  readonly runtime: string;
  isAvailable(): boolean;
  execute(work: RuntimeWork): Promise<RuntimeResult>;
}
```

Registry `RUNTIME_ADAPTERS: Record<string, RuntimeAdapter>` je paralelní k `NODE_HANDLERS`.
**Invariant:** adaptér NIKDY nevolá resolver — dostává hotové runtime/model rozhodnutí ze
state (`derived_runtime`, `clow_backend`) a LLM dispatch před voláním modelu žurnáluje.
Chybějící/nevhodný adaptér failuje nahlas, nikdy se tiše nedowngraduje na `direct_llm`.

### 3.3 OpenClaw jako JEDEN adaptér z N `[merged]`

OpenClaw integrace už existuje na node-úrovni: `openclaw_resolve_clow` / `openclaw_plan|sandbox|notify` v `NODE_HANDLERS`. **Nepřidávat paralelní agent-mesh surface** — místo toho je obalit `OpenClawAdapter implements RuntimeAdapter` (`runtime='openclaw'`), který deleguje na tyto nodes + na `dirigent_dispatch_event` SSRF-safe relay (`routes/dirigent-supervisor.ts`). Autonomy ladder (LOW/MEDIUM/HIGH/CRITICAL z N8N doc) se mapuje na admission `ask`/`deny`.

### 3.4 Hermes jako DB-backed adaptér `[merged rail, close_story driver missing]`

`runtime='hermes'` je enum hodnota (`decision.ts`) i adaptér (`hermesAdapter`) nad DB rail
`evaluate_story_self`. Stále chybí produkční `close_story` driver, který Hermese spustí
automaticky při uzavření story; viz §5.

### 3.5 clow contract — fold do existující decision SoT `[wire-up]`

Masterplanův `clow` interface (`purpose`/`capability_tags`/`task_kind`/`criticality`/`allow_local`/`max_cost_usd`) se stane **vstupním schématem** admission+resolveru, NE novou abstrakcí. Reconcile do `decision.ts` jako `ClowSchema` (Zod), který je vstupem do `aisha_resolve_clow_backend`. ToT doc navrhoval `agent_container`/`claude_cli` jako nové *backend_kind* — to je **superseded**: v merged modelu jsou to nové *runtime* hodnoty (executor osa), backend_kind zůstává vyhrazen pro transport.

### 3.6 CLI driver — generický externí-CLI runtime `[missing]` (rozhodnutí Q1)

`runtime='cli'` je **generický driver**, ne hardcoded `claude_cli`. claude-cli je první instance; stejným adaptérem orchestrujeme libovolné budoucí CLI, které se ukáže jako vhodné pro daný typ úkolu — přes **celou šířku logiky a stacku** (decision → admission → journal → eval → learning). Konkrétní nástroj nese pole `agent`/`cli_slug` na `AishaExecutionDecision` (`[merged]` enum `cli` + `cli_slug` v `decision.ts`); osa runtime zůstává čistá.

- `CliRuntimeAdapter implements RuntimeAdapter` (`runtime='cli'`), parametrizovaný `cli_slug`. Spouští přes existující agent-runner sandbox (`RunnerBackend` docker/kata) — **žádný nový execution substrate**.
- **Capability surfacing:** každý registrovaný CLI deklaruje schopnosti/limity (capability_tags, cost model, side-effect class) do capability/registry vrstvy, aby `aisha_choose_execution_strategy` + admission uměly úkol nasměrovat na vhodné CLI **podle task-fit**. To je přesně §2.4 (capability-availability): „je tenhle úkol vhodný pro konkrétní CLI a umíme ho dostupnými prostředky obsloužit?"
- claude-cli cost blind-spot (spend mimo per-node metering) řeší admission **pre-flight estimate** + `cli_slug`-aware budget gate (viz Q2).

#### 3.6.1 Per-CLI knowledge layer `[wire-up]` (reuse, ne nová tabulka)

Capability surfacing (výše) říká „umí tenhle CLI úkol?". Per-CLI **knowledge layer** říká „JAK ho správně řídit" — pravidla, invocation flags, prompt/output konvence, sandbox quirks, do/don't. Žije v **existující** knowledge infrastruktuře, keyed by `cli_slug` (merged field na `AishaExecutionDecision`) — žádná nová tabulka:

| Vrstva | Reuse artefakt | Klasifikace | Klíč |
|---|---|---|---|
| Knowledge set (rules/conventions) | `agent_knowledge_bindings` (agent_slug → `expert_rules`) | `[wire-up]` | `cli_slug` jako agent_slug |
| Runtime načtení knowledge | `mcp_get_agent_knowledge(p_agent_slug)` | `[wire-up]` | extend o `cli_slug` |
| Capability/registry record | `agent_catalog` (slug/purpose/default_model/allowed_tools/denied_tools/safety_level/autonomy_level) + `agent_tools` | `[wire-up]` | `cli_slug` jako catalog slug |
| Authoring/promotion | `expert_rules` + Hermes proposal pipeline (advisory-only, human-gated) | `[merged]` rails | — |

**Kontrakt:** `CliRuntimeAdapter.execute()` MUSÍ před spuštěním načíst per-CLI knowledge (`mcp_get_agent_knowledge(cli_slug)`) + capability record (`agent_catalog` row pro `cli_slug`). Žádný CLI není hardcoded — claude-cli je jen první registrovaný `cli_slug` s vlastním `expert_rules`-backed setem. Usage konvence jsou tím **učitelné** (přes Hermes advisory pipeline), ne zadrátované. Lock: invariant I12 (§9).

**MCP boundary (anti-paralelní-surface, §3.3):** pokud externí CLI sám řídí MCP servery, reusuje existující `mcp_server_registry` / `mcp_get_agent_knowledge` pro svůj tool/knowledge surface — `cli` runtime je **process driver**, NE nová knowledge/tool surface.

---

## 4. Evaluační graf (Evaluation graph) — the extension

### 4.1 ToT v1 — single-run deliberace `[wire-up]` (no migration)

`node_type` je free text (žádný DB CHECK), graph je free JSONB → ToT v1 je čistý wire-up. **Nestavět nový graph engine.** Přidat 4 handlery do `NODE_HANDLERS` + 4 entries do Zod `NodeTypeSchema` + 1 řádek do `ai_workflow_definitions`. Strom žije v `state.tot`.

**Nové node types:**

| Node | Mapuje na ToT fázi | Reuse |
|---|---|---|
| `tot_planner` | decomposition | volitelně `soulforge_classify` na dekompozici |
| `tot_expand` | generate-k | `Promise.all` přes `unifiedChat` (přes `dispatchLlm`); fold přes `executeParallel` (`workflowEngine.ts:664`) |
| `tot_evaluate` | evaluate | tenká vrstva nad `critic` 0..1-per-rule JSON scoring → Sure/Maybe/Impossible |
| `tot_search` | search | BFS/DFS/beam + backtrack; **VŠECHNA policy logika zde** (edge evaluator `evalGuardedExpression` nemá závorky/funkce → edges čtou jen flat `tot_action`/`tot_done`) |

`convergence_gate` (pass/retry/exhausted) a `corrector` (loop-back) se reusují jako branching-factor=1 případ. Graph JSON: `reasoning-tree-reflect.json`.

**`state.tot` shape `[missing]` (typový kontrakt, ne migrace):**
```ts
interface ToTState {
  tree: Record<string, ThoughtNode>;     // id → node
  frontier: string[];                      // active thought ids
  best?: string;                           // best terminal id
  expansions: number;                      // budget counter
  policy: { strategy: 'bfs'|'dfs'|'beam'; wave_width: number;
            sure_threshold: number;        // default 0.80
            impossible_threshold: number;  // default 0.35
            max_expansions: number; }
}
interface ThoughtNode {
  id: string; parent?: string; depth: number;
  content: string; status: ThoughtStatus;  // 'sure'|'maybe'|'impossible'|'unevaluated'
  score?: number;                          // critic 0..1
}
```

### 4.2 Budget + iteration gating `[wire-up]` (E0.6)

- **Iteration cap:** `LANGGRAPH_MAX_ITERATIONS` default 20 je env-only. Přidat **per-graph override** v graph JSON (`max_iterations`) honorovaný v `runWorkflow`; reuse `WF_DIRIGENT_GOAL_EVALUATOR` / `story_goal_state` loop-continuation primitiv (`decision:'continue'`), nestavět nový loop.
- **Budget:** per-story `ai_budget` `FOR UPDATE` řádek auto-serializuje a zastaví celou ToT/fleet (`status='blocked'`) zdarma — `fn_check_and_consume_ai_budget_audited` / `fn_authorize_task_spend`. ToT verdict authority = `model_heuristic` (nesmí přebít `core_values`/`compliance`) per `decisionProvenance` hierarchie.

### 4.3 ToT v2 — distributed child-run fleet `[missing]` (genuinely new)

Záměrně **druhá instance batch suspend/resume patternu** (8 z 11 komponent jsou pojmenované mirrory):

| Fleet komponenta | Mirror batch komponenty | Třída |
|---|---|---|
| `status='waiting_children'` | `waiting_batch` | `[missing]` enum hodnota |
| `children_suspend` (NodeOutput) | `batch_suspend` | `[missing]` |
| `tot_fanout` (spawn wave) | submitBatch | `[missing]` node |
| `WF_BRANCH_JOINER` | `WF_BATCH_RESUMER` | `[missing]` n8n WF |
| `persist_branch_results_and_resume` | `persist_batch_result_and_resume` | `[missing]` RPC |
| `/reflect/runs/:id/resume-children` | `/resume-batch` | `[missing]` route |
| `kind=reasoning_conductor/reasoning_branch` | — | `[missing]` |
| `parent_run_id`/`root_run_id`/`wave_id` columns + indexes | — | `[missing]` migrace (advisory dnes) |
| `tot_join` | — | **net-new** node |
| `fn_admit_branch` (concurrency cap) | — | **net-new** — viz §6, hard prod precondition |
| `WF_BRANCH_SCHEDULER` | — | **net-new** |

Conductor run fanoutuje `wave_width` branch child-runs přes `kickOffReflectionWorkflow`/`fn_create_workflow_run`, suspenduje parent jako `waiting_children`, joinuje out-of-band. Reuse `dirigent_drain_nudges` (atomic `FOR UPDATE SKIP LOCKED`) pro fleet queueing. Graph JSONs: `reasoning-tree-conductor.json` + `reasoning-branch-reflect.json`.

> **Pozor na overstate:** ToT doc tvrdí „parent_run_id už threaded" — verified: NENÍ `ai_runs.parent_run_id` column, parent_run_id je advisory-only. PoC přes `metadata.context` je reálný, ale queryable fleet status je nepostavený.

---

## 5. Učení (Learning) — the extension

### 5.1 Rails jsou HOTOVÉ `[merged]` — Hermes je DRIVE, ne rebuild

Plně postavená advisory-only kaskáda (ověřeno SoT soubory):
`evaluate_story_self.sql` (per-run verdict, STABLE, **nikdy nemutuje**) → `fn_search_learnings.sql` (`agent_memories memory_type='learning'`) → `fn_maybe_promote_learning.sql` → `improvement_proposals` (+ `outcome` col) → `fn_evaluate_proposal_risk` (low=auto / high=human) → `expert_rules` → `publish_agent.sql` (`plugin_kind='agent'`, `agent_spec`) → `install_agent_as_story.sql`.

Overlay sinks (žádné nové tabulky): `story_entries(entry_type='self_eval_verdict')`, `ai_tasks(task_type='self_eval_action')`, `story_labels(resource_type='story')`.

### 5.2 Přesný plug-in point: per-RUN vs per-CLOSURE `[missing]`

`evaluate_story_self` fíruje **per-run / on-demand** a je advisory. **NEEXISTUJE `close_story` event** (0 grep hits) ani service-side caller `evaluate_story_self`. Hermes = chybějící reflexní runtime, který:

1. `[missing]` **`close_story` event/driver** — fíruje při uzavření story (StoryLoop `partner_stories` closure).
2. `[missing]` **HermesAdapter** (`runtime='hermes'`) + runtime service za enum slotem.
3. `[missing]` **Hermes driver:** closed-story → agregace learnings (`fn_search_learnings`) → syntéza `agent_spec` → `publish_agent`. Mirror self-tooling observer→factory→commit loop (`AISHA_SELF_TOOLING.md`), ale výstupní rail je `publish_agent`/`install_agent_as_story`, ne Forgejo committer.

### 5.3 Advisory-only invariant — load-bearing

Hermes **konzumuje** verdicts/learnings a **emituje** proposals; NIKDY self-mutuje. Jediné, co jedná, je gated proposal pipeline (low-risk auto přes `fn_evaluate_proposal_risk`, high-risk human → `expert_rules`). Žádný auto-approval path (N8N doc tvrdí „low risk → auto-approval" — to je v rozporu s human-gated invariantem, flagged).

---

## 6. Governance & Admission

### 6.1 Admission Layer composer `[merged]` (PR #442) — multi-axis dispatcher PŘED resolverem

**Merged on `main`:** `fn_admit_clow` composes ONE verdict over **4 derived axes** and is wired into `openclaw_resolve_clow` (deny→block / ask→waiting_human / allow→resolve). Capability-availability, **zero allow-lists**. The merged evaluators differ from the original draft: the write/internet/tools needs are satisfied by the **chosen runtime's self-declared capability columns** on `ai_runtime_registry` (`can_write`/`needs_network`/`supports_tools`, + provider `supports_tool_use`), not by the drafted SsrfGuard/enforcePolicy gates.

| Axis | Stav | Evaluator / reuse |
|---|---|---|
| spend | `[merged]` | `fn_authorize_task_spend` (allow/ask/deny → blocked, awaiting='spend_approval') |
| content/consent | `[merged]` | existující compose-context governance vrstva |
| **runtime** | `[merged]` | `fn_runtime_available` — runtime usable iff its `ai_runtime_registry` row is registered + enabled + has a live adapter (else deny) |
| **internet/egress** | `[merged]` | capability-match — clow `needs_internet` vs the runtime's `needs_network` column (unsatisfied → `ask`) |
| **write** | `[merged]` | capability-match — clow `needs_write` vs the runtime's `can_write` column (unsatisfied → `ask`) |
| **risk** | `[merged]` | `fn_compute_clow_risk` (computed severity) vs resolved `ai_risk_policies` threshold (most-specific active row) |

**Kontrakt verdiktu** (jednotná `allow / ask / deny` + `reason_code`, sjednoceno s reálným capability-gates shape `{enabled, reason}`; rozšířená pole `satisfied_by`/`missing` jsou `[missing]`/proposed, ne existující. Pozn.: `decide_ai_execution_route` je v §7.2 NESTAVĚT — není harmonizační cíl):
```ts
interface AdmissionVerdict {
  decision: 'allow' | 'ask' | 'deny';
  axis_results: Record<'spend'|'runtime'|'internet'|'write'|'content', AxisResult>;
  reason_code: string;          // machine-readable
  awaiting?: string;            // e.g. 'spend_approval' | 'runtime_approval'
}
```
`fn_admit_clow` = composer nad `fn_authorize_task_spend` + nové evaluatory. `ask` verdict + persisted journal = auditovatelný HITL (GOVERNANCE_INDEX princip 3+4).

### 6.2 Governance flags — `ai_spend_policies` precedence pattern `[missing]`

Přidat `governance_flags` precedence-resolved stejným patternem jako `ai_spend_policies` (scope_type/scope_id → nejspecifičtější vyhrává; per-story override seam = resolver už přijímá-ale-ignoruje `story_id`). Compliance/residency override per-story.

### 6.3 Persisted decision journal `[merged]` (PR #442) — princip 1+4

- `[merged]` **`ai_decisions`** table — RLS via `story_participants`; written ONLY by the SECURITY DEFINER wrapper `fn_record_execution_decision` (the resolver/admission RPCs stay STABLE). `run_id`/`story_id` are denormalized soft refs (registered in `fk-relationship-gaps.allowlist.json` — append-only journal, an FK would break the no-dispatch-without-a-journaled-decision invariant and not survive a run purge).
- `[merged]` **`decision_id`** column on `ai_trace_events` (`ai_trace_events.sql:19`) — the `decisionProvenance` id now threads onto every trace event + runtime adapter instead of going nowhere.
- `[wire-up]` `model_id`/`backend_kind` columns na `ai_trace_events` (read-side transparency).
- `[wire-up]` Drift detection: `decisionProvenance` records chose-vs-called + gate „no endpoint_url fingerprint drift > N%" (z LLM_GATEWAY_DISPATCH_INVARIANTS — jediná stále platná část).

**Invariant: no dispatch without a journaled decision.** Každý runtime adapter dostává `decision_id`; chybějící = hard fail.

### 6.4 Centrální control & feedback plane — POVINNÉ (rozhodnutí Q5)

Centrální řízení a feedback **nejsou opt-in** — jsou **povinnou součástí finálního zadání a dokončení infrastruktury**. Sdílený globální „brain" (model benchmarks, routing outcomes, learning feedback) tvoří centrální control-plane, který:
- sbírá produkční telemetrii → `insert_model_benchmark` (rolling window + EWMA) a outcomes přes `fn_record_proposal_outcome`;
- živí adaptivní routing (§8 E4) a důkaz učení (§8 E5) — champion/challenger (`routing_variant`) se tím stává **mechanismem povinného feedbacku**, ne volitelným A/B (reconciluje Q3);
- je jediným zdrojem pravdy pro „co se osvědčilo" napříč runtimes (`direct_llm`/`openclaw`/`hermes`/`cli`), a tím uzavírá smyčku decision → outcome → příští decision.

**Per-story / per-tenant override** (compliance/residency) se vrství NAD centrální plane přes `governance_flags` precedence (§6.2): default = sdílený central feedback; override = řízená výjimka (deny/allow konkrétní signál pro daný scope). Central feedback loop je tedy **mandatorní infrastruktura**; izolace je řízená výjimka, ne výchozí stav.

---

## 7. Datové kontrakty (Data contracts)

### 7.1 Typy / schémata

| Kontrakt | Stav | Umístění |
|---|---|---|
| `AishaExecutionDecision` (Zod) | `[merged]` | `decision.ts:78` |
| 3 osy enums (Runtime/BackendKind/LlmProvider) | `[merged]` | `decision.ts:41–66` |
| `resolveModelWithClow` / `mapBackendKindToProvider` | `[merged]` | `decision.ts:175,133` |
| `ClowSchema` (admission input) | `[missing]` | fold do `decision.ts` |
| `RuntimeAdapter` interface + registry | `[merged]` | `reflection/runtime/adapters.ts` |
| `cli` runtime + `cli_slug` field (Q1) | `[merged]` (enum+field) / `CliRuntimeAdapter` `[missing]` | `decision.ts:47,103` / `reflection/runtime/CliRuntimeAdapter.ts` |
| Per-CLI knowledge binding (cli_slug → expert_rules) | `[wire-up]` | `agent_knowledge_bindings` / `mcp_get_agent_knowledge` |
| Per-CLI capability record | `[wire-up]` | `agent_catalog` / `agent_tools` (slug=cli_slug) |
| `ToTState` / `ThoughtNode` / `ToTPolicy` | `[merged]` | `reflection/tot/types.ts` |
| `AdmissionVerdict` | `[missing]` | `reflection/admission/types.ts` |

### 7.2 Tabulky / RPC — add vs extend

**ADD `[merged]` (PR #442):** `ai_decisions` + `fn_record_execution_decision`; `ai_trace_events.decision_id`; admission stack `fn_admit_clow` + `ai_runtime_registry` + `ai_risk_policies` + `fn_compute_clow_risk` + `fn_runtime_available`.

**ADD `[missing]`:** `governance_flags`; columns `ai_runs.{parent_run_id,root_run_id,wave_id}`; RPCs `fn_admit_branch`, `persist_branch_results_and_resume`, `get_completed_branches_pending_join`, `fn_get_run_tree`, `close_story`/Hermes driver RPC.

**EXTEND `[wire-up]`:** `aisha_resolve_clow_backend` (per-story override via story_id), `aisha_choose_execution_strategy` (fold batch route), `fn_authorize_task_spend` (zůstává, composer nad ním), `ai_trace_events` (model_id/backend_kind cols), `selfeval_story_verdict_v` (nové dimenze), `ai_batch_jobs` (**rozhodnuto Q4** — narovnat na provider-neutral + přidat `decision_id` FK; strategii vlastní `aisha_choose_execution_strategy` capability-driven, viz §2.4), `agent_knowledge_bindings` / `mcp_get_agent_knowledge` (extend o `cli_slug` — per-CLI knowledge, §3.6.1), `agent_catalog` / `agent_tools` (per-CLI capability record, slug=`cli_slug`; zdroj pro task-fit routing).

**NESTAVĚT (verified absent/superseded):** `ai_task_kinds`, `decide_ai_execution_route`, `ai_routing_decisions/outcomes`, `expert_rule_proposals` (verified path = `improvement_proposals`), `create_improvement_proposal_admin` (reconciled na `fn_create_improvement_proposal`), žádné V2 `@platform/*` / RabbitMQ surface.

---

## 8. Fázování & PR sekvence

Dependency-ordered. Každé PR: scope · files · klasifikace · proving gate.

### E0 — Foundation (authority) — ✅ MERGED (PR #442 on `main`)
- **E0.1** `[merged]` `decision.ts` SoT (3 osy + resolveModelWithClow). Gate: `clow-backend-dispatch.unit.test.ts`, `llm-gateway-resolver-contract.gate.test.ts`.
- **E0.2** `[merged]` 4 reflection nodes resolver-first. Gate: `llm-gateway-dispatch.gate.test.ts` (re-anchored na `decision.ts`). **MF-4 RESOLVED:** provider catalog (13 providerů vč. llm-gateway/llmgateway-io/bge/cohere) zmigrován z absorbované migrace do kanonického core seedu `aisha/db/seed/core/19_ai_provider_catalog.sql` (idempotentní, opravená llm-gateway note); seed.compiled.sql přegenerován (demo profil); **3 gaty** (`llm-gateway-dispatch`, `provider-catalog-completeness`, `wp-4-3-bge-reranker`) re-anchorovány na table SoT + seed (žádné `archive/` čtení); ověřeno apply na throwaway PG (13 rows, CHECK constraints OK, idempotent). 60+96 gate testů green.
- **E0.1b** `[merged]` decision journal: `ai_decisions` table + `fn_record_execution_decision` (VOLATILE wrapper) + `decision_id` on `ai_trace_events` (`ai_trace_events.sql:19`). Gate: `execution-decision-sot.gate.test.ts` + cold-start apply.
- **E0.2b** `[merged]` journaled dispatch across `workflowEngine.ts` — every `unifiedChat` site journals. Files: `lib/workflowEngine.ts`, `lib/orchestrationBridge.ts`.
- **E0.5** `[merged]` admission composer `fn_admit_clow` (4 derived axes: spend + runtime-availability + capability-match + risk) + `ai_runtime_registry` + `ai_risk_policies` + `fn_compute_clow_risk` + `fn_runtime_available`; wired into `openclaw_resolve_clow`. Capability-availability, **zero allow-lists**.
- **E0.6** `[merged]` per-graph `max_iterations` override (`orchestrator.ts:201` `graph.max_iterations ?? config.maxIterationsPerRun`, schema `types.ts:52`).
- **E0.7** `[merged]` gitleaks secret-scan CI (`.github/workflows/ci.yml`, scoped to the PR delta `merge-base(origin/main)..HEAD`).

### E1 — Single-run ToT `[merged]`
- **PR-E1.1** `[merged]` 4 node handlers (tot_planner/expand/evaluate/search) + Zod enum + `state.tot` types. Files: `reflection/nodes/tot_*.ts`, `reflection/tot/types.ts`, `reflection/types.ts` (NodeTypeSchema). Gate: `tot-nodes.unit.test.ts` (Sure/Maybe/Impossible thresholding).
- **PR-E1.2** `[merged]` `reasoning-tree-reflect.json` + generated `ai_workflow_definitions` seed row. Klasifikace: wire-up (no migration). Gate: `tot-graph-run.gate.test.ts` + `reflection-graphs-seed-fresh.gate.test.ts` + fullenv ToT integration.

### E2 — ToT fleet `[missing]`
- **PR-E2.1** migrace `ai_runs.{parent_run_id,root_run_id,wave_id}` + kind allowlist + indexes. Gate: cold-start apply + `fleet-schema.gate.test.ts`.
- **PR-E2.2** `waiting_children` status + `children_suspend` NodeOutput + `tot_fanout`/`tot_join`. **Mirror** batch machinery. Gate: `fleet-suspend-resume.gate.test.ts`.
- **PR-E2.3** `WF_BRANCH_JOINER` + `persist_branch_results_and_resume` + `/resume-children`. Gate: E2E join.
- **PR-E2.4** **`fn_admit_branch` concurrency cap + `WF_BRANCH_SCHEDULER` + FleetPolicy** — net-new, **hard prod precondition** (bez něj fleet runaway). Gate: `fleet-concurrency-cap.gate.test.ts`.

### E3 — Hermes / runtime adapters `[partial merged]`
- **PR-E3.1** `[merged]` `RuntimeAdapter` interface + registry; direct_llm/openclaw/hermes adapters; `runtime-execute` graph. Gate: `runtime-adapters.unit.test.ts`, `runtime-fullenv.integration.test.ts`, `runtime-whole-chain-e2e.integration.test.ts`.
- **PR-E3.2** `close_story` event/driver. Files: StoryLoop closure path. Gate: `close-story-event.gate.test.ts`.
- **PR-E3.3** `HermesAdapter` rail is `[merged]`; runtime service/driver (closed-story → agent_spec → `publish_agent`) remains `[missing]`. Gate: `hermes-learning-loop.gate.test.ts` (advisory-only: nikdy nemutuje story).
- **PR-E3.4** `CliRuntimeAdapter` (`runtime='cli'`, parametrizovaný `cli_slug`) přes agent-runner sandbox + capability surfacing do `aisha_choose_execution_strategy` + **per-CLI knowledge layer** (`cli_slug` → `expert_rules` via `agent_knowledge_bindings`; `mcp_get_agent_knowledge` extended na `cli_slug`; capability record v `agent_catalog`, §3.6.1) — adapter `[missing]` / knowledge `[wire-up]` (Q1). claude-cli = první instance; pre-flight cost estimate v admission (Q2). Gate: `cli-runtime-adapter.gate.test.ts` + `cli-knowledge-binding.gate.test.ts` (adaptér načte per-CLI knowledge + capability record PŘED execute(), nehardkóduje konkrétní CLI ani nevolá resolver).

### E4 — Adaptive routing + **centrální feedback plane (POVINNÉ, Q5)** `[wire-up]`
- **PR-E4.1** centrální control-plane (§6.4) — production telemetry feeder → `insert_model_benchmark` (rolling window + EWMA) + outcomes `fn_record_proposal_outcome`. **Mandatorní**, ne opt-in. Files: `costAggregator.ts`, telemetry job. Gate: `benchmark-feeder.gate.test.ts`.
- **PR-E4.2** per-clow `aisha_decide_execution_mode(clow,signals)` + ε-greedy explorer; flow přes `improvement_proposals` risk gate. **NESTAVĚT** nový scorer — extend `get_adaptive_model_tiers`. Gate: `adaptive-routing.gate.test.ts`.

### E5 — Transparency / proof `[missing]`
- **PR-E5.1** `ai_decisions` table + `decision_id` threading + persist `decisionProvenance`. Gate: `decision-journal.gate.test.ts` + `rpc-only-data-access`, `audit-fields-completeness`.
- **PR-E5.2** `fn_get_run_tree(run_id)` (participant RLS + PII redact, render pruned grey branches z `ai_workflow_node_runs`) + `ai_workflow_node_runs` participant policy (mirror trace_events). Gate: `run-tree-rls.gate.test.ts`.
- **PR-E5.3** „prove learning": `fn_compare_model_benchmarks(task_type,t0,t1)`, before/after panel z `fn_record_proposal_outcome`, volitelně champion/challenger `routing_variant` na `ai_runs` (net-new, flagged). Gate: `learning-proof.gate.test.ts`.

---

## 9. Definition of Done & invarianty

Každý jako testovatelný gate (rozšířit existující suite):

| # | Invariant | Gate |
|---|---|---|
| I1 | **No dispatch without a decision** — každé runtime execute() má `decision_id` | `decision-journal.gate.test.ts` |
| I2 | **No node picks its own model** — 0 raw `unifiedChat({model})` mimo `dispatchLlm`/resolver | `llm-gateway-dispatch.gate.test.ts` (rozšířit) |
| I3 | **Every decision journaled** — `ai_decisions` + `decision_id` na `ai_trace_events` | `decision-journal.gate.test.ts` |
| I4 | **Advisory-only learning** — `evaluate_story_self`/Hermes nikdy nemutuje; jen gated proposals jednají | `hermes-learning-loop.gate.test.ts` |
| I5 | **Human gate na high-risk** — `fn_evaluate_proposal_risk` high → human; admission `ask` na HIGH autonomy | `approval-explainability.gate.test.ts` |
| I6 | **Admission před resolverem** — žádný clow neprojde resolver bez admission verdiktu | `admission-composer.gate.test.ts` |
| I7 | **Fleet concurrency cap** — `fn_admit_branch` brání runaway (hard prod precondition) | `fleet-concurrency-cap.gate.test.ts` |
| I8 | **RPC-only + SECURITY DEFINER** — `ai_decisions`/admission RPC follow REVOKE/GRANT + RLS | `rpc-only-data-access.gate.test.ts` |
| I9 | **No new graph engine** — ToT v1 jen registruje handlers, žádná migrace | `tot-nodes.unit.test.ts` |
| I10 | **Policy v nodes, ne v edges** — search logika v `tot_search`, edges čtou jen flat `tot_action/tot_done` | `tot-graph-run.gate.test.ts` |
| I11 | **Cold-start clean** — všechny migrace aplikují přes throwaway pg17 | `verify-cold-start-apply.sh` |
| I12 | **CLI driver je generický, ne hardcoded** — cli dispatch resolvuje `cli_slug` knowledge (`agent_knowledge_bindings`) + capability record (`agent_catalog`) PŘED execute(); 0 hardcoded názvů CLI v adaptéru | `cli-knowledge-binding.gate.test.ts` |
| I13 | **Žádný gate se neváže na stale source** — testy čtou jen kanonický SoT (`aisha/db/sql`, `services/`, `src/`), nikdy `archive/`/`trash/`/deferred | `no-archive-test-binding.gate.test.ts` (MF-4) |

---

## 10. Rizika & otevřené otázky

### Genuinely-new work (flagged, nestavět bez owner approval)
1. **Persisted decision journal** (`ai_decisions`, `decision_id`) — persistence+threading job (UUID už raženo a zahozeno).
2. **Admission Layer composer** — multi-axis (runtime/internet/write), ne jen predictive-cost jak ToT doc zdůrazňuje.
3. **Distributed child-run fleet** (ToT v2) — celá E2; `fn_admit_branch` je net-new hard precondition.
4. **HermesAdapter + runtime + close_story** — enum slot existuje, runtime za ním ne.

### Rozhodnutí ownera (2026-06-19)
- **Q1 — VYŘEŠENO → generický `cli` driver.** Ne hardcoded `claude_cli`/`agent_container`: runtime osa dostává jednu hodnotu `cli` = generický driver pro libovolné externí CLI; konkrétní nástroj nese `agent`/`cli_slug`. Když se úkol ukáže vhodný pro konkrétní CLI, orchestrujeme ho přes celou šířku logiky+stacku (decision→admission→journal→eval→learning) díky capability surfacingu. claude-cli = první instance. Dopad: `cli` přidán do `AishaRuntimeSchema` + `cli_slug` field (`decision.ts`, `[merged]`); `CliRuntimeAdapter` = §3.6 / PR-E3.4. **Per-CLI pravidla/specifika** = samostatný **knowledge layer** (`[wire-up]` nad `agent_knowledge_bindings` + `agent_catalog`, keyed by `cli_slug`, §3.6.1) — každý CLI má vlastní učitelný rule-set (jak ho řídit), ne hardcode.
- **Q3 — VYŘEŠENO (pohlcen Q5):** champion/challenger `routing_variant` NENÍ opt-in — je mechanismem **povinného** centrálního feedbacku (§6.4, E4/E5).
- **Q4 — VYŘEŠENO → AISHA = capability-availability infrastructure.** `ai_batch_jobs` narovnat na provider-neutral + `decision_id` FK; execution-strategy vlastní `aisha_choose_execution_strategy` jako mapování *task requirement → dostupné capabilities*. AISHA podle dostupných možností ví, zda/jak naložit s výsledkem úkolu (§2.4).
- **Q5 — VYŘEŠENO → centrální control & feedback je POVINNÝ.** Sdílený benchmark/feedback plane je mandatorní součást finálního zadání a dokončení infrastruktury; per-story/tenant override se vrství nad něj jako řízená výjimka (§6.4).

### Stále otevřené pro ownera
- **Q2 (external-CLI cost blind spot):** claude-cli / další CLI spends mimo per-node metering. Návrh: pre-flight estimate v admission + `cli_slug`-aware budget gate (§3.6). Potvrdit přístup.
- **Q6 (OWASP CI surface):** supply-chain controls cituje `.github/workflows` (mirror-only) — přesunout na `.forgejo/` canonical, jinak nemusí běžet.
- **Q7 (governance paths drift):** GOVERNANCE_INDEX enforce points jmenují `supabase/sql` — reconcile na `aisha/db/sql` + rpcService/rpcUser před wiring evaluatorů.

### Stale-claim warnings (docs vs verified)
- LLM_GATEWAY_DISPATCH_INVARIANTS „wire broken" = **obsolete** (E0.1/E0.2 done — ověřeno `generator.ts:5,43`). Provider-catalog archive-binding (MF-4) **vyřešen**: catalog v core seedu, 3 gaty re-anchorovány, žádné `archive/` čtení.
- Epoch docs „DONE" = DONE na Supabase-era, **re-verify na svc-***.
- STORY_SELF_EVALUATION_LOOP/RUNBOOK „PR1/PR5 awaiting" = ve skutečnosti **LANDED** (under-claim).
- N8N/Organism „single n8n Dirigent brain" = superseded tri-runtime autoritou.
- V2 spec / AGENTIC_BUYERS = **jiný produkt** (Supabase, banned) — mimo orchestrator compatibility surface.
