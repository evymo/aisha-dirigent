-- Function: build_guidance_contract
-- Maps expertise_level enum to a rich guidance contract JSONB.
-- Used by moderate_development_flow and other moderation functions.
-- beginner = Educating (senior decision-support),
-- intermediate = Collaborative, advanced = Autonomous, expert = Supervisory.

CREATE OR REPLACE FUNCTION public.build_guidance_contract(p_expertise_level text DEFAULT 'intermediate'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
BEGIN
  RETURN CASE p_expertise_level

    -- "Educating" — senior decision-support for users who cannot maintain
    -- full project context on their own. Dirigent holds the systemic view,
    -- frames decisions, explains trade-offs, surfaces failure modes, and
    -- asks confirming questions before high-impact changes.
    WHEN 'beginner' THEN jsonb_build_object(
      'level', 'beginner',
      'guidance_mode', 'educating',
      'label', 'Educating',
      'decision_support_level', 'full',
      'context_retention_support', true,
      'ask_for_missing_constraints', true,
      'explain_tradeoffs', true,
      'surface_failure_modes', true,
      'confirm_before_high_impact', true,
      'teaching_depth', 'deep',
      'verbosity', 'detailed_with_examples',
      'explain_why', true,
      'show_alternatives', true,
      'code_examples', true,
      'expected_response_sections', jsonb_build_array(
        'decision_frame',
        'context_summary',
        'tradeoffs',
        'failure_modes',
        'recommendation',
        'verification_checkpoint'
      )
    )

    -- "Collaborative" — balanced guidance for users who understand the
    -- project but benefit from structured recommendations and occasional
    -- context reminders.
    WHEN 'intermediate' THEN jsonb_build_object(
      'level', 'intermediate',
      'guidance_mode', 'collaborative',
      'label', 'Collaborative',
      'decision_support_level', 'moderate',
      'context_retention_support', false,
      'ask_for_missing_constraints', true,
      'explain_tradeoffs', true,
      'surface_failure_modes', false,
      'confirm_before_high_impact', true,
      'teaching_depth', 'standard',
      'verbosity', 'standard',
      'explain_why', true,
      'show_alternatives', false,
      'code_examples', true,
      'expected_response_sections', jsonb_build_array(
        'recommendation',
        'tradeoffs',
        'verification_checkpoint'
      )
    )

    -- "Autonomous" — concise pattern-focused guidance for experienced users
    -- who need Dirigent mainly as a second pair of eyes.
    WHEN 'advanced' THEN jsonb_build_object(
      'level', 'advanced',
      'guidance_mode', 'autonomous',
      'label', 'Autonomous',
      'decision_support_level', 'light',
      'context_retention_support', false,
      'ask_for_missing_constraints', false,
      'explain_tradeoffs', false,
      'surface_failure_modes', false,
      'confirm_before_high_impact', false,
      'teaching_depth', 'concise',
      'verbosity', 'concise',
      'explain_why', false,
      'show_alternatives', true,
      'code_examples', false,
      'expected_response_sections', jsonb_build_array(
        'recommendation'
      )
    )

    -- "Supervisory" — minimal output; the user drives, Dirigent intervenes
    -- only for exceptions, compliance violations, and security concerns.
    WHEN 'expert' THEN jsonb_build_object(
      'level', 'expert',
      'guidance_mode', 'supervisory',
      'label', 'Supervisory',
      'decision_support_level', 'minimal',
      'context_retention_support', false,
      'ask_for_missing_constraints', false,
      'explain_tradeoffs', false,
      'surface_failure_modes', false,
      'confirm_before_high_impact', false,
      'teaching_depth', 'minimal',
      'verbosity', 'minimal',
      'explain_why', false,
      'show_alternatives', false,
      'code_examples', false,
      'expected_response_sections', jsonb_build_array(
        'recommendation'
      )
    )

    -- Fallback to collaborative
    ELSE jsonb_build_object(
      'level', p_expertise_level,
      'guidance_mode', 'collaborative',
      'label', 'Collaborative',
      'decision_support_level', 'moderate',
      'context_retention_support', false,
      'ask_for_missing_constraints', true,
      'explain_tradeoffs', true,
      'surface_failure_modes', false,
      'confirm_before_high_impact', true,
      'teaching_depth', 'standard',
      'verbosity', 'standard',
      'explain_why', true,
      'show_alternatives', false,
      'code_examples', true,
      'expected_response_sections', jsonb_build_array(
        'recommendation',
        'tradeoffs',
        'verification_checkpoint'
      )
    )
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.build_guidance_contract(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.build_guidance_contract(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.build_guidance_contract(text) TO service_role;
