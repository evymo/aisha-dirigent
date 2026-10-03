-- Index: idx_document_sharing_permissions_study_id
-- Table: document_sharing_permissions

CREATE INDEX IF NOT EXISTS idx_document_sharing_permissions_study_id 
ON public.document_sharing_permissions(shared_with_study_id)
WHERE shared_with_study_id IS NOT NULL;

-- Composite index for common queries (document lookup by user)
