-- Function: audience_admin_gdpr_erasure_log
-- Governed SECURITY DEFINER replacement for the leaky view
-- public.audience_admin_gdpr_erasure_log_v (#572, N2 fix).
--
-- The #572 view ran with owner (aisha_admin) rights and was reachable by a
-- direct GRANT SELECT TO authenticated/anon, which bypassed RLS on
-- account_deletion_requests / profiles / aisha_auth.users / audit_journal and
-- leaked subject + operator PII (subject_email, operator_email) to any caller.
-- This RPC serves the SAME tabular projection (no column downgrade) but gates
-- every read behind public.is_admin_or_staff() and is REVOKE-d from PUBLIC/anon
-- (also enforced by the audience_autorevoke_public_execute event trigger and
-- the audience_audit_grants invariant gate).
--
-- Local GDPR erasure audit: one row per UUID erasure request, tying the
-- account_deletion_requests lifecycle to its downstream source-api propagation
-- + audit trail recorded in audit_journal (area='gdpr'). The audit_journal GDPR-area
-- propagation log may still be empty; account_deletion_requests is the spine
-- and audit_journal is LEFT-correlated, so propagation columns
-- (propagation_entries / last_propagation_at / last_propagation_severity /
-- propagation_status) populate as that log fills in — no signature change.

CREATE OR REPLACE FUNCTION public.audience_admin_gdpr_erasure_log(p_limit integer DEFAULT 200, p_offset integer DEFAULT 0)
 RETURNS TABLE(
   erasure_id uuid,
   subject_user_id uuid,
   subject_name text,
   subject_email text,
   reason text,
   request_status account_deletion_status,
   requested_at timestamp with time zone,
   scheduled_deletion_at timestamp with time zone,
   cancelled_at timestamp with time zone,
   completed_at timestamp with time zone,
   operator_user_id uuid,
   operator_email text,
   operator_name text,
   erasure_phase text,
   propagation_entries bigint,
   last_propagation_at timestamp with time zone,
   last_propagation_severity text,
   propagation_status text,
   created_at timestamp with time zone,
   updated_at timestamp with time zone
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    adr.id                              AS erasure_id,
    adr.user_id                         AS subject_user_id,
    subj.display_name                   AS subject_name,
    subj.email                          AS subject_email,
    adr.reason                          AS reason,
    adr.status                          AS request_status,
    adr.requested_at                    AS requested_at,
    adr.scheduled_deletion_at           AS scheduled_deletion_at,
    adr.cancelled_at                    AS cancelled_at,
    adr.completed_at                    AS completed_at,
    adr.processed_by                    AS operator_user_id,
    COALESCE(op.email::text, opp.email) AS operator_email,
    opp.display_name                    AS operator_name,
    CASE
      WHEN adr.cancelled_at IS NOT NULL THEN 'cancelled'::text
      WHEN adr.completed_at IS NOT NULL THEN 'erased'::text
      WHEN adr.scheduled_deletion_at <= now() THEN 'due'::text
      ELSE 'scheduled'::text
    END                                 AS erasure_phase,
    aud.propagation_entries             AS propagation_entries,
    aud.last_propagation_at             AS last_propagation_at,
    aud.last_propagation_severity       AS last_propagation_severity,
    CASE
      WHEN adr.cancelled_at IS NOT NULL THEN 'n/a'::text
      WHEN aud.propagation_entries > 0 THEN 'propagated'::text
      WHEN adr.completed_at IS NOT NULL THEN 'erased_unlogged'::text
      ELSE 'pending'::text
    END                                 AS propagation_status,
    adr.created_at                      AS created_at,
    adr.updated_at                      AS updated_at
  FROM public.account_deletion_requests adr
    LEFT JOIN public.profiles subj ON subj.user_id = adr.user_id
    LEFT JOIN aisha_auth.users op ON op.id = adr.processed_by
    LEFT JOIN public.profiles opp ON opp.user_id = adr.processed_by
    LEFT JOIN LATERAL (
      SELECT
        count(*)                                                    AS propagation_entries,
        max(aj.created_at)                                          AS last_propagation_at,
        (array_agg(aj.severity ORDER BY aj.created_at DESC))[1]     AS last_propagation_severity
      FROM public.audit_journal aj
      WHERE (aj.area = 'gdpr'::text OR aj.action ILIKE '%eras%' OR aj.action ILIKE '%gdpr%')
        AND (aj.user_id = adr.user_id OR aj.entity_id = adr.user_id::text OR aj.entity_id = adr.id::text)
    ) aud ON true
  ORDER BY adr.requested_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$function$

;

REVOKE ALL ON FUNCTION audience_admin_gdpr_erasure_log(integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_admin_gdpr_erasure_log(integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION audience_admin_gdpr_erasure_log(integer,integer) TO authenticator;
GRANT EXECUTE ON FUNCTION audience_admin_gdpr_erasure_log(integer,integer) TO service_role;

COMMENT ON FUNCTION audience_admin_gdpr_erasure_log(integer,integer) IS
  'Admin-gated (is_admin_or_staff) SECURITY DEFINER replacement for the leaky
   view audience_admin_gdpr_erasure_log_v (#572 N2 fix). Returns the local GDPR
   erasure log — one row per account_deletion_requests (UUID erasure) with
   subject + operator identity, lifecycle phase, and a correlated summary of
   audit_journal GDPR-area propagation entries. Carries subject_email /
   operator_email PII by design (operator GDPR dashboard) but only ever behind
   the admin gate; REVOKE-d from PUBLIC/anon. Read by operators in the
   "GDPR & operatori" extranet area via PostgREST RPC. p_limit/p_offset page the
   requested_at-DESC ordering.';
