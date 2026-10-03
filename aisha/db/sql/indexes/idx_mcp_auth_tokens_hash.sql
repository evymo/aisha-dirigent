-- Index: idx_mcp_auth_tokens_hash

CREATE INDEX idx_mcp_auth_tokens_hash ON public.mcp_auth_tokens USING btree (token_hash) WHERE (is_active = true);
