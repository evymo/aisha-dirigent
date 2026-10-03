-- RLS: specialist_activity_metrics

DROP POLICY IF EXISTS "Anyone can read metrics" ON specialist_activity_metrics;
CREATE POLICY "Anyone can read metrics"
  ON specialist_activity_metrics FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Service role can update" ON specialist_activity_metrics;
CREATE POLICY "Service role can update"
  ON specialist_activity_metrics FOR ALL
  USING ((SELECT is_admin_or_staff()));

