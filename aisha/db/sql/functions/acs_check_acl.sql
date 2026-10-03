-- Function: acs_check_acl
CREATE OR REPLACE FUNCTION acs_check_acl(p_sender text, p_schema_ref text, p_recipient text)
RETURNS boolean
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM acs_agent_acl a
    WHERE a.allowed
      AND a.schema_ref = p_schema_ref
      AND (a.sender_pattern = p_sender
           OR (a.sender_pattern LIKE '%.' AND p_sender LIKE a.sender_pattern || '%'))
      AND (a.recipient_pattern = p_recipient
           OR (a.recipient_pattern LIKE '%.' AND p_recipient LIKE a.recipient_pattern || '%'))
  );
$$;

-- SECURITY INVOKER read-only helper. Least-privilege: callable by the ACS flow
-- (service_role) + authenticated, NOT PUBLIC/anon (anon reads 0 acs_agent_acl
-- rows under RLS anyway, so the check is useless to it).
REVOKE ALL ON FUNCTION acs_check_acl(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION acs_check_acl(text, text, text) TO authenticated, service_role;
