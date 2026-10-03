-- Table: agent_knowledge_bindings
-- Source-of-truth for "which agent has which expert_rule attached as
-- knowledge / memory / context / policy". The table was referenced by
-- mcp_get_agent_knowledge from day one but its CREATE TABLE only lived
-- in the auto-generated baseline — never in SoT. Phase 5 closes that gap.
--
-- Despite the column name `knowledge_item_id`, the FK target is
-- expert_rules(id), not knowledge_items(id). This matches the existing
-- mcp_get_agent_knowledge usage. The name is preserved for backward
-- compatibility (renaming would touch every caller).
--
-- Visibility scope: `story_id` is NULLABLE. NULL = global binding
-- (applies whenever the agent runs anywhere). A non-null story_id scopes
-- the binding to one story — the bot↔KB matrix in AdminStoryDetail
-- writes per-story rows so partner work can have its own rule set
-- without bleeding into the AISHA stack-default story.
--
-- See also: mcp_get_agent_knowledge (consumer), agent_catalog (slug
-- source), expert_rules (FK target).

CREATE TABLE IF NOT EXISTS public.agent_knowledge_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Soft FK to agent_catalog.slug — kept as text for flexibility (custom
  -- agent slugs from MCP servers may not be in agent_catalog yet).
  agent_slug text NOT NULL,

  -- FK to expert_rules.id (NOT knowledge_items — historical naming).
  knowledge_item_id uuid NOT NULL
    REFERENCES public.expert_rules(id) ON DELETE CASCADE,

  -- 'rule' | 'memory' | 'context' | 'policy' (free-text for now; tighten
  -- via lookup table if/when binding kinds stabilize).
  binding_type text NOT NULL DEFAULT 'rule',

  -- Higher = earlier in mcp_get_agent_knowledge ORDER BY priority DESC.
  -- Default 100; values 1..1000 are conventional.
  priority int NOT NULL DEFAULT 100,

  -- Optional pinned version (nullable = always use current rule version).
  version int,

  -- Soft-disable a binding without dropping the row (preserves audit
  -- history). Partial unique below enforces uniqueness only on active rows.
  is_active boolean NOT NULL DEFAULT true,

  -- NULL = global binding; non-null scopes to a partner story.
  story_id uuid REFERENCES public.partner_stories(id) ON DELETE CASCADE,

  -- Operator-facing notes — surfaces in admin binding matrix.
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES aisha_auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.agent_knowledge_bindings ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.agent_knowledge_bindings IS
  'Bot ↔ expert_rule attachment matrix (despite the legacy column name knowledge_item_id, FK is to expert_rules). Consumed by mcp_get_agent_knowledge; written by Phase 5 StoryBindingsTab.';

-- Indexes live in aisha/db/sql/indexes/idx_agent_knowledge_bindings.sql
-- per SQL Source Separation rule.
