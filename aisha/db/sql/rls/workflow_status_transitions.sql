-- RLS: workflow_status_transitions
-- Read by any authenticated user (kanban drag-drop UI needs to know which
-- transitions are legal before showing them). Writes admin/staff only.

ALTER TABLE public.workflow_status_transitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_can_read_workflow_status_transitions" ON public.workflow_status_transitions;
CREATE POLICY "authenticated_can_read_workflow_status_transitions"
  ON public.workflow_status_transitions
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "admin_staff_can_manage_workflow_status_transitions" ON public.workflow_status_transitions;
CREATE POLICY "admin_staff_can_manage_workflow_status_transitions"
  ON public.workflow_status_transitions
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((SELECT public.is_admin_or_staff()))
  WITH CHECK ((SELECT public.is_admin_or_staff()));
