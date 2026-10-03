-- Storage bucket: product-images
-- Purpose: Product images for e-commerce

-- Create bucket if not exists
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images', 
  true,
  5242880, -- 5MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
ON CONFLICT (id) DO NOTHING;

-- RLS Policies for product-images bucket

-- Public read access (products are public)
DROP POLICY IF EXISTS "Public can view product images" ON storage.objects;
CREATE POLICY "Public can view product images"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'product-images');

-- Admin/staff can upload images
DROP POLICY IF EXISTS "Admin and staff can upload product images" ON storage.objects;
CREATE POLICY "Admin and staff can upload product images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'product-images'
  AND (SELECT public.is_admin_or_staff())
);

-- Admin/staff can update images
DROP POLICY IF EXISTS "Admin and staff can update product images" ON storage.objects;
CREATE POLICY "Admin and staff can update product images"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'product-images'
  AND (SELECT public.is_admin_or_staff())
);

-- Admin/staff can delete images
DROP POLICY IF EXISTS "Admin and staff can delete product images" ON storage.objects;
CREATE POLICY "Admin and staff can delete product images"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'product-images'
  AND (SELECT public.is_admin_or_staff())
);
