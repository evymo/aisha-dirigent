-- ============================================================================
-- Table: aisha_static_defense_rules
-- Purpose: Source-of-truth for static defense rules (Semgrep, ESLint policy
--   bits) that get generated INTO .semgrep/aisha-rules.yml + other tooling
--   config files via `npm run gen:static-defense`.
--
-- Why in DB: per AISHA design, policy ≡ knowledge ≡ DB. Hand-managed YAML
-- in repo can't be extended by Aisha autonomously and can't be tuned from
-- Appsmith UI. CLAUDE.md uses the same generated-from-DB pattern.
--
-- Lifecycle: draft → active (admin approval) → deprecated. Only `active`
-- rows are exported by the generator. Audit trail on every status change.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.aisha_static_defense_rules (
  -- Stable identifier referenced from generated YAML / config
  rule_id          text PRIMARY KEY,

  -- Which tool consumes this rule. Determines generator output target.
  --   'semgrep'         → .semgrep/aisha-rules.yml entry
  --   'eslint-no-secrets' → eslint.config.js additionalRegexes block
  --   'owasp-exemption' → owasp-orchestrator-adoption.gate exemption entry
  category         text NOT NULL CHECK (category IN (
    'semgrep', 'eslint-no-secrets', 'owasp-exemption'
  )),

  -- OWASP / AITG category this rule defends. Free-text label, used for
  -- grouping in operator UI + Aisha reflection summaries.
  owasp_category   text,                                       -- e.g. 'A10', 'A03', 'AITG-APP-01'

  -- Semgrep-specific fields (NULL for other categories)
  semgrep_pattern  jsonb,                                      -- pattern-either array or single pattern
  semgrep_paths    jsonb,                                      -- {include, exclude} object
  semgrep_message  text,                                       -- human-readable explanation
  languages        text[] DEFAULT ARRAY['typescript']::text[],

  -- Severity (mapped to tool-specific enum at generation time)
  severity         text NOT NULL CHECK (severity IN ('ERROR', 'WARNING', 'INFO')),

  -- Lifecycle
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'deprecated')),
  version          integer NOT NULL DEFAULT 1,

  -- Provenance
  proposed_by      text,                                       -- 'aisha-autonomous', 'operator-{user_id}', 'seed-2026-05-17'
  approved_by      uuid,                                       -- auth.uid() at publish time; NULL while draft
  rationale        text,                                       -- WHY this rule exists (shown in operator UI)

  -- Auto-bumped on every UPDATE
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.aisha_static_defense_rules ENABLE ROW LEVEL SECURITY;

-- Indexes live in aisha/db/sql/indexes/idx_aisha_static_defense_rules_*.sql
-- RLS policy lives in aisha/db/sql/policies/aisha_static_defense_rules_admin_all.sql
-- (one file per artifact — SoT source-separation convention).

COMMENT ON TABLE public.aisha_static_defense_rules IS
  'SoT for static defense rules generated into repo. Edit via Appsmith UI or RPC '
  '(aisha_propose_static_defense_rule + aisha_publish_static_defense_rule), never '
  'edit .semgrep/aisha-rules.yml directly.';
