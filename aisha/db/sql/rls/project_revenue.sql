-- RLS: project_revenue

DROP POLICY IF EXISTS "Admins can manage all revenue" ON project_revenue;
CREATE POLICY "Admins can manage all revenue"
  ON project_revenue FOR ALL
  USING ((SELECT is_admin_or_staff()));

DROP POLICY IF EXISTS "Specialists can view own revenue" ON project_revenue;
CREATE POLICY "Specialists can view own revenue"
  ON project_revenue FOR SELECT
  USING (story_id IN (
    SELECT id FROM partner_stories WHERE partner_id IN (
      SELECT id FROM partner_profiles WHERE user_id = auth.uid()
    )
  ));

