-- Table: archive_documents
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS archive_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL,
  content text,
  document_type text NOT NULL DEFAULT 'document'::text,
  category text,
  file_url text,
  metadata jsonb,
  is_public bool DEFAULT false,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  title_key text,
  description text,
  description_key text,
  decade text,
  year int4,
  facility text,
  place text,
  people text[],
  keywords text[],
  preparation text,
  provenance_badge text NOT NULL DEFAULT 'original'::text,
  is_featured bool DEFAULT false,
  original_language text,
  source_publication text,
  page_count int4,
  scan_url text,
  transcript_url text,
  summary_key text,
  what_you_are_looking_at text,
  what_you_are_looking_at_key text,
  standards_context text,
  standards_context_key text,
  editorial_note text,
  editorial_note_key text,
  related_documents text[],
  parent_document_id uuid,
  version text,
  version_date date,
  version_notes text,
  is_current_version bool DEFAULT true,
  storage_path text,
  is_download_public bool DEFAULT false,
  PRIMARY KEY (id),
  CONSTRAINT archive_documents_slug_key UNIQUE (slug),
  CONSTRAINT archive_documents_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT archive_documents_parent_document_id_fkey FOREIGN KEY (parent_document_id) REFERENCES archive_documents(id)
);

ALTER TABLE archive_documents ENABLE ROW LEVEL SECURITY;

-- Grants: public archive
GRANT SELECT ON archive_documents TO anon;
GRANT SELECT ON archive_documents TO authenticated;
GRANT ALL ON archive_documents TO service_role;
