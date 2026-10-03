-- Table: member_health_documents
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS member_health_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  document_type text,
  file_url text,
  file_name text,
  file_size int4,
  mime_type text,
  description text,
  created_at timestamptz DEFAULT now(),
  uploaded_at timestamptz DEFAULT now(),
  verified_at timestamptz,
  verified_by uuid,
  study_registration_id uuid,
  file_path text,
  title text,
  category health_document_category DEFAULT 'other'::health_document_category,
  document_date date,
  processing_status document_processing_status DEFAULT 'pending'::document_processing_status,
  -- AV/safety gate, orthogonal to processing_status the OCR/AI lifecycle. Same value set and
  -- gating predicate as knowledge_items.quarantine_status, so one platform primitive governs
  -- malware quarantine across tables. Column DEFAULT 'clear' keeps existing and non-upload rows
  -- promotable so there is no regression; the upload preflight overrides it to 'flagged' so a
  -- new upload is fail-closed until the AV scan promotes it. Sole post-upload writer is
  -- record_document_av_scan_audited.
  quarantine_status text DEFAULT 'clear'::text NOT NULL
    CHECK (quarantine_status IN ('clear', 'flagged', 'quarantined', 'reviewed', 'reinstated')),
  av_signature text,
  av_scanned_at timestamptz,
  extracted_text text,
  ocr_metadata jsonb,
  capture_metadata jsonb,
  extracted_data jsonb,
  ai_summary text,
  ai_categories text[],
  ai_insights jsonb,
  processed_at timestamptz,
  contributed_to_statistics bool DEFAULT false,
  contributed_at timestamptz,
  tokens_awarded numeric DEFAULT 0,
  tokens_awarded_at timestamptz,
  review_notes text,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT member_health_documents_study_registration_id_fkey FOREIGN KEY (study_registration_id) REFERENCES study_registrations(id),
  CONSTRAINT member_health_documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  CONSTRAINT member_health_documents_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE member_health_documents ENABLE ROW LEVEL SECURITY;

-- Grants: user-owned sensitive data documents
GRANT SELECT, INSERT, UPDATE, DELETE ON member_health_documents TO authenticated;
GRANT ALL ON member_health_documents TO service_role;
