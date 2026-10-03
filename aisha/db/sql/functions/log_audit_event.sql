-- log_audit_event: Alias/wrapper for audit logging from edge functions
-- Called by: aisha-callback/index.ts
-- Semantically identical to insert_audit_journal_entry but with different name
-- for backward compatibility with aisha-callback edge function.
CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_action text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), p_action, p_metadata);
END;
$$;

REVOKE ALL ON FUNCTION public.log_audit_event(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_audit_event(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.log_audit_event(text, jsonb) TO authenticated;
