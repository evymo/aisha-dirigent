-- Policy: Admins can view all sessions

DROP POLICY IF EXISTS "Admins can view all sessions" ON public.mobile_sessions;
CREATE POLICY "Admins can view all sessions" ON public.mobile_sessions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
