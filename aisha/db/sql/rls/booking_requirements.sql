-- RLS: booking_requirements

CREATE POLICY "Booking participants can view"
  ON booking_requirements FOR SELECT
  USING (booking_id IN (
    SELECT id FROM consultation_bookings
    WHERE member_id = auth.uid()
       OR specialist_id IN (SELECT id FROM partner_profiles WHERE user_id = auth.uid())
  ));

CREATE POLICY "Members can create requirements"
  ON booking_requirements FOR INSERT
  WITH CHECK (booking_id IN (
    SELECT id FROM consultation_bookings WHERE member_id = auth.uid()
  ));

