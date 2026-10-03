-- Policy: Availability is viewable by everyone

CREATE POLICY "Availability is viewable by everyone" ON public.partner_availability
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
