-- ============================================================================
-- Core seed: ai_runtime_registry — AISHA execution-runtime catalog (E0)
-- ============================================================================
-- Canonical SoT for the RUNTIME axis of the "AISHA Orchestration Authority"
-- sprint: one row per executor AISHA can hand a clow to. This REPLACES the
-- former 18_governance_flags.sql, whose `allow_runtime` jsonb array was a
-- maintained ALLOW-LIST (a row whose VALUE listed permitted runtime names) —
-- a security hole + a hardcoded roster that had to be edited every time a
-- runtime was added. The locked design forbids that.
--
-- CAPABILITY-AVAILABILITY, NOT AN ALLOW-LIST
--   Availability is DERIVED from this registry, never from a list of permitted
--   names. A runtime is usable IFF its OWN row says so:
--       is_enabled AND adapter_health IN ('healthy','unknown')
--   — exactly the predicate fn_runtime_available() evaluates, mirroring how
--   aisha_resolve_clow_backend filters providers (is_enabled AND
--   last_health_status IN ('healthy','unknown')). Adding hermes or a new CLI
--   = it self-registers its OWN row + ships an adapter; there is NOTHING in
--   code or seed to maintain. No `allow_runtime:[...]`, no permitted-names
--   roster lives anywhere.
--
-- CAPABILITY MATCH is likewise DERIVED, not listed. Each runtime self-describes
-- its OWN capabilities as discrete per-row attributes (can_write /
-- needs_network / supports_tools / reversibility / requires_supervision). A
-- clow's declared needs (needs_write / needs_internet / needs_tools) are
-- checked against the chosen runtime's row — derived, not a separate allow-list.
-- NB: every column here is a scalar self-description of THIS runtime; no column
-- holds a list of OTHER permitted entities. That is the line between a
-- self-governing entity row (allowed) and an allow-list (forbidden).
--
-- GOVERNANCE stays POLICY, not lists: spend = ai_spend_policies thresholds;
-- risk = computed from the clow (criticality, side-effect class) → threshold →
-- allow/ask/deny; human approval is triggered by RISK, not by membership in a
-- list. This seed only declares what each runtime IS and whether the operator
-- has opted it in.
--
-- Runtime slug convention (matches ai_runtime_registry.slug + fn_runtime_available):
--   - kind != 'cli'  → slug = runtime_kind             (e.g. 'openclaw')
--   - kind  = 'cli'  → slug = 'cli:' || <cli_slug>     (e.g. 'cli:claude-cli')
--
-- Schema (table + CHECK constraints) lives in
-- aisha/db/sql/tables/ai_runtime_registry.sql. This file is DATA only, mirroring
-- 19_ai_provider_catalog.sql.
--
-- Idempotent: ON CONFLICT (slug) DO UPDATE refreshes catalog metadata + the
-- runtime's declared capabilities, but NEVER touches is_enabled — the operator's
-- opt-in/opt-out choice is preserved across re-seeds (same contract as the
-- provider catalog). cli:claude-cli AND hermes now ship ENABLED: both RuntimeAdapters
-- are live (hermes: hermesAdapter → evaluate_story_self, plus the closed-story learning
-- loop fn_hermes_learning_loop wired into svc-agent-runner on story closure). At boot,
-- selfRegisterRuntimes reconciles is_enabled to the adapter's real availability — so a
-- runtime with a LIVE adapter that shipped disabled here would only be a transient,
-- misleading pre-boot state, not an honored opt-out. Ship it as it actually runs.
-- ============================================================================

INSERT INTO public.ai_runtime_registry
  (slug, display_name, runtime_kind,
   is_enabled, adapter_health,
   can_write, needs_network, supports_tools, is_in_process_executor, side_effect_class, autonomy_class,
   notes)
VALUES
  -- ── direct_llm — AISHA calls a model directly via a reflection node. ───────
  -- Read-only executor: produces tokens, performs no side-effecting write and
  -- needs no egress of its own (the provider transport handles model reach).
  -- Tool use is available (reflection nodes call tools). Enabled by default;
  -- fn_runtime_available additionally requires ≥1 available provider (DERIVED).
  ('direct_llm', 'Direct LLM (reflection node)', 'direct_llm',
   true, 'healthy',
   false, false, true, true, 'read_only', 'semi',   -- is_in_process_executor=true (direct_llm/hermes/workbench)
   'AISHA generates directly through a reflection node. Read-only: no side-effecting write, no egress of its own. Availability also requires an enabled+healthy provider (derived in fn_runtime_available, not listed here).'),

  -- ── openclaw — operative agent-mesh runtime (helpdesk/CRM/onboarding/tools).
  -- Side-effecting (can_write) + needs network + tool-capable. Effects are
  -- reversible-with-effort (semi): compensating actions exist for most ops.
  ('openclaw', 'OpenClaw (agent mesh)', 'openclaw',
   true, 'healthy',
   true, true, true, true, 'reversible', 'semi',    -- is_in_process_executor=true (openclaw)
   'Operative agent-mesh runtime. Side-effecting + tool-capable + needs egress; effects are semi-reversible (compensating actions exist). Wrapped as one RuntimeAdapter over existing openclaw_* nodes — no parallel surface.'),

  -- ── workflow — hand off to an n8n / orchestrated workflow. ─────────────────
  -- Side-effecting + networked. Reversible by design (workflow steps are
  -- idempotent + audited). Tool use is delegated to the workflow, not the
  -- runtime, so supports_tools=false at this axis.
  ('workflow', 'Workflow (n8n / orchestrated)', 'workflow',
   true, 'healthy',
   true, true, false, false, 'reversible', 'semi',  -- is_in_process_executor=FALSE (workflow = n8n hand-off, no adapter)
   'Hand off to an n8n / orchestrated workflow. Side-effecting + networked; reversible (idempotent, audited steps). Tool use lives in the workflow, not at this axis.'),

  -- ── human — route to a person (approval / manual step). ───────────────────
  -- Always "available" once registered: the adapter is the Mission-Control
  -- inbox, healthy by construction. A human can perform irreversible actions,
  -- so this runtime is supervised by definition.
  ('human', 'Human (manual / approval)', 'human',
   true, 'healthy',
   true, false, false, false, 'irreversible', 'supervised',  -- is_in_process_executor=FALSE (human = manual inbox, no adapter)
   'Route to a person (approval or manual step) via Mission Control. Adapter is the human inbox — healthy by construction. Human actions may be irreversible; supervised by definition.'),

  -- ── hermes — reflexive/expert runtime (closed-story learning, skills). ─────
  -- Adapter is LIVE: hermesAdapter (reflection/runtime/adapters.ts) runs evaluate_story_self,
  -- and the closed-story learning loop (fn_hermes_learning_loop) is wired into svc-agent-runner
  -- on story closure. Read-only/advisory — the mutating publish/install steps are human-gated.
  -- Ships ENABLED to match the live adapter (selfRegisterRuntimes reconciles at boot anyway).
  ('hermes', 'Hermes (reflexive / expert)', 'hermes',
   true, 'unknown',
   false, false, true, true, 'read_only', 'semi',   -- is_in_process_executor=true (direct_llm/hermes/workbench)
   'Reflexive/expert runtime (closed-story learning, skill creation). Adapter is live (evaluate_story_self + fn_hermes_learning_loop). Read-only/advisory — mutating publish/install steps are human-gated; no egress. adapter_health starts unknown (passes availability) and is reconciled to healthy at boot by selfRegisterRuntimes.'),

  -- ── cli:claude-cli — first instance of the generic external-CLI driver. ────
  -- runtime_kind='cli' is a GENERIC driver; claude-cli is the first registered
  -- cli_slug (slug carries the 'cli:' prefix). ENABLED now its RuntimeAdapter +
  -- admission + sandbox wiring are live: the cli adapter (RUNTIME_ADAPTERS.cli)
  -- enqueues via fn_spawn_claude_cli_run, which fn_admit_clow-gates + I1-journals,
  -- and svc-agent-runner drains the queue into an isolated container. Drives an
  -- external process that can write, needs network, and uses tools; CLI
  -- side-effects are treated as irreversible and supervised.
  ('cli:claude-cli', 'Claude CLI (external CLI driver)', 'cli',
   true, 'unknown',
   true, true, true, true, 'irreversible', 'supervised',  -- is_in_process_executor=TRUE: the cli RuntimeAdapter ships (RUNTIME_ADAPTERS.cli → enqueue via fn_spawn_claude_cli_run), so fn_resolve_runtime derives cli (with an explicit slug, per its cli clause). Matches the coupling rule: the column flips true the moment the adapter lands.
   'First instance of the generic external-CLI runtime (runtime_kind=cli, slug=cli:<cli_slug>). ENABLED: the cli RuntimeAdapter enqueues via fn_spawn_claude_cli_run (admission-gated by fn_admit_clow + I1-journaled via fn_record_execution_decision); svc-agent-runner drains the queue into an isolated container. adapter_health is owned by the dedicated runtime health probe (WF_RUNTIME_HEALTH_PROBE → svc-agent-runner /health), not self-written. Writes + needs egress + tool-capable; irreversible/supervised. New CLIs are added as their own cli:<slug> row — none are hardcoded.'),

  -- ── cli:codex-cli — second instance of the generic external-CLI driver. ─────
  -- OpenAI Codex (codex exec) on the OpenAI backend — proving cli:<slug> is a
  -- GENUINELY multi-tool runtime: AISHA picks the suitable CLI tool (claude-cli /
  -- codex-cli) per capability-availability, same RuntimeAdapter + admission + the
  -- shared __result contract. Same caps as claude-cli (writes + egress + tools,
  -- irreversible/supervised); docker/agent-codex drives it.
  ('cli:codex-cli', 'OpenAI Codex CLI (external CLI driver)', 'cli',
   true, 'unknown',
   true, true, true, true, 'irreversible', 'supervised',
   'Second instance of the generic external-CLI runtime (runtime_kind=cli, slug=cli:codex-cli). OpenAI Codex (codex exec) on the OpenAI backend, driven by docker/agent-codex with the SAME RuntimeAdapter + fn_admit_clow admission + I1 journal + __result result contract as cli:claude-cli — AISHA selects the suitable CLI tool per capability-availability, nothing tool-specific is hardcoded in the runner. Writes + needs egress + tool-capable; irreversible/supervised.'),

  -- ── workbench — local models surfaced via the VSCode workbench extension. ───
  -- The aisha-dirigent extension discovers local models (ollama / llama.cpp /
  -- openai-compat) and REPORTS them into ai_model_registry (surface-agnostic — a
  -- workbench-discovered model is discovered/tested/resolved like any other).
  -- DISABLED here until a workbench execution adapter ships; today the workbench
  -- CONTRIBUTES models, it does not yet execute via this axis.
  ('workbench', 'VSCode Workbench (local models)', 'workbench',
   false, 'unknown',
   false, false, true, true, 'read_only', 'semi',   -- is_in_process_executor=true (direct_llm/hermes/workbench)
   'Local models (ollama / llama.cpp / openai-compat) discovered + reported into this registry by the aisha-dirigent VSCode extension — surface-agnostic with cloud/central models. DISABLED until a workbench execution adapter ships; today it contributes models, it does not yet execute via this axis.')
ON CONFLICT (slug) DO UPDATE
SET display_name         = EXCLUDED.display_name,
    runtime_kind         = EXCLUDED.runtime_kind,
    -- adapter_health + capability self-description refresh on re-seed; the
    -- live health value is owned by the adapter probe, so only advance an
    -- unknown placeholder toward the seed default — never overwrite a real
    -- probe verdict with the static seed value.
    adapter_health       = CASE
                             WHEN public.ai_runtime_registry.adapter_health = 'unknown'
                             THEN EXCLUDED.adapter_health
                             ELSE public.ai_runtime_registry.adapter_health
                           END,
    can_write            = EXCLUDED.can_write,
    needs_network        = EXCLUDED.needs_network,
    supports_tools       = EXCLUDED.supports_tools,
    is_in_process_executor = EXCLUDED.is_in_process_executor,
    side_effect_class    = EXCLUDED.side_effect_class,
    autonomy_class       = EXCLUDED.autonomy_class,
    notes                = EXCLUDED.notes,
    updated_at           = now();
    -- NOTE: is_enabled is intentionally NOT in the SET list — operator opt-in
    -- (e.g. enabling hermes / cli:claude-cli) survives every re-seed.

-- ── Audit: record that the runtime catalog was seeded ───────────────────────
-- Mirrors the provider-catalog audit row. Names are listed here only as an
-- audit BREADCRUMB of what this seed touched — this is a log entry, not a
-- consulted allow-list (nothing reads it to decide availability).
-- Counts are computed from the table, not enumerated — the audit records the
-- shape of the seed without restating any roster of names.
INSERT INTO public.audit_journal (user_id, action, metadata)
SELECT
  NULL,
  'runtime_catalog_seeded',
  jsonb_build_object(
    'source', 'aisha/db/seed/core/18_ai_runtime_catalog.sql',
    'runtime_count', count(*),
    'enabled_count', count(*) FILTER (WHERE is_enabled),
    'model', 'capability-availability (per-entity is_enabled + adapter_health)'
  )
FROM public.ai_runtime_registry;
