-- Function: public.write_audit_journal
-- Arguments: p_action_type journal_action_type, p_area journal_area, p_details jsonb, p_entity_id text, p_entity_type text, p_new_values jsonb, p_old_values jsonb, p_severity journal_severity, p_summary text, p_tags text[], p_user_id uuid
-- Description: Unified audit journal writer with alphabetically ordered parameters.
--   blockchain_hash (v2): deterministic SHA-256 over the STORED row columns only
--   (action, entity_type, entity_id, created_at epoch, new_data, metadata minus the hash
--   itself) — no now()::text salt, no unstored inputs — so fn_verify_audit_journal_entry
--   can recompute and verify it. Written to the blockchain_hash COLUMN (what
--   get_audit_journal returns) and mirrored into metadata for backward compatibility.
--   user_id is deliberately excluded (FK ON DELETE SET NULL mutates it on user erasure).
-- Security: SECURITY DEFINER with search_path set. PRIVILEGED PRIMITIVE — the caller chooses the
--   actor via p_user_id, so the caller must already be trusted. Reachable only by service_role and
--   by the ~358 in-DB SECURITY DEFINER callers (which run as the OWNER and therefore need no
--   grant). NOT callable with a user JWT — browsers use write_my_audit_journal_entry, which has no
--   p_user_id and pins the actor to auth.uid().
--   2026-07-15 IDOR fix (docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md): the `authenticated`
--   grant let ANY logged-in user author an audit entry attributed to someone else — evidence
--   fabrication in the tamper-evident ledger, and the forged row received a VALID blockchain_hash,
--   so fn_verify_audit_chain attested it as authentic (the hash proves the row was not altered
--   after insertion; it says nothing about who authored it). A guard cannot fix this: the in-DB
--   callers legitimately pass a p_user_id that is not auth.uid() (system entries pass NULL), and a
--   JWT-reading guard cannot tell them apart from a direct PostgREST call, since SECURITY DEFINER
--   swaps current_user but not the JWT claims. Restricting the CALLER is the fix.
--   n8n (AishaAudit, AishaNodeFactory) authenticates with serviceRoleKey and is unaffected.
-- Updated: 2026-07-15 (revoked from `authenticated`; was audit-attribution forgery)
-- Updated: 2026-07-03 (deterministic v2 hash; was salted with session-local now()::text)

CREATE OR REPLACE FUNCTION public.write_audit_journal(
  p_action_type journal_action_type,
  p_area journal_area DEFAULT 'system'::journal_area,
  p_details jsonb DEFAULT NULL,
  p_entity_id text DEFAULT NULL,
  p_entity_type text DEFAULT 'unknown',
  p_new_values jsonb DEFAULT NULL,
  p_old_values jsonb DEFAULT NULL,
  p_severity journal_severity DEFAULT 'info'::journal_severity,
  p_summary text DEFAULT '',
  p_tags text[] DEFAULT '{}',
  p_user_id uuid DEFAULT NULL  -- callers should pass auth.uid() explicitly via named arg or rely on COALESCE in body
  )
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_journal_id uuid;
  v_user_role text;
  v_actual_user_id uuid;
  v_now timestamptz;
  v_new_data jsonb;
  v_metadata jsonb;
  v_hash text;
BEGIN
  v_actual_user_id := COALESCE(p_user_id, auth.uid());

  -- Defensive actor resolution: audit_journal.user_id FKs aisha_auth.users
  -- (ON DELETE SET NULL). An authenticated-but-not-yet-provisioned caller
  -- (see public.ensure_current_user) yields a uid absent from aisha_auth.users
  -- — inserting it raises FK 23503 and ROLLS BACK the very operation being
  -- audited. Audit must never block a real operation, and a dangling actor
  -- reference is meaningless: coalesce the unknown actor to NULL (system).
  IF v_actual_user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM aisha_auth.users u WHERE u.id = v_actual_user_id)
  THEN
    v_actual_user_id := NULL;
  END IF;

  IF v_actual_user_id IS NOT NULL THEN
    SELECT ur.role::text INTO v_user_role
    FROM public.user_roles ur
    WHERE ur.user_id = v_actual_user_id
    LIMIT 1;
  END IF;
  
  v_now := now();
  v_new_data := COALESCE(p_details, p_new_values);
  v_metadata := jsonb_build_object(
    'area', p_area::text,
    'severity', p_severity::text,
    'summary', p_summary,
    'user_role', v_user_role,
    'tags', p_tags
  );

  -- Deterministic v2 hash — every input is a stored column of the row being
  -- inserted (created_at as timezone-independent epoch microseconds; jsonb::text
  -- is canonical), so fn_verify_audit_journal_entry can recompute + verify it.
  v_hash := 'v2:' || encode(digest(convert_to(jsonb_build_object(
    'schema', 'aisha.audit_journal.hash.v2',
    'action', p_action_type::text,
    'entity_type', p_entity_type,
    'entity_id', p_entity_id,
    'created_at_epoch_us', (extract(epoch FROM v_now) * 1000000)::bigint,
    'new_data', v_new_data,
    'metadata', v_metadata
  )::text, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO public.audit_journal (
    user_id,
    action,
    entity_type,
    entity_id,
    metadata,
    new_data,
    blockchain_hash,
    created_at
  ) VALUES (
    v_actual_user_id,
    p_action_type::text,
    p_entity_type,
    p_entity_id,
    v_metadata || jsonb_build_object('blockchain_hash', v_hash),
    v_new_data,
    v_hash,
    v_now
  )
  RETURNING id INTO v_journal_id;
  
  RETURN v_journal_id;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.write_audit_journal(
  p_action_type journal_action_type,
  p_area journal_area,
  p_details jsonb,
  p_entity_id text,
  p_entity_type text,
  p_new_values jsonb,
  p_old_values jsonb,
  p_severity journal_severity,
  p_summary text,
  p_tags text[],
  p_user_id uuid
  ) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.write_audit_journal(
  p_action_type journal_action_type,
  p_area journal_area,
  p_details jsonb,
  p_entity_id text,
  p_entity_type text,
  p_new_values jsonb,
  p_old_values jsonb,
  p_severity journal_severity,
  p_summary text,
  p_tags text[],
  p_user_id uuid
  ) TO service_role;
