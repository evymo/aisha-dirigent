-- RLS: consultation_bookings

DROP POLICY IF EXISTS "Members can view own bookings" ON consultation_bookings;
CREATE POLICY "Members can view own bookings"
  ON consultation_bookings FOR SELECT
  USING (member_id = auth.uid());

DROP POLICY IF EXISTS "Members can create bookings" ON consultation_bookings;
CREATE POLICY "Members can create bookings"
  ON consultation_bookings FOR INSERT
  WITH CHECK (member_id = auth.uid());

DROP POLICY IF EXISTS "Specialists can view assigned bookings" ON consultation_bookings;
CREATE POLICY "Specialists can view assigned bookings"
  ON consultation_bookings FOR SELECT
  USING (specialist_id IN (
    SELECT id FROM partner_profiles WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Admins can manage all bookings" ON consultation_bookings;
CREATE POLICY "Admins can manage all bookings"
  ON consultation_bookings FOR ALL
  USING ((SELECT is_admin_or_staff()));

