ALTER TABLE production_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage metrics" ON production_metrics;
CREATE POLICY "Admins can manage metrics" ON production_metrics
  FOR ALL USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
