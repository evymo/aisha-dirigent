-- Index: mcp_auth_tokens_token_hash_key

CREATE UNIQUE INDEX mcp_auth_tokens_token_hash_key ON public.mcp_auth_tokens USING btree (token_hash);
