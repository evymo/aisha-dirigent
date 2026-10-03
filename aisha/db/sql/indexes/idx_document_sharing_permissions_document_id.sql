-- Index: idx_document_sharing_permissions_document_id
-- Table: document_sharing_permissions

CREATE INDEX IF NOT EXISTS idx_document_sharing_permissions_document_id 
ON public.document_sharing_permissions(document_id);

-- Index on shared_with_partner_id FK (references partner_profiles)
