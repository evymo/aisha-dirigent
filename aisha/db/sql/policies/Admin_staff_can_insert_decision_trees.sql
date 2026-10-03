-- Policy: Admin/staff can insert decision trees

DROP POLICY IF EXISTS "Admin/staff can insert decision trees" ON public.agent_decision_trees;
CREATE POLICY "Admin/staff can insert decision trees" ON public.agent_decision_trees
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((SELECT is_admin_or_staff()));
