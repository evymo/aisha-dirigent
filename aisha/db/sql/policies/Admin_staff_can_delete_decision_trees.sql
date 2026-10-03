-- Policy: Admin/staff can delete decision trees

DROP POLICY IF EXISTS "Admin/staff can delete decision trees" ON public.agent_decision_trees;
CREATE POLICY "Admin/staff can delete decision trees" ON public.agent_decision_trees
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((SELECT is_admin_or_staff()));
