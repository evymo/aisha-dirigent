-- Function: public.audience_admin_approve_source
-- Description: Operator approval for a federated source, over the story spine.
--   Replaces the #572 bare is_active toggle with a real source-onboarding
--   activation: it REFUSES to approve a source whose 4-dimension classification
--   (source_type / data_sensitivity / retention_class / legal_basis) + namespace
--   is incomplete (contract §1), then transitions the ONE lifecycle on the story
--   instance (metadata.source_approved + status) and audits into the integrations
--   sink with the contract action (§7 krok5), not the crm_ops area #572 mis-filed.
--   The approved flag is exactly what audience_resolve_source_binding gates the
--   live read on — closing the approve↔read decoupling #572 shipped.
--
-- Security: SECURITY DEFINER, search_path pinned. OPERATOR (admin/staff) ONLY — a
--   trusted service must NOT self-approve (contract §7: restricted/confidential
--   require a human/Dirigent gate). `audience_` prefix inherits the module gates.

CREATE OR REPLACE FUNCTION public.audience_admin_approve_source(
  p_instance_id      uuid,
  p_data_sensitivity text DEFAULT NULL
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_instance    public.story_instances%ROWTYPE;
  v_meta        jsonb;
  v_sensitivity text;
  v_missing     text[] := '{}';
BEGIN
  -- Operator-only. is_admin_or_staff() is the human gate; a bare service_role JWT
  -- does not satisfy it, so a service cannot self-approve.
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied — source approval requires admin/staff' USING ERRCODE = '42501';
  END IF;

  SELECT si.* INTO v_instance
  FROM public.story_instances si
  WHERE si.id = p_instance_id
  FOR UPDATE;

  IF v_instance.id IS NULL THEN
    RAISE EXCEPTION 'Unknown source instance %', p_instance_id USING ERRCODE = 'no_data_found';
  END IF;

  v_meta        := COALESCE(v_instance.metadata, '{}'::jsonb);
  v_sensitivity := COALESCE(p_data_sensitivity, v_meta ->> 'data_sensitivity');

  -- Contract-completeness gate (§1): classify BEFORE activation. Fail LOUD.
  -- array_append (not `|| 'literal'`): an untyped literal RHS makes `||` bind to
  -- the anyarray||anyarray overload, which parses the string AS an array literal
  -- (22P02 malformed array literal). array_append forces element concatenation.
  IF v_meta ->> 'source_type'     IS NULL THEN v_missing := array_append(v_missing, 'source_type');     END IF;
  IF v_sensitivity                IS NULL THEN v_missing := array_append(v_missing, 'data_sensitivity'); END IF;
  IF v_meta ->> 'retention_class' IS NULL THEN v_missing := array_append(v_missing, 'retention_class'); END IF;
  IF v_meta ->> 'legal_basis'     IS NULL THEN v_missing := array_append(v_missing, 'legal_basis');     END IF;
  IF v_meta ->> 'namespace'       IS NULL THEN v_missing := array_append(v_missing, 'namespace');       END IF;
  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Source classification incomplete — missing: %', array_to_string(v_missing, ', ')
      USING ERRCODE = 'check_violation';
  END IF;

  -- Contract §1: each classification dimension must carry a VALUE from its closed
  -- legal set (D2 remediation) — presence is not enough. A source whose metadata
  -- says data_sensitivity:'banana' is unclassified-with-a-typo, not governed. The
  -- onboarding gate is the ONE place this is checked, so it enforces set-membership
  -- (not just NOT NULL) over each of the four dimensions. Fail LOUD (check_violation).
  IF (v_meta ->> 'source_type') NOT IN ('internal', 'partner', 'external', 'user_provided') THEN
    RAISE EXCEPTION 'Invalid source_type "%": allowed = internal|partner|external|user_provided', v_meta ->> 'source_type'
      USING ERRCODE = 'check_violation';
  END IF;
  IF COALESCE(p_data_sensitivity, v_meta ->> 'data_sensitivity') NOT IN ('public', 'internal', 'restricted', 'confidential') THEN
    RAISE EXCEPTION 'Invalid data_sensitivity "%": allowed = public|internal|restricted|confidential', v_sensitivity
      USING ERRCODE = 'check_violation';
  END IF;
  IF (v_meta ->> 'retention_class') NOT IN ('ephemeral', 'short_term', 'long_term', 'permanent') THEN
    RAISE EXCEPTION 'Invalid retention_class "%": allowed = ephemeral|short_term|long_term|permanent', v_meta ->> 'retention_class'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (v_meta ->> 'legal_basis') NOT IN ('consent', 'contract', 'legitimate_interest', 'legal_obligation') THEN
    RAISE EXCEPTION 'Invalid legal_basis "%": allowed = consent|contract|legitimate_interest|legal_obligation', v_meta ->> 'legal_basis'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.story_instances
     SET metadata = v_meta || jsonb_build_object(
           'source_approved', true,
           'data_sensitivity', v_sensitivity,
           'approved_at', now(),
           'approved_by', auth.uid()
         ),
         status     = 'active',
         updated_at = now()
   WHERE id = p_instance_id;

  INSERT INTO public.audit_journal
    (user_id, action_type, action, entity_type, entity_id, area, severity, summary, details)
  VALUES
    (auth.uid(), 'approval', 'SOURCE_ACTIVATED', 'story_instance', p_instance_id,
     'integrations', 'info',
     format('Source instance %s approved + activated', v_instance.instance_label),
     jsonb_build_object('story_id', v_instance.story_id, 'data_sensitivity', v_sensitivity));

  RETURN jsonb_build_object(
    'instance_id', p_instance_id,
    'approved', true,
    'data_sensitivity', v_sensitivity
  );
END;
$$;

REVOKE ALL ON FUNCTION public.audience_admin_approve_source(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audience_admin_approve_source(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.audience_admin_approve_source(uuid, text) IS
  'Operator (admin/staff-only) source activation over the story spine: refuses to '
  'approve an incompletely-classified source (§1), transitions story_instances '
  'lifecycle (metadata.source_approved + status), audits SOURCE_ACTIVATED into the '
  'integrations area. The approved flag gates audience_resolve_source_binding.';
