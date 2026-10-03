-- Index: idx_workflow_status_transitions_lookup
-- Speeds up get_allowed_kanban_transitions and the validator inside
-- update_story_status_audited:
--   SELECT 1 FROM workflow_status_transitions
--    WHERE from_status = $1 AND to_status = $2 AND is_active;

CREATE INDEX IF NOT EXISTS idx_workflow_status_transitions_lookup
  ON public.workflow_status_transitions (from_status, to_status)
  WHERE is_active = true;
