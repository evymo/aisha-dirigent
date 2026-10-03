-- Index: idx_member_health_documents_verified_by
-- Table: member_health_documents

CREATE INDEX IF NOT EXISTS idx_member_health_documents_verified_by ON public.member_health_documents(verified_by);
