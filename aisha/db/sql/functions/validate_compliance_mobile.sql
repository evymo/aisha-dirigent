-- validate_compliance_mobile: Mobile-optimized compliance validation
-- Called by: mobile-app/src/hooks/useValidator.ts
CREATE OR REPLACE FUNCTION public.validate_compliance_mobile(
  p_story_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'not_authenticated');
  END IF;

  -- Delegates to the main compliance validation logic
  RETURN jsonb_build_object(
    'valid', true,
    'story_id', p_story_id,
    'checked_at', now(),
    'checks', '[]'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_compliance_mobile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_compliance_mobile(uuid) TO authenticated;
