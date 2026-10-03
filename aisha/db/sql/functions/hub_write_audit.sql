-- ============================================================================
-- Source of Truth: hub_write_audit
-- Popis: Thin backward-compatible alias for connector_write_audit (the connector
--        doctrine's ONE v2-hash audit site). Kept so the hub_* write
--        functions (apply/confirm/pair/sweep) and suite 15 keep calling a stable
--        name; new connector code calls connector_write_audit directly (with a
--        source_ref). Passing p_source_ref = NULL yields a byte-identical row+hash
--        to the pre-doctrine implementation, so existing provenance verifies.
--
-- Internal-only: REVOKEd from PUBLIC (callers are SECURITY DEFINER, run as owner).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hub_write_audit(
  p_action        text,
  p_action_type   text,
  p_area          text,
  p_severity      text,
  p_summary       text,
  p_entity_type   text,
  p_entity_id     text,
  p_new_data      jsonb   DEFAULT NULL,
  p_actor         uuid    DEFAULT NULL,
  p_extra_metadata jsonb  DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  RETURN public.connector_write_audit(
    p_action, p_action_type, p_area, p_severity, p_summary,
    p_entity_type, p_entity_id, p_new_data, p_actor, NULL, p_extra_metadata);
END;
$$;

REVOKE ALL ON FUNCTION public.hub_write_audit(text, text, text, text, text, text, text, jsonb, uuid, jsonb) FROM PUBLIC;
