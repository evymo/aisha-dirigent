-- Index: idx_workflow_statuses_active_order
-- Speeds up list_workflow_statuses (kanban column header render):
--   SELECT * FROM workflow_statuses WHERE is_active ORDER BY sort_order;

CREATE INDEX IF NOT EXISTS idx_workflow_statuses_active_order
  ON public.workflow_statuses (sort_order ASC)
  WHERE is_active = true;
