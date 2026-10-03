# AISHA CLI-Runtime Unification — self-governed CLI instances

> How the AISHA stack launches and governs its **own** CLI agent instances
> (Claude Code CLI, OpenAI Codex CLI) as a first-class, governed runtime — the
> same admission/journal/health machinery every other dispatch goes through.
> Landed in PR #507. Nothing tool-specific is hardcoded; selection is derived
> from `ai_runtime_registry` rows (capability-availability).

Related: [LLM_GATEWAY_DISPATCH_INVARIANTS.md](LLM_GATEWAY_DISPATCH_INVARIANTS.md) ·
[../orchestration/AISHA_FINALIZATION_MASTER_PLAN.md](../orchestration/AISHA_FINALIZATION_MASTER_PLAN.md)

## What this is (and is not)

This is **not** a human typing in an IDE. It is the stack spawning and supervising
its own headless CLI agents to do real work (file edits, git, web) under AISHA's
governance — selecting *which* CLI tool, deciding *whether* it may run, holding it
for approval when the blast radius warrants, journaling the decision, and capturing
a machine-readable result. One runner, one result contract, N CLI tools.

## The runtime axis

A CLI tool is a runtime, addressed by slug `cli:<tool>` (e.g. `cli:claude-cli`,
`cli:codex-cli`), registered as a row in `public.ai_runtime_registry`. Selection is
**derived, never hardcoded**:

- `fn_resolve_runtime(clow)` maps a unit of work to a runtime. A CLI is derivable
  only with an explicit `runtime='cli'` + `cli_slug`, and only while its registry
  row is `is_enabled = true` and `is_in_process_executor = true`. Toggle the row →
  the resolution changes. There is no allow-list of tool names anywhere.
- Capabilities (`can_write`, `needs_network`, `supports_tools`, …) are columns on
  the row; a need the runtime cannot satisfy excludes it. Adding a second CLI tool
  (Codex alongside Claude) is a **seed row**, not code.

## The governed dispatch path

Every CLI spawn goes through the same admission kernel as the rest of the stack:

1. **Admission** — `fn_admit_clow(p_clow, p_context)` composes a verdict over four
   derived axes: **spend** (`fn_authorize_task_spend`), **runtime availability**
   (`fn_runtime_available`), **capability match**, and **risk**
   (`fn_compute_clow_risk`). The verdict is `deny > ask > allow`.
2. **Risk** — a CLI run is irreversible + egressing + writing, so
   `fn_compute_clow_risk` rates it **critical**; under the built-in `ask@medium`
   policy that resolves to **`ask`**.
3. **Hold for approval** — an `ask` verdict creates the run **held**
   (`approval_required = true`, `approved_at = NULL`, `awaiting = 'approval'`).
   `claim_queued_claude_run` skips held runs, so nothing executes until a human
   with the right role calls `approve_claude_run` (admin/staff + segregation of
   duties — the approver may not be the requester). `list_pending_claude_approvals`
   is the Mission Control inbox.
4. **Journal (I1)** — `fn_record_execution_decision` is the *only* writer of
   `ai_decisions`; the run is threaded onto its `decision_id`, so the admission
   verdict, the chosen `cli_slug`, and the outcome are all auditable.
5. **Spawn** — `svc-agent-runner` runs the tool in an isolated container against a
   per-run worktree using the `docker/agent-{claude,codex}` entrypoints.
6. **Result contract** — both entrypoints emit the **same** `{"__result":true,…}`
   stdout sentinel (from an EXIT trap, so it survives a failed commit/timeout). The
   runner validates it (`validateClaudeResult`) and persists `outputs`. The two CLI
   tools share one contract; nothing tool-specific leaks into the runner.

## The RuntimeAdapter bridge

The reflection runtime reaches the CLI through a `RuntimeAdapter` whose `execute()`
enqueues via `fn_spawn_claude_cli_run(…, p_cli_slug)` — passing the slug through so
the journal records the real tool (`codex-cli`, not a hardcoded `claude-cli`). The
adapter is registered in `RUNTIME_ADAPTERS`; `selfRegister` deliberately skips the
CLI (it is out-of-process and slug-namespaced, not a synchronous in-process model).

## Health is global, not config-presence

`ai_runtime_registry.adapter_health` is written **only** by the dedicated
`WF_RUNTIME_HEALTH_PROBE`, which HTTP-probes `svc-agent-runner`'s `/health`
(bidirectionally, cross-server via the mesh). A process must never self-register its
own health from config presence — that is what made the probe the single source of
truth.

## Why it is built this way

- **Consistency** — the operator's bar was *"celé to musí být konzistentní s tím,
  jak governuje dispatch zbytek stacku."* The CLI is not a side-channel; it is the
  same resolve → admit → journal → health path as `direct_llm`, `openclaw`, `hermes`.
- **Capability-availability, no allow-lists** — which tools exist, whether they may
  run, and what they may do are all registry-derived. A new CLI tool, or disabling
  an existing one, is a data change.
- **Approval where the blast radius warrants it** — an irreversible, networked,
  writing agent defaults to *held-until-approved*, mirroring the `playwright_runs`
  approval pattern.

## Where it lives

- DB: `aisha/db/sql/functions/fn_spawn_claude_cli_run.sql`,
  `approve_claude_run.sql`, `list_pending_claude_approvals.sql`,
  `claim_queued_claude_run.sql`, `fn_admit_clow.sql`, `fn_resolve_runtime.sql`;
  table `aisha/db/sql/tables/agent_runs.sql`; seed
  `aisha/db/seed/core/18_ai_runtime_catalog.sql`.
- Service: `services/svc-agent-runner/src/{routes/runs.ts,poller.ts,backends/claude-result.ts}`;
  reflection `services/svc-ai-chat/src/reflection/runtime/{adapters.ts,selfRegister.ts}`.
- Execution recipes: `docker/agent-claude/entrypoint.sh`, `docker/agent-codex/entrypoint.sh`.
- Tests: `src/tests/db/claude-approval-rpc-runtime.test.ts`,
  `src/tests/db/runtime-selection-supervision-rpc-runtime.test.ts`,
  `services/svc-agent-runner/src/tests/{claude,codex}-cli-real.integration.test.ts`.
