-- Policy: Anyone can view active consent items

CREATE POLICY "Anyone can view active consent items" ON public.study_consent_items
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_active = true));
