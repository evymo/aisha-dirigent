-- Index: idx_document_sharing_permissions_user_document
-- Table: document_sharing_permissions

CREATE INDEX IF NOT EXISTS idx_document_sharing_permissions_user_document 
ON public.document_sharing_permissions(user_id, document_id);
