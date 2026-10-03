-- Constraint: fk_knowledge_items_story
-- Table: knowledge_items
-- Back-ported from migration. NOTE: knowledge_items already carries an inline
-- column-level FK (knowledge_items_story_id_fkey) with the same definition;
-- clean-main additionally adds this explicitly-named constraint, so we reproduce
-- it for parity. The conname guard prevents a duplicate-name error.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_knowledge_items_story'
  ) THEN
    ALTER TABLE public.knowledge_items
      ADD CONSTRAINT fk_knowledge_items_story
      FOREIGN KEY (story_id)
      REFERENCES public.partner_stories(id)
      ON DELETE CASCADE;
  END IF;
END $$;
