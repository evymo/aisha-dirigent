-- Policy: Service role full access to lead submissions
-- Public inserts arrive via the SECURITY DEFINER capture_lead() RPC (runs as
-- owner, bypasses RLS). Triage status changes / deletes run as service_role.

CREATE POLICY "Service role full access to lead submissions" ON public.lead_submissions
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((auth.role() = 'service_role'::text))
  WITH CHECK ((auth.role() = 'service_role'::text));
