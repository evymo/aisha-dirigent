-- Constraint: mcp_auth_tokens_scoped_to_story_id_fkey
-- Table: mcp_auth_tokens
-- §8.5 bind-at-issuance: scoped_to_story_id → partner_stories.id (FK integrity).
-- (user_id deliberately has NO FK — mirrors created_by; aisha_auth.users is JIT-
--  provisioned, so a hard FK there would break token creation. See [[aisha-auth-jit-409]].)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'mcp_auth_tokens_scoped_to_story_id_fkey'
  ) THEN
    ALTER TABLE public.mcp_auth_tokens
      ADD CONSTRAINT mcp_auth_tokens_scoped_to_story_id_fkey
      FOREIGN KEY (scoped_to_story_id)
      REFERENCES public.partner_stories(id) ON DELETE CASCADE;
  END IF;
END $$;
