-- Index: idx_mcp_auth_tokens_scoped_story
-- §8.5: lookups + FK support for the bind-at-issuance story scope.

CREATE INDEX IF NOT EXISTS idx_mcp_auth_tokens_scoped_story
  ON public.mcp_auth_tokens USING btree (scoped_to_story_id);
