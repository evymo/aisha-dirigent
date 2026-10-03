-- Policy: Admins can view all responses

DROP POLICY IF EXISTS "Admins can view all responses" ON public.onboarding_responses;
CREATE POLICY "Admins can view all responses" ON public.onboarding_responses
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
