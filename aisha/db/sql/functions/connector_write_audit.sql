-- ============================================================================
-- Source of Truth: connector_write_audit
-- Popis: THE single deterministic v2-hash audit writer for the whole connector
--        substrate (connector doctrine: one hash site, exact inverse of
--        fn_verify_audit_journal_entry). Source-neutral: every connector state
--        change — read, ingest, control write-back, identity federation — audits
--        through here, so provenance is symmetric across all connectors.
--
-- p_source_ref (a story-spine reference, e.g. story_id::text) is folded into the
-- metadata ONLY when non-null, so callers that pass none (hub_write_audit) get a
-- byte-identical row+hash to before. The hash commits over the STORED columns
-- (metadata WITHOUT blockchain_hash) — see fn_verify_audit_journal_entry.
--
-- Internal-only: REVOKEd from PUBLIC; called from other SECURITY DEFINER connector
-- procs running as owner. Never a direct external write path.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.connector_write_audit(
  p_action        text,
  p_action_type   text,
  p_area          text,
  p_severity      text,
  p_summary       text,
  p_entity_type   text,
  p_entity_id     text,
  p_new_data      jsonb   DEFAULT NULL,
  p_actor         uuid    DEFAULT NULL,
  p_source_ref    text    DEFAULT NULL,
  p_extra_metadata jsonb  DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_id        uuid;
  v_now       timestamptz := now();
  v_actor     uuid := p_actor;
  v_user_role text;
  v_metadata  jsonb;
  v_hash      text;
BEGIN
  -- Defensive actor resolution: audit_journal.user_id FKs aisha_auth.users; a
  -- not-yet-provisioned actor would 23503 and roll back the audited operation.
  IF v_actor IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM aisha_auth.users u WHERE u.id = v_actor) THEN
    v_actor := NULL;
  END IF;
  IF v_actor IS NOT NULL THEN
    SELECT ur.role::text INTO v_user_role
    FROM public.user_roles ur WHERE ur.user_id = v_actor LIMIT 1;
  END IF;

  v_metadata := jsonb_build_object(
    'area', p_area,
    'severity', p_severity,
    'summary', p_summary,
    'user_role', v_user_role
  ) || COALESCE(p_extra_metadata, '{}'::jsonb);
  IF p_source_ref IS NOT NULL THEN
    v_metadata := v_metadata || jsonb_build_object('source_ref', p_source_ref);
  END IF;

  v_hash := 'v2:' || encode(extensions.digest(convert_to(jsonb_build_object(
    'schema', 'aisha.audit_journal.hash.v2',
    'action', p_action,
    'entity_type', p_entity_type,
    'entity_id', p_entity_id,
    'created_at_epoch_us', (extract(epoch FROM v_now) * 1000000)::bigint,
    'new_data', p_new_data,
    'metadata', v_metadata
  )::text, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO public.audit_journal (
    user_id, action_type, action, area, severity, summary,
    entity_type, entity_id, new_data, metadata, blockchain_hash, created_at
  ) VALUES (
    v_actor, p_action_type, p_action, p_area, p_severity, p_summary,
    p_entity_type, p_entity_id, p_new_data,
    v_metadata || jsonb_build_object('blockchain_hash', v_hash),
    v_hash, v_now
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.connector_write_audit(text, text, text, text, text, text, text, jsonb, uuid, text, jsonb) FROM PUBLIC;
