-- Storage bucket: hero-images
-- Description: Storage for hero slide background images
-- Created: 2026-01-11

-- Create the bucket (if not exists - handled by migration)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'hero-images',
  'hero-images',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Public read access for hero images
DROP POLICY IF EXISTS "Hero images are publicly accessible" ON storage.objects;
CREATE POLICY "Hero images are publicly accessible"
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (bucket_id = 'hero-images');

-- Admin/staff upload access
DROP POLICY IF EXISTS "Admin and staff can upload hero images" ON storage.objects;
CREATE POLICY "Admin and staff can upload hero images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'hero-images'
  AND (SELECT public.is_admin_or_staff())
);

-- Admin/staff update access
DROP POLICY IF EXISTS "Admin and staff can update hero images" ON storage.objects;
CREATE POLICY "Admin and staff can update hero images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'hero-images'
  AND (SELECT public.is_admin_or_staff())
);

-- Admin/staff delete access
DROP POLICY IF EXISTS "Admin and staff can delete hero images" ON storage.objects;
CREATE POLICY "Admin and staff can delete hero images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'hero-images'
  AND (SELECT public.is_admin_or_staff())
);
