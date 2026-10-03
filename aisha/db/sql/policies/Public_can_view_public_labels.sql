-- Policy: Public can view public labels

CREATE POLICY "Public can view public labels" ON public.product_label_archive
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_public = true));
