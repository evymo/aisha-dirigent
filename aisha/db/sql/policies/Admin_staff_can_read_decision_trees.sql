-- Policy: Admin/staff can read decision trees

DROP POLICY IF EXISTS "Admin/staff can read decision trees" ON public.agent_decision_trees;
CREATE POLICY "Admin/staff can read decision trees" ON public.agent_decision_trees
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT is_admin_or_staff()));
