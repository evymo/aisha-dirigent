-- Index: idx_pws_assigned_user
-- Nárokové rameno „uživatel": s.assigned_user_id = scope.me (viz
-- idx_pws_assigned_role.sql).
CREATE INDEX IF NOT EXISTS idx_pws_assigned_user
  ON public.production_workflow_steps (assigned_user_id);
