-- Policy: Members can view own appointments

CREATE POLICY "Members can view own appointments" ON public.partner_appointments
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = member_id));
