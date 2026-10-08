-- Table: aisha_tooling_proposals
-- AISHA-generated Claude Code skill/hook/command proposals.
-- Propagated do .claude/ po approval gate via GitHub PR (managed by WF_AISHA_TOOLING_COMMITTER).
-- Source: docs/deploy/AISHA_SELF_TOOLING.md (META-2 vrstva nad AUTONOMOUS_DEPLOY_FLOW)

CREATE TABLE IF NOT EXISTS public.aisha_tooling_proposals (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  proposed_at         timestamptz  NOT NULL DEFAULT now(),
  proposal_kind       text         NOT NULL CHECK (proposal_kind IN ('skill', 'hook', 'command')),
  artifact_name       text         NOT NULL,           -- 'aisha-blue-green-debug'
  artifact_path       text         NOT NULL,           -- '.claude/skills/.../SKILL.md'
  artifact_content    text         NOT NULL,           -- generated content
  trigger_pattern     jsonb        NOT NULL,           -- pattern that motivated proposal
  occurrence_count    int          NOT NULL DEFAULT 0,
  decision_provenance jsonb        NOT NULL DEFAULT '[]'::jsonb,
  approval_status     text         NOT NULL DEFAULT 'pending'
                      CHECK (approval_status IN (
                        'pending', 'approved', 'rejected', 'expired',
                        'committed', 'reverted'
                      )),
  approval_id         uuid,
  approved_by         uuid,
  approved_at         timestamptz,
  committed_sha       text,                            -- git commit SHA (GitHub contents API) of the artifact
  committed_at        timestamptz,
  reverted_sha        text,                            -- if reverted later
  reverted_at         timestamptz,
  manual_locked       boolean      NOT NULL DEFAULT false,
                                                       -- true = admin lock, AISHA neoverwrites
  proposal_bundle_id  uuid,                            -- group multiple proposals
  metadata            jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (proposal_kind, artifact_path)
);

COMMENT ON TABLE public.aisha_tooling_proposals IS
  'AISHA-generated Claude Code skill/hook/command proposals. Propagated do .claude/ po approval gate via GitHub PR (managed by WF_AISHA_TOOLING_COMMITTER).';
COMMENT ON COLUMN public.aisha_tooling_proposals.trigger_pattern IS
  'Detected pattern (action_sequence, occurrence_count, success_rate) that motivated  this proposal. Used pro decision provenance + dedup check.';
COMMENT ON COLUMN public.aisha_tooling_proposals.manual_locked IS
  'When true, AISHA neoverwrites tento artifact even if pattern still active.  Set by admin po manuální editaci.';
COMMENT ON COLUMN public.aisha_tooling_proposals.proposal_bundle_id IS
  'Optional: groups proposals that should be approved+committed atomically  (e.g., skill + hook for same pattern).';

ALTER TABLE public.aisha_tooling_proposals ENABLE ROW LEVEL SECURITY;
