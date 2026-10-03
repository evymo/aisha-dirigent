-- Table: entry_type_definitions
-- RLS: ENABLED
--
-- Template/registry for DISCUSSION POST TYPES. story_entries.entry_type is an
-- open text discriminator; this registry is the catalog that drives it — exactly
-- like the runtime-block registry drives web blocks. A post type is a row here:
-- an i18n-keyed name/description, the subject_types it applies to, an optional
-- metadata JSON-schema, and an optional render block. The STACK ships the
-- universal types (comment, question); an IMPLEMENTATION seeds its own types
-- (e.g. teaching-note, announcement, …) into the same registry — no schema
-- change, generic mechanism, implementation-owned types.

CREATE TABLE IF NOT EXISTS entry_type_definitions (
  entry_type       text         PRIMARY KEY,
  name_key         text         NOT NULL,
  description_key  text,
  applies_to       text[]       NOT NULL DEFAULT '{}'::text[],
  metadata_schema  jsonb        NOT NULL DEFAULT '{}'::jsonb,
  render_block     text,
  is_active        boolean      NOT NULL DEFAULT true,
  sort_order       integer      NOT NULL DEFAULT 100,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE entry_type_definitions IS 'Registry/template for discussion post types (story_entries.entry_type). Stack ships universal types; implementations add their own.';
COMMENT ON COLUMN entry_type_definitions.applies_to IS 'subject_types this post type is valid for (story|news_article|knowledge_topic|web_page|…). Empty = all subjects.';
COMMENT ON COLUMN entry_type_definitions.metadata_schema IS 'Optional JSON-schema for the entry metadata of this type.';
COMMENT ON COLUMN entry_type_definitions.render_block IS 'Optional runtime-block id that renders this entry type in the web SPA.';

ALTER TABLE entry_type_definitions ENABLE ROW LEVEL SECURITY;
