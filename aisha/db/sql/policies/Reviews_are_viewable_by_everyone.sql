-- Policy: Reviews are viewable by everyone

CREATE POLICY "Reviews are viewable by everyone" ON public.partner_appointment_reviews
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
