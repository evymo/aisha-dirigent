-- Storage bucket: wearable-analysis
-- Description: Private analysis outputs generated from wearable sync batches
-- Public: NO

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'wearable-analysis',
  'wearable-analysis',
  false,
  10485760, -- 10MB limit
  ARRAY[
    'application/json',
    'text/plain',
    'text/csv'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Users can upload their own wearable analysis files.
-- Storage path format: {user_id}/{sync_batch_id}/filename
DROP POLICY IF EXISTS "Users can upload their own wearable analysis files" ON storage.objects;
CREATE POLICY "Users can upload their own wearable analysis files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'wearable-analysis'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Users can view their own wearable analysis files.
DROP POLICY IF EXISTS "Users can view their own wearable analysis files" ON storage.objects;
CREATE POLICY "Users can view their own wearable analysis files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'wearable-analysis'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Users can update their own wearable analysis files.
DROP POLICY IF EXISTS "Users can update their own wearable analysis files" ON storage.objects;
CREATE POLICY "Users can update their own wearable analysis files"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'wearable-analysis'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Users can delete their own wearable analysis files.
DROP POLICY IF EXISTS "Users can delete their own wearable analysis files" ON storage.objects;
CREATE POLICY "Users can delete their own wearable analysis files"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'wearable-analysis'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Admin/staff can view all wearable analysis files.
DROP POLICY IF EXISTS "Admins can view all wearable analysis files" ON storage.objects;
CREATE POLICY "Admins can view all wearable analysis files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'wearable-analysis'
  AND (SELECT public.is_admin_or_staff())
);
