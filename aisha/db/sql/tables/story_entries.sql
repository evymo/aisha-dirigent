-- Table: story_entries
-- RLS: ENABLED
--
-- Generalized DISCUSSION node. An entry threads (parent_id) under a SUBJECT.
-- Historically story-only (story_id -> partner_stories); now POLYMORPHIC via
-- (subject_type, subject_id) so ANY content node — story, knowledge_topic,
-- news_article, web_page, event — hosts the same threaded, moderated, audited
-- discussion. story_id is kept (nullable) for the legacy story binding and is
-- mirrored into (subject_type='story', subject_id=story_id) for those rows.

CREATE TABLE IF NOT EXISTS story_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  story_id uuid,
  subject_type text NOT NULL DEFAULT 'story',
  subject_id uuid NOT NULL,
  parent_id uuid,
  entry_type text NOT NULL,
  content text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'visible',
  moderation_reason text,
  is_internal bool NOT NULL DEFAULT false,
  is_pinned bool NOT NULL DEFAULT false,
  document_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  occurred_at timestamptz,
  PRIMARY KEY (id),
  CONSTRAINT story_entries_status_chk CHECK (status IN ('visible','hidden','flagged','deleted')),
  CONSTRAINT story_entries_document_id_fkey FOREIGN KEY (document_id) REFERENCES member_health_documents(id) ON DELETE SET NULL,
  CONSTRAINT story_entries_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES story_entries(id) ON DELETE CASCADE,
  CONSTRAINT story_entries_story_id_fkey FOREIGN KEY (story_id) REFERENCES partner_stories(id) ON DELETE CASCADE
);

COMMENT ON COLUMN story_entries.subject_type IS 'Polymorphic subject kind: story | knowledge_topic | news_article | web_page | event | …';
COMMENT ON COLUMN story_entries.subject_id IS 'Polymorphic subject id (no FK — integrity enforced by create_discussion_entry_audited per subject_type).';
COMMENT ON COLUMN story_entries.status IS 'Moderation state: visible | hidden | flagged | deleted.';

ALTER TABLE story_entries ENABLE ROW LEVEL SECURITY;
