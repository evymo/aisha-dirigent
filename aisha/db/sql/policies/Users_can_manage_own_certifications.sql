-- Policy: Users can manage own certifications (now read-only)
--
-- Was FOR ALL (USING only, no WITH CHECK) — which let a user INSERT/UPDATE their own
-- partner_certifications row with passed=true. Narrowed to FOR SELECT: writes now go
-- exclusively through submit_partner_certification (SECURITY DEFINER); clients may
-- only read their own. Policy name kept to match the filename.
CREATE POLICY "Users can manage own certifications" ON public.partner_certifications
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
