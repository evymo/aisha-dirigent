-- RLS: specialist_ratings

DROP POLICY IF EXISTS "Public ratings are visible" ON specialist_ratings;
CREATE POLICY "Public ratings are visible"
  ON specialist_ratings FOR SELECT
  USING (is_public = true);

DROP POLICY IF EXISTS "Raters can manage own ratings" ON specialist_ratings;
CREATE POLICY "Raters can manage own ratings"
  ON specialist_ratings FOR ALL
  USING (rater_id = auth.uid());

DROP POLICY IF EXISTS "Specialists can view own received ratings" ON specialist_ratings;
CREATE POLICY "Specialists can view own received ratings"
  ON specialist_ratings FOR SELECT
  USING (rated_specialist_id IN (
    SELECT id FROM partner_profiles WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Admins can manage all ratings" ON specialist_ratings;
CREATE POLICY "Admins can manage all ratings"
  ON specialist_ratings FOR ALL
  USING ((SELECT is_admin_or_staff()));

