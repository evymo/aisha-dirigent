-- Storage bucket: page-assets
-- Description: Storage for GrapesJS page builder images/assets
-- Created: 2026-04-14

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'page-assets',
  'page-assets',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

-- Public read access for page assets
DROP POLICY IF EXISTS "Page assets are publicly accessible" ON storage.objects;
CREATE POLICY "Page assets are publicly accessible"
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (bucket_id = 'page-assets');

-- Admin/staff upload access
DROP POLICY IF EXISTS "Admin and staff can upload page assets" ON storage.objects;
CREATE POLICY "Admin and staff can upload page assets"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'page-assets'
  AND (SELECT public.is_admin_or_staff())
);

-- Admin/staff update access
DROP POLICY IF EXISTS "Admin and staff can update page assets" ON storage.objects;
CREATE POLICY "Admin and staff can update page assets"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'page-assets'
  AND (SELECT public.is_admin_or_staff())
);

-- Admin/staff delete access
DROP POLICY IF EXISTS "Admin and staff can delete page assets" ON storage.objects;
CREATE POLICY "Admin and staff can delete page assets"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'page-assets'
  AND (SELECT public.is_admin_or_staff())
);
