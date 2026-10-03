-- Policy: Admins can view all consents

DROP POLICY IF EXISTS "Admins can view all consents" ON public.consents;
CREATE POLICY "Admins can view all consents" ON public.consents
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
