-- get_dirigent_questionnaires_mobile: Mobile-optimized questionnaire listing
-- Called by: mobile-app/src/hooks/useQuestionnaires.ts
CREATE OR REPLACE FUNCTION public.get_dirigent_questionnaires_mobile(
  p_story_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Questionnaires are GLOBAL templates keyed by `code`; they carry no title/
  -- story_id/status/created_by column (the previous body selected four columns that
  -- do not exist, so every call raised 42703). Per-user state lives in
  -- questionnaire_responses — same shape the sibling get_study_questionnaires_mobile
  -- returns. p_story_id is kept in the signature for call-site compatibility but is
  -- not a real dimension of questionnaires, so it is accepted and ignored.
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', q.id,
      'code', q.code,
      'title', q.name,
      'status', CASE WHEN r.last_completed_at IS NOT NULL THEN 'completed' ELSE 'pending' END,
      'completed_at', r.last_completed_at
    ) ORDER BY q.created_at DESC
  ), '[]'::jsonb)
  INTO v_result
  FROM questionnaires q
  LEFT JOIN (
    SELECT qr.questionnaire_id, MAX(qr.completed_at) AS last_completed_at
    FROM questionnaire_responses qr
    WHERE qr.user_id = v_user_id
    GROUP BY qr.questionnaire_id
  ) r ON r.questionnaire_id = q.id
  WHERE q.is_active = true;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_dirigent_questionnaires_mobile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dirigent_questionnaires_mobile(uuid) TO authenticated;
