-- RLS: workflow_statuses
-- Read by any authenticated user (UI config — kanban swimlane labels are
-- needed by every page that renders a story status). Writes admin/staff only.

ALTER TABLE public.workflow_statuses ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read ALL rows (including is_active=false) so
-- admins managing statuses see disabled rows. UI layer filters for non-admin
-- consumers via list_workflow_statuses RPC (active-only).
DROP POLICY IF EXISTS "authenticated_can_read_workflow_statuses" ON public.workflow_statuses;
CREATE POLICY "authenticated_can_read_workflow_statuses"
  ON public.workflow_statuses
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

-- Admin/staff manage rows. PERMISSIVE OR combines with the SELECT policy
-- above without conflict because INSERT/UPDATE/DELETE need this policy.
DROP POLICY IF EXISTS "admin_staff_can_manage_workflow_statuses" ON public.workflow_statuses;
CREATE POLICY "admin_staff_can_manage_workflow_statuses"
  ON public.workflow_statuses
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((SELECT public.is_admin_or_staff()))
  WITH CHECK ((SELECT public.is_admin_or_staff()));
