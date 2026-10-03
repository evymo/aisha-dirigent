-- Policy: Members can create appointments

CREATE POLICY "Members can create appointments" ON public.partner_appointments
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = member_id));
