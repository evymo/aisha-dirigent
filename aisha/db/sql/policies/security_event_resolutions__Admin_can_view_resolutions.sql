-- Policy: Admin can view resolutions

DROP POLICY IF EXISTS "Admin can view resolutions" ON public.security_event_resolutions;
CREATE POLICY "Admin can view resolutions" ON public.security_event_resolutions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
