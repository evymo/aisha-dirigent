-- =============================================================================
-- Function: ensure_feedback_training_dataset
-- Purpose: Ensure an org-scoped ALE feedback training dataset exists
-- Part of: AISHA Learning Engine (ALE) — event-driven feedback pipeline
-- =============================================================================

CREATE OR REPLACE FUNCTION public.ensure_feedback_training_dataset(
  p_domain_tags text[] DEFAULT '{}'::text[],
  p_org_id uuid DEFAULT NULL,
  p_story_id uuid DEFAULT NULL,
  p_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_created boolean := false;
  v_dataset_id uuid;
  v_dataset_name text;
  v_is_service_role boolean := false;
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  v_is_service_role := COALESCE(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role',
    false
  );

  IF NOT v_is_service_role AND (v_user_id IS NULL OR NOT public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'Permission denied: admin or staff required';
  END IF;

  SELECT td.id, td.name
  INTO v_dataset_id, v_dataset_name
  FROM public.training_datasets td
  WHERE td.source_type = 'feedback'
    AND td.metadata ->> 'pipeline' = 'ale_feedback'
    AND (
      (p_org_id IS NULL AND td.org_id IS NULL)
      OR td.org_id = p_org_id
    )
  ORDER BY td.created_at DESC
  LIMIT 1;

  IF v_dataset_id IS NULL THEN
    v_created := true;
    v_dataset_name := COALESCE(
      p_name,
      CASE
        WHEN p_org_id IS NULL THEN 'ALE Feedback Dataset (Global)'
        ELSE 'ALE Feedback Dataset (' || left(p_org_id::text, 8) || ')'
      END
    );

    INSERT INTO public.training_datasets (
      org_id,
      name,
      description,
      source_type,
      format,
      domain_tags,
      status,
      metadata,
      created_by
    ) VALUES (
      p_org_id,
      v_dataset_name,
      'Auto-managed dataset for AISHA feedback loop. Mixed SFT + DPO examples.',
      'feedback',
      'instruction',
      COALESCE(p_domain_tags, '{}'::text[]),
      'curating',
      jsonb_build_object(
        'pipeline', 'ale_feedback',
        'mixed_formats', jsonb_build_array('instruction', 'preference_pair'),
        'last_story_id', p_story_id,
        'auto_managed', true
      ),
      v_user_id
    )
    RETURNING id, name INTO v_dataset_id, v_dataset_name;
  ELSE
    UPDATE public.training_datasets td
    SET
      domain_tags = (
        SELECT COALESCE(array_agg(DISTINCT x), '{}'::text[])
        FROM unnest(COALESCE(td.domain_tags, '{}'::text[]) || COALESCE(p_domain_tags, '{}'::text[])) AS x
      ),
      metadata = td.metadata || jsonb_build_object('last_story_id', p_story_id, 'auto_managed', true)
    WHERE td.id = v_dataset_id;
  END IF;

  RETURN jsonb_build_object(
    'dataset_id', v_dataset_id,
    'name', v_dataset_name,
    'created', v_created,
    'org_id', p_org_id,
    'story_id', p_story_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_feedback_training_dataset(text[], uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_feedback_training_dataset(text[], uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_feedback_training_dataset(text[], uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public.ensure_feedback_training_dataset(text[], uuid, uuid, text) IS
  'Ensure an ALE feedback dataset exists per org. Used by n8n feedback processor before process_feedback_to_training.';