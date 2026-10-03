-- Policy: Authenticated users can view active templates

CREATE POLICY "Authenticated users can view active templates" ON public.test_templates
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((is_active = true) AND (auth.role() = 'authenticated'::text)));
