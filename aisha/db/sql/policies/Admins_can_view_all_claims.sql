-- Policy: Admins can view all claims

DROP POLICY IF EXISTS "Admins can view all claims" ON public.invitation_claims;
CREATE POLICY "Admins can view all claims" ON public.invitation_claims
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
