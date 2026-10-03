-- RLS: revenue_splits

DROP POLICY IF EXISTS "Admins can manage all splits" ON revenue_splits;
CREATE POLICY "Admins can manage all splits"
  ON revenue_splits FOR ALL
  USING ((SELECT is_admin_or_staff()));

DROP POLICY IF EXISTS "Recipients can view own splits" ON revenue_splits;
CREATE POLICY "Recipients can view own splits"
  ON revenue_splits FOR SELECT
  USING (recipient_id = auth.uid());

