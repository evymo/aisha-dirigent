-- Constraint: fk_improvement_proposals_agent_slug
-- Table: improvement_proposals
-- Back-ported from migration:
--   improvement_proposals.agent_slug → agent_catalog.slug (ON UPDATE CASCADE)
-- Deferred so agent_catalog is present and slug renames cascade.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_improvement_proposals_agent_slug'
  ) THEN
    ALTER TABLE public.improvement_proposals
      ADD CONSTRAINT fk_improvement_proposals_agent_slug
      FOREIGN KEY (agent_slug)
      REFERENCES public.agent_catalog(slug)
      ON UPDATE CASCADE;
  END IF;
END $$;
