-- Function: public.write_my_audit_journal_entry
-- Arguments: p_action_type journal_action_type, p_area journal_area, p_details jsonb, p_entity_id text, p_entity_type text, p_new_values jsonb, p_old_values jsonb, p_summary text
-- Description: Self-attributed audit entry from a browser session. The ONLY audit-journal writer
--   reachable with a user JWT; write_audit_journal itself is service_role-only as of 2026-07-15.
--
--   WHY THIS EXISTS: write_audit_journal was GRANTed to `authenticated`, and it takes p_user_id.
--   Any logged-in user could therefore POST /rest/v1/rpc/write_audit_journal and author an entry
--   attributed to SOMEONE ELSE — fabricating evidence in the tamper-evident ledger. Worse, the
--   forged row got a VALID blockchain_hash, so fn_verify_audit_chain would attest it as authentic:
--   the hash proves the row was not altered AFTER the fact, it says nothing about who authored it.
--   Revoking the generic writer is the fix; the browser keeps this narrow, self-pinned door.
--   See docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md.
--
-- Security: SECURITY DEFINER. There is deliberately NO p_user_id parameter — the actor is pinned
--   to auth.uid() and cannot be chosen by the caller, which is what makes attribution forgery
--   structurally impossible rather than merely guarded. Severity is likewise fixed at 'info' so a
--   caller cannot forge 'critical' entries and drown real signals. p_action_type/p_area stay
--   caller-supplied but are ENUM-constrained by the database.
-- Params: alphabetical (see src/tests/db/rpc-params-alphabetical.test.ts).
-- @audit: none — this IS the audit writer.

CREATE OR REPLACE FUNCTION public.write_my_audit_journal_entry(
  p_action_type journal_action_type,
  p_area        journal_area DEFAULT 'system'::journal_area,
  p_details     jsonb DEFAULT NULL,
  p_entity_id   text DEFAULT NULL,
  p_entity_type text DEFAULT 'unknown',
  p_new_values  jsonb DEFAULT NULL,
  p_old_values  jsonb DEFAULT NULL,
  p_summary     text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Fail closed: an unauthenticated caller has no identity to attribute the entry to, and an
  -- unattributed "self" entry is meaningless. anon has no grant either — this is defence in depth.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  RETURN public.write_audit_journal(
    p_action_type := p_action_type,
    p_area        := p_area,
    p_details     := p_details,
    p_entity_id   := p_entity_id,
    p_entity_type := p_entity_type,
    p_new_values  := p_new_values,
    p_old_values  := p_old_values,
    p_severity    := 'info'::journal_severity,
    p_summary     := p_summary,
    p_tags        := ARRAY['self-reported'],
    p_user_id     := auth.uid()
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.write_my_audit_journal_entry(p_action_type journal_action_type, p_area journal_area, p_details jsonb, p_entity_id text, p_entity_type text, p_new_values jsonb, p_old_values jsonb, p_summary text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.write_my_audit_journal_entry(p_action_type journal_action_type, p_area journal_area, p_details jsonb, p_entity_id text, p_entity_type text, p_new_values jsonb, p_old_values jsonb, p_summary text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.write_my_audit_journal_entry(p_action_type journal_action_type, p_area journal_area, p_details jsonb, p_entity_id text, p_entity_type text, p_new_values jsonb, p_old_values jsonb, p_summary text) TO service_role;
