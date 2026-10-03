-- Table: story_labels
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS story_labels (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL,
  story_id uuid NOT NULL,
  label text NOT NULL,
  color text NOT NULL DEFAULT 'gray'::text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT story_labels_story_id_label_key UNIQUE (label, story_id),
  CONSTRAINT story_labels_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES partner_profiles(id) ON DELETE CASCADE,
  CONSTRAINT story_labels_story_id_fkey FOREIGN KEY (story_id) REFERENCES partner_stories(id) ON DELETE CASCADE
);

ALTER TABLE story_labels ENABLE ROW LEVEL SECURITY;

-- Columns added by later migrations (back-port reconciliation):
ALTER TABLE public.story_labels ADD COLUMN IF NOT EXISTS resource_type text NOT NULL DEFAULT 'story'::text;
ALTER TABLE public.story_labels ADD COLUMN IF NOT EXISTS resource_id uuid;

-- Sladění s resource-štítky (2026-09-06, ADR-003 K4). Back-port sloupců
-- resource_type/resource_id (výše) nechal partner_id i story_id NOT NULL, takže
-- KAŽDÝ štítek nad účtem (audience_tag_resource, audience_admin_bulk_tag) padal
-- na not-null — naměřeno v prod (0 řádků story_labels) i na throwaway DB.
-- Štítek příběhu drží story_id, štítek zdroje drží resource_id; partner_id je
-- kontext partnera, když volající nějaký má (get_current_partner_id), jinak NULL.
ALTER TABLE public.story_labels ALTER COLUMN partner_id DROP NOT NULL;
ALTER TABLE public.story_labels ALTER COLUMN story_id DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'story_labels_target_check' AND conrelid = 'public.story_labels'::regclass
  ) THEN
    ALTER TABLE public.story_labels ADD CONSTRAINT story_labels_target_check
      CHECK (story_id IS NOT NULL OR resource_id IS NOT NULL);
  END IF;
END $$;
-- Jedinečnost štítku nad zdrojem: sql/indexes/story_labels_resource_label_key.sql
-- (story_labels_story_id_label_key kryje jen příběhy).
