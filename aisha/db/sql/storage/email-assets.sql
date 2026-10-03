-- Storage bucket: email-assets
-- Description: Public assets used in transactional emails (logos, badges)
-- Created: 2026-01-24

-- Create the bucket (if not exists - handled by migration)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'email-assets',
  'email-assets',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

-- Public read access for email assets
DROP POLICY IF EXISTS "Email assets are publicly accessible" ON storage.objects;
CREATE POLICY "Email assets are publicly accessible"
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (bucket_id = 'email-assets');

-- Admin/staff upload access
DROP POLICY IF EXISTS "Admin and staff can upload email assets" ON storage.objects;
CREATE POLICY "Admin and staff can upload email assets"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'email-assets'
  AND (SELECT public.is_admin_or_staff())
);

-- Admin/staff update access
DROP POLICY IF EXISTS "Admin and staff can update email assets" ON storage.objects;
CREATE POLICY "Admin and staff can update email assets"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'email-assets'
  AND (SELECT public.is_admin_or_staff())
);

-- Admin/staff delete access
DROP POLICY IF EXISTS "Admin and staff can delete email assets" ON storage.objects;
CREATE POLICY "Admin and staff can delete email assets"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'email-assets'
  AND (SELECT public.is_admin_or_staff())
);
