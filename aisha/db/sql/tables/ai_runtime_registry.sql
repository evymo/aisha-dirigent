-- Table: ai_runtime_registry
-- AISHA's catalog of EXECUTION RUNTIMES — the entities that can actually carry
-- out a clow once AISHA has decided what to do. This is the runtime-axis sibling
-- of ai_provider_registry (which catalogs *model* providers): a runtime answers
-- "by what mechanism does this work get executed" (direct LLM call, OpenClaw,
-- Hermes, an n8n workflow, a human, or a registered CLI), whereas a provider
-- answers "which model backend serves the tokens".
--
-- CAPABILITY-AVAILABILITY, NOT AN ALLOW-LIST.
--   A runtime is USABLE iff it is REGISTERED here AND governs itself as available
--   (is_enabled = true) AND its adapter is reachable (adapter_health <> 'down').
--   Adding a new runtime (e.g. hermes, cli:claude-cli) = inserting one self-
--   describing row whose adapter self-registers; there is NOTHING to maintain
--   elsewhere. This table holds NO list of "permitted" names — every column below
--   is per-entity self-governance (the entity declares its own state/capability),
--   exactly as ai_provider_registry.is_enabled / supports_tool_use already work.
--   The resolver derives availability by FILTERING this registry (WHERE is_enabled
--   AND adapter healthy), the same way aisha_resolve_clow_backend filters
--   ai_provider_registry — never by consulting a hardcoded set of allowed runtimes.
--
-- CAPABILITY MATCH is DERIVED, not listed.
--   A clow's needs (needs_write / needs_internet / needs_tools) are checked
--   against the chosen runtime's DECLARED capabilities (can_write / needs_network
--   / supports_tools) — a per-entity boolean comparison, not membership in a
--   separately-maintained list.
--
-- GOVERNANCE is POLICY (thresholds/risk), not lists.
--   Risk is COMPUTED from the clow (criticality × side_effect_class × autonomy_
--   class) → threshold → allow/ask/deny, with spend governed by ai_spend_policies.
--   Human approval is triggered by RISK, never by a runtime's presence in a list.

CREATE TABLE IF NOT EXISTS public.ai_runtime_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Runtime kind controls how AISHA hands the work off (which adapter executes it).
  runtime_kind text NOT NULL CHECK (runtime_kind IN (
    'direct_llm',            -- AISHA calls a model provider directly (single-shot / reflection nodes)
    'openclaw',              -- dispatched to the OpenClaw clow executor
    'hermes',                -- dispatched to the Hermes learning/execution runtime
    'workflow',              -- handed to an n8n workflow (WF_*) for execution
    'human',                 -- routed to a human operator (Mission Control approval / manual step)
    'cli',                   -- handed to a registered CLI adapter (e.g. cli:claude-cli)
    'workbench'              -- run via the VSCode workbench extension (local ollama/llama.cpp models the extension discovers + reports into this same registry)
  )),

  -- Stable identifier the resolver + adapters key on. For multi-instance kinds
  -- (e.g. several CLIs) the slug disambiguates: 'direct_llm', 'openclaw',
  -- 'hermes', 'workflow', 'human', 'cli:claude-cli'.
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,

  -- Self-governed availability. The runtime owns this flag; the resolver derives
  -- "usable" by filtering on it (NOT by checking a list of permitted runtimes).
  is_enabled boolean NOT NULL DEFAULT true,

  -- Adapter health (set by probe; AISHA reads it as resolver input). A runtime
  -- with no registered/reachable adapter resolves to unavailable.
  adapter_health text NOT NULL DEFAULT 'unknown' CHECK (adapter_health IN ('healthy', 'degraded', 'down', 'unknown')),
  adapter_health_checked_at timestamptz,
  -- Consecutive non-healthy probes. Incremented on degraded/down, RESET to 0 on
  -- healthy — drives exponential backoff for the runtime health probe, mirroring
  -- ai_provider_registry.consecutive_failure_count.
  consecutive_failure_count int NOT NULL DEFAULT 0,

  -- DECLARED capabilities of this runtime. Matched against a clow's needs
  -- (needs_write / needs_internet / needs_tools) — derived comparison, not a list.
  can_write boolean NOT NULL DEFAULT false,         -- may perform write / side-effecting actions
  needs_network boolean NOT NULL DEFAULT false,     -- requires outbound network / internet access
  supports_tools boolean NOT NULL DEFAULT false,    -- can use tools (tool-use / function calling)

  -- Whether this runtime KIND executes via the in-process executeViaRuntime adapter
  -- axis (RUNTIME_ADAPTERS in services/svc-ai-chat/.../runtime/adapters.ts) — true for
  -- direct_llm/openclaw/hermes/workbench/cli; false for OUT-OF-BAND surfaces that have
  -- no RuntimeAdapter (human = Mission-Control inbox, workflow = n8n hand-off). The
  -- resolver derives auto-derivability by FILTERING on this self-declared flag, NOT a
  -- hardcoded NOT IN ('human','workflow') list — the same per-entity self-governance as
  -- can_write/needs_network/supports_tools. Defaults false so a runtime is fail-safe: it
  -- is never auto-derived as an executor until it DECLARES it has an adapter, so a future
  -- out-of-band runtime cannot silently resolve to a missing-adapter throw.
  -- COUPLING: when a real adapter ships for a kind, add it to RUNTIME_ADAPTERS AND set
  -- this row's is_in_process_executor=true in the SAME change.
  is_in_process_executor boolean NOT NULL DEFAULT false,

  -- Risk inputs. Combined with the clow's criticality to COMPUTE a risk level,
  -- which a threshold then maps to allow/ask/deny (governance = policy, not list).
  side_effect_class text NOT NULL DEFAULT 'read_only' CHECK (side_effect_class IN (
    'read_only',             -- observes / reads only, no external effect
    'reversible',            -- writes that can be undone / rolled back
    'irreversible'           -- writes with permanent external effect
  )),
  autonomy_class text NOT NULL DEFAULT 'supervised' CHECK (autonomy_class IN (
    'supervised',            -- every action gated by human review
    'semi',                  -- acts autonomously up to a risk/spend threshold
    'autonomous'             -- acts without per-action human gating
  )),

  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_runtime_registry ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ai_runtime_registry IS
  'Capability-availability registry of execution runtimes (direct_llm/openclaw/hermes/workflow/human/cli). A runtime is usable iff registered AND is_enabled AND its adapter is healthy; clow needs are matched against per-entity declared capabilities. No allow-list — self-governing rows the resolver filters, mirroring ai_provider_registry.';

-- Indexes (e.g. idx_ai_runtime_registry_enabled, idx_ai_runtime_registry_health)
-- live in aisha/db/sql/indexes/; RLS policies live in aisha/db/sql/policies/;
-- the updated_at trigger lives in aisha/db/sql/triggers/ — per SQL Source
-- Separation rule, mirroring ai_provider_registry.
