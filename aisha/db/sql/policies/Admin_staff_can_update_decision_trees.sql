-- Policy: Admin/staff can update decision trees

DROP POLICY IF EXISTS "Admin/staff can update decision trees" ON public.agent_decision_trees;
CREATE POLICY "Admin/staff can update decision trees" ON public.agent_decision_trees
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((SELECT is_admin_or_staff()));
