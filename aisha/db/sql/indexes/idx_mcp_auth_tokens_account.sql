-- Index: idx_mcp_auth_tokens_account

CREATE INDEX idx_mcp_auth_tokens_account ON public.mcp_auth_tokens USING btree (account_id) WHERE (account_id IS NOT NULL);
