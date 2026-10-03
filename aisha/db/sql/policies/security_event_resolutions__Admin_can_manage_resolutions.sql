-- Policy: Admin can manage resolutions

DROP POLICY IF EXISTS "Admin can manage resolutions" ON public.security_event_resolutions;
CREATE POLICY "Admin can manage resolutions" ON public.security_event_resolutions
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
