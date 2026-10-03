-- Index: idx_document_sharing_permissions_partner_id
-- Table: document_sharing_permissions

CREATE INDEX IF NOT EXISTS idx_document_sharing_permissions_partner_id 
ON public.document_sharing_permissions(shared_with_partner_id) 
WHERE shared_with_partner_id IS NOT NULL;

-- Index on shared_with_study_id FK (references studies)
