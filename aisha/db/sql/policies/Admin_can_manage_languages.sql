-- Policy: Admin can manage languages

DROP POLICY IF EXISTS "Admin can manage languages" ON public.supported_languages;
CREATE POLICY "Admin can manage languages" ON public.supported_languages
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
