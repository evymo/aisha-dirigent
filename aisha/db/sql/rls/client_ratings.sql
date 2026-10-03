-- RLS: client_ratings

DROP POLICY IF EXISTS "Specialists can manage own client ratings" ON client_ratings;
CREATE POLICY "Specialists can manage own client ratings"
  ON client_ratings FOR ALL
  USING (rater_specialist_id IN (
    SELECT id FROM partner_profiles WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Clients can view own received ratings" ON client_ratings;
CREATE POLICY "Clients can view own received ratings"
  ON client_ratings FOR SELECT
  USING (rated_client_id = auth.uid());

DROP POLICY IF EXISTS "Admins can manage all client ratings" ON client_ratings;
CREATE POLICY "Admins can manage all client ratings"
  ON client_ratings FOR ALL
  USING ((SELECT is_admin_or_staff()));

