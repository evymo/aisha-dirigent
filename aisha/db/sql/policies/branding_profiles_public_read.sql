-- Policy: Anyone can read published branding profiles (needed for login pages)
CREATE POLICY "Public can read published branding profiles"
  ON public.branding_profiles
  FOR SELECT
  TO public
  USING (status = 'published');

-- Policy: Admin can read/write all branding profiles (including drafts)
CREATE POLICY "Admin full access to branding profiles"
  ON public.branding_profiles
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- Policy: Staff can read all branding profiles
CREATE POLICY "Staff can read branding profiles"
  ON public.branding_profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'staff'))
  );
