-- Index: idx_mcp_auth_tokens_project

CREATE INDEX idx_mcp_auth_tokens_project ON public.mcp_auth_tokens USING btree (project_id) WHERE (project_id IS NOT NULL);
