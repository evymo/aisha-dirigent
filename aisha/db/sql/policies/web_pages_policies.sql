-- Policy: Anon can read published active web pages
DROP POLICY IF EXISTS "Anon can read published active web pages" ON public.web_pages;
CREATE POLICY "Anon can read published active web pages"
  ON public.web_pages
  FOR SELECT
  TO anon
  USING (status = 'published' AND is_active = true);

-- Policy: Authenticated can read all active web pages
DROP POLICY IF EXISTS "Authenticated can read all active web pages" ON public.web_pages;
CREATE POLICY "Authenticated can read all active web pages"
  ON public.web_pages
  FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Policy: Admins can manage web pages
DROP POLICY IF EXISTS "Admins can manage web pages" ON public.web_pages;
CREATE POLICY "Admins can manage web pages"
  ON public.web_pages
  FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin_or_staff()));
