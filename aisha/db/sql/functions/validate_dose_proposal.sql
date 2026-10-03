-- File: aisha/db/sql/functions/validate_dose_proposal.sql
-- -----------------------------------------------------------------------------

-- CONCEPT (why "dose" is misleading — read docs/architecture/RECURRING_INTERACTION_CADENCE.md):
--   "Dose" is not really about medication. The platform models a RECURRING,
--   PLANNED INTERACTION with two axes — FREQUENCY (how often it recurs:
--   doses_per_day / timing) and INTENSITY (how much per beat: dose_amount). The
--   load-bearing abstraction is the FREQUENCY OF INTERACTIONS; medical dosing is
--   one instance (a daily check-in / reminder / practice beat is the same model,
--   with intensity collapsing to yes/no). This RPC validates the INTENSITY axis of
--   one beat; the FREQUENCY axis lives in the prescribed plan / member realization.
--   Vocabulary map (technical → concept):
--     product_dose_units          → RECOMMENDED ENVELOPE   (soft bounds, advisory)
--     study_distribution_protocols→ PRESCRIBED PLAN        (the study's cadence)
--     member_distribution_plans   → MEMBER REALIZATION     (chosen cadence + notes)
--     distribution_adjustments    → TRUST-SCOPED RE-TUNING (consultant, consent, audit)
--     dosing_logs                 → REALIZED BEATS         (free-form, real-world)
--   This RPC is the ADVISORY CHECK AT THE MOMENT OF PROPOSING a beat. It never
--   blocks; its tiers gate WHO MAY READ a member's cadence, not whether a beat may
--   be logged — consistent with the distribution_adjustments access boundary.
-- -----------------------------------------------------------------------------

-- Function: public.validate_dose_proposal
-- Arguments: p_product_id uuid, p_dose_amount numeric, p_dose_unit text,
--            p_member_distribution_plan_id uuid DEFAULT NULL
-- Description: Advisory validation for a proposed dose. Two tiers, one function:
--
--   (1) PRODUCT TIER — pass just (product, amount, unit). Anonymous-friendly
--       pre-write check (mobile dose slider, web plan editor): evaluates the
--       amount against the per-product/unit bounds in product_dose_units. No
--       member/PHI data is touched, so it stays GRANTable to anon — exactly the
--       posture of its companion get_product_dose_options.
--
--   (2) MEMBER/STUDY TIER — also pass p_member_distribution_plan_id. This is the
--       consultant-facing path (validate a *proposed adjustment* against a real
--       member's plan). Reading a member's plan is PHI access, so this tier is
--       held to the SAME access contract as create_distribution_adjustment /
--       get_distribution_adjustments_audited:
--         • authenticated (auth.uid() must resolve),
--         • caller is admin/staff OR has the 'consultant' role,
--         • data-sharing consent on the member (admin/staff bypass — platform
--           operators),
--         • the access is written to the audit journal (PHI view).
--       It then adds context warnings: deviation from the study-prescribed
--       protocol dose, and from the member's current plan dose.
--
-- Advisory ALWAYS: `valid` is always true and the dose is NEVER blocked — the
-- platform's data-collection contract requires accepting out-of-range entries.
-- The member tier gates *who may read the member context*, not whether the dose
-- may be logged. No hardcoded thresholds — all product bounds come from
-- product_dose_units rows.
--
-- Companion: get_product_dose_options(uuid) returns the product bounds; this RPC
-- evaluates a specific proposed dose against them (+ optional member/study context).
--
-- Return shape (jsonb):
--   {
--     "valid": true,
--     "warnings": [ {level: low|high|info, field, context, message, …}, … ],
--     "recommended": { default_amount, min_amount, max_amount, step_amount } | null,
--     "product_unit_match": bool,
--     "context": { has_member_context: bool, has_study_context: bool }
--   }

-- Drop the 3-arg product-only signature so the 4-arg member-aware version is the
-- only overload (a 3-arg call resolves to it via the DEFAULT). No-op on a fresh
-- baseline apply (the 3-arg never shipped). Idempotent.
DROP FUNCTION IF EXISTS public.validate_dose_proposal(uuid, numeric, text);

CREATE OR REPLACE FUNCTION public.validate_dose_proposal(
  p_product_id uuid,
  p_dose_amount numeric,
  p_dose_unit text,
  p_member_distribution_plan_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_limits product_dose_units%ROWTYPE;
  v_warnings jsonb := '[]'::jsonb;
  v_recommended jsonb;
  v_match boolean := false;
  -- Member/study tier
  v_caller uuid;
  v_member uuid;
  v_protocol_id uuid;
  v_plan_dose numeric;
  v_custom_dose numeric;
  v_protocol_dose numeric;
  v_current_dose numeric;
  v_has_member boolean := (p_member_distribution_plan_id IS NOT NULL);
  v_has_study boolean := false;
BEGIN
  -- ── MEMBER/STUDY TIER: access control (mirrors create_distribution_adjustment) ─
  -- Reading a member's plan is PHI access, so the member tier requires auth +
  -- consultant/admin role + data-sharing consent, and is audited. The dose itself
  -- is still advisory; this guard governs READING the member context, not logging.
  IF v_has_member THEN
    v_caller := auth.uid();
    IF v_caller IS NULL THEN
      RAISE EXCEPTION 'Authentication required to validate against a member plan'
        USING ERRCODE = '42501';
    END IF;

    IF NOT (public.is_admin_or_staff(v_caller) OR public.has_role(v_caller, 'consultant')) THEN
      RAISE EXCEPTION 'Only consultants or admin/staff may validate a member plan dose'
        USING ERRCODE = '42501';
    END IF;

    SELECT mdp.user_id, mdp.protocol_id, mdp.dose_amount, mdp.custom_dose_amount
      INTO v_member, v_protocol_id, v_plan_dose, v_custom_dose
    FROM member_distribution_plans mdp
    WHERE mdp.id = p_member_distribution_plan_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Member distribution plan not found: %', p_member_distribution_plan_id
        USING ERRCODE = 'P0002';
    END IF;

    -- Consultant must hold data-sharing consent on the member; admin/staff bypass.
    IF NOT public.is_admin_or_staff(v_caller)
       AND NOT public.has_data_sharing_consent(v_member, v_caller) THEN
      RAISE EXCEPTION 'Data-sharing consent required to validate this member''s dose'
        USING ERRCODE = '42501';
    END IF;

    -- Audit the PHI access (member plan read), matching the dosing audit pattern.
    PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area        := 'studies',
      p_details     := jsonb_build_object(
        'member_distribution_plan_id', p_member_distribution_plan_id,
        'proposed_dose_amount', p_dose_amount,
        'proposed_dose_unit', p_dose_unit
      ),
      p_entity_id   := p_member_distribution_plan_id::text,
      p_entity_type := 'dose_validation',
      p_severity    := 'info',
      p_summary     := 'Validated a proposed dose against a member distribution plan',
      p_tags        := ARRAY['phi', 'member', 'dose_validation'],
      p_user_id     := v_caller
    );
  END IF;

  -- ── PRODUCT TIER: bounds from product_dose_units (always evaluated) ───────────
  SELECT * INTO v_limits
  FROM product_dose_units
  WHERE product_id = p_product_id
    AND dose_unit_code = p_dose_unit
  LIMIT 1;

  IF FOUND THEN
    v_match := true;
    v_recommended := jsonb_build_object(
      'default_amount', v_limits.default_amount,
      'min_amount',     v_limits.min_amount,
      'max_amount',     v_limits.max_amount,
      'step_amount',    v_limits.step_amount
    );

    IF v_limits.min_amount IS NOT NULL AND p_dose_amount < v_limits.min_amount THEN
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
        'level', 'low', 'field', 'dose_amount', 'context', 'product_minimum',
        'message', 'Dose is below the recommended minimum for this product/unit.',
        'recommended_min', v_limits.min_amount, 'proposed', p_dose_amount));
    END IF;

    IF v_limits.max_amount IS NOT NULL AND p_dose_amount > v_limits.max_amount THEN
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
        'level', 'high', 'field', 'dose_amount', 'context', 'product_maximum',
        'message', 'Dose is above the recommended maximum for this product/unit.',
        'recommended_max', v_limits.max_amount, 'proposed', p_dose_amount));
    END IF;

    IF v_limits.step_amount IS NOT NULL AND v_limits.step_amount > 0 THEN
      IF (p_dose_amount - COALESCE(v_limits.min_amount, 0)) % v_limits.step_amount <> 0 THEN
        v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
          'level', 'info', 'field', 'dose_amount', 'context', 'product_step_granularity',
          'message', 'Dose is not aligned to the recommended step granularity.',
          'recommended_step', v_limits.step_amount, 'proposed', p_dose_amount));
      END IF;
    END IF;
  ELSE
    v_recommended := NULL;
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'level', 'info', 'field', 'dose_unit', 'context', 'unknown_product_unit',
      'message', 'No recommended bounds configured for this product/unit combination.',
      'product_id', p_product_id, 'dose_unit', p_dose_unit));
  END IF;

  -- ── STUDY TIER: deviation from the study-prescribed protocol dose ─────────────
  IF v_has_member AND v_protocol_id IS NOT NULL THEN
    SELECT sdp.dose_amount INTO v_protocol_dose
    FROM study_distribution_protocols sdp
    WHERE sdp.id = v_protocol_id;
    IF FOUND AND v_protocol_dose IS NOT NULL THEN
      v_has_study := true;
      IF p_dose_amount <> v_protocol_dose THEN
        v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
          'level', 'info', 'field', 'dose_amount', 'context', 'study_protocol_deviation',
          'message', 'Proposed dose differs from the study-prescribed protocol dose.',
          'protocol_prescribed', v_protocol_dose, 'proposed', p_dose_amount,
          'delta', p_dose_amount - v_protocol_dose));
      END IF;
    END IF;
  END IF;

  -- ── MEMBER TIER: deviation from the member's current effective plan dose ──────
  IF v_has_member THEN
    v_current_dose := COALESCE(v_custom_dose, v_plan_dose, v_protocol_dose);
    IF v_current_dose IS NOT NULL AND p_dose_amount <> v_current_dose THEN
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
        'level', 'info', 'field', 'dose_amount', 'context', 'member_plan_deviation',
        'message', 'Proposed dose differs from the member''s current plan dose.',
        'current_plan', v_current_dose, 'proposed', p_dose_amount,
        'delta', p_dose_amount - v_current_dose));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'valid',              true,
    'warnings',           v_warnings,
    'recommended',        v_recommended,
    'product_unit_match', v_match,
    'context', jsonb_build_object(
      'has_member_context', v_has_member,
      'has_study_context',  v_has_study
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_dose_proposal(uuid, numeric, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_dose_proposal(uuid, numeric, text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.validate_dose_proposal(uuid, numeric, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.validate_dose_proposal(uuid, numeric, text, uuid) IS
'Advisory dose validation. Product tier (product,amount,unit) is anon-friendly and never blocks. The optional p_member_distribution_plan_id adds the consultant tier: PHI access held to the dosing access contract (auth + consultant/admin role + data-sharing consent, audited) and warnings for deviation from the study protocol + the member''s current plan. valid is always true; the guard governs reading member context, not logging the dose.';
