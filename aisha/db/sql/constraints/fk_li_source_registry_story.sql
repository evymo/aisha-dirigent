-- Constraint: fk_li_source_registry_story
-- Table: li_source_registry
-- story_id na evidenčním registru dokladů odkazuje na story spine (namespace
-- kontext bundle). ON DELETE SET NULL: smazání story nesmí zahodit faktickou
-- evidenci o dokladech — jen odpojí kontext. story_id je nullable (bundle bez
-- story_id je legitimní generický běh). conname guard = idempotentní re-apply.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_li_source_registry_story'
  ) THEN
    ALTER TABLE public.li_source_registry
      ADD CONSTRAINT fk_li_source_registry_story
      FOREIGN KEY (story_id)
      REFERENCES public.partner_stories(id)
      ON DELETE SET NULL;
  END IF;
END $$;
