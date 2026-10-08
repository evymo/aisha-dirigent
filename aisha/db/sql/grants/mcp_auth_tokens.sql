-- Grants: mcp_auth_tokens

GRANT SELECT ON public.mcp_auth_tokens TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.mcp_auth_tokens TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.mcp_auth_tokens TO service_role;
