-- Table: knowledge_topic_links
-- Links knowledge topics to archive documents or external URLs
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS knowledge_topic_links (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL,
  archive_document_id uuid,
  external_url text,
  link_type text NOT NULL DEFAULT 'other' CHECK (link_type IN ('archive','paper','guideline','policy','product','batch','other')),
  product_id uuid,
  production_batch_id uuid,
  is_verified boolean DEFAULT false,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT knowledge_topic_links_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES knowledge_topics(id) ON DELETE CASCADE,
  CONSTRAINT knowledge_topic_links_archive_document_id_fkey FOREIGN KEY (archive_document_id) REFERENCES archive_documents(id),
  CONSTRAINT knowledge_topic_links_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT knowledge_topic_links_batch_id_fkey FOREIGN KEY (production_batch_id) REFERENCES production_batches(id)
);

ALTER TABLE knowledge_topic_links ENABLE ROW LEVEL SECURITY;

-- Grants
GRANT SELECT ON knowledge_topic_links TO anon;
GRANT SELECT ON knowledge_topic_links TO authenticated;
GRANT ALL ON knowledge_topic_links TO service_role;
