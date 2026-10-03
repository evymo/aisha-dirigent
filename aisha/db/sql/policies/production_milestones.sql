ALTER TABLE production_milestones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage milestones" ON production_milestones;
CREATE POLICY "Admins can manage milestones" ON production_milestones
  FOR ALL USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
