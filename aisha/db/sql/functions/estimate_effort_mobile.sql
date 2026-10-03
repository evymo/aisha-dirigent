-- estimate_effort_mobile: Mobile-optimized effort estimation
-- Called by: mobile-app/src/hooks/useValidator.ts
CREATE OR REPLACE FUNCTION public.estimate_effort_mobile(
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
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  RETURN jsonb_build_object(
    'story_id', p_story_id,
    'estimated_at', now(),
    'effort', jsonb_build_object(
      'complexity', 'medium',
      'hours_min', 0,
      'hours_max', 0
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.estimate_effort_mobile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.estimate_effort_mobile(uuid) TO authenticated;
