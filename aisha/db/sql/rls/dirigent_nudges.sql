-- RLS: dirigent_nudges
-- Source: hand-authored; deploy via migration 20260501000000_dirigent_supervisor.sql
--
-- Read model: anon and authenticated may SELECT only nudges scoped to a story they
-- have access to (via partner_stories visibility). service_role unrestricted (used
-- by edge fn dirigent-supervisor and n8n workflows).

ALTER TABLE public.dirigent_nudges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_full_access_nudges ON public.dirigent_nudges;
CREATE POLICY service_role_full_access_nudges ON public.dirigent_nudges
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- authenticated can read unconsumed nudges for stories they participate in
DROP POLICY IF EXISTS auth_read_own_story_nudges ON public.dirigent_nudges;
CREATE POLICY auth_read_own_story_nudges ON public.dirigent_nudges
  FOR SELECT
  TO authenticated
  USING (
    story_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM story_participants sp
      WHERE sp.story_id = dirigent_nudges.story_id
        AND sp.user_id = auth.uid()
    )
  );

-- anon: no read access (nudges may contain story-specific advisory text)
