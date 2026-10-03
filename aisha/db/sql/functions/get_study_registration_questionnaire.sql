-- Function: get_study_registration_questionnaire
-- Description: Returns the registration/registration questionnaire for a given study.
--   Uses unified translation keys with locale fallback chain.
-- Supports questionnaire_type: 'registration', 'registration', 'intake'
-- Priority: registration > registration > intake

CREATE OR REPLACE FUNCTION get_study_registration_questionnaire(
  p_locale TEXT DEFAULT 'en',
  p_study_id UUID DEFAULT NULL
)
RETURNS TABLE (
  is_required BOOLEAN,
  questionnaire_code TEXT,
  questionnaire_description TEXT,
  questionnaire_id UUID,
  questionnaire_title TEXT,
  token_reward INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
DECLARE
  v_type TEXT;
BEGIN
  -- Find the best matching type (priority: registration > registration > intake)
  SELECT sq.questionnaire_type INTO v_type
  FROM study_questionnaires sq
  JOIN questionnaires q ON q.id = sq.questionnaire_id
  WHERE sq.study_id = p_study_id
    AND sq.questionnaire_type IN ('registration', 'registration', 'intake')
    AND sq.is_active = true
    AND q.is_active = true
  ORDER BY
    CASE sq.questionnaire_type
      WHEN 'registration' THEN 1
      WHEN 'registration' THEN 2
      WHEN 'intake' THEN 3
    END
  LIMIT 1;

  IF v_type IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    sq.is_required,
    q.code as questionnaire_code,
    COALESCE(
      (SELECT t.value FROM translations t WHERE t.key = sq.description_key AND t.locale = p_locale AND t.namespace = 'questionnaires' LIMIT 1),
      (SELECT t.value FROM translations t WHERE t.key = sq.description_key AND t.locale = 'en' AND t.namespace = 'questionnaires' LIMIT 1),
      (SELECT t.value FROM translations t WHERE t.key = q.description_key AND t.locale = p_locale AND t.namespace = 'questionnaires' LIMIT 1),
      (SELECT t.value FROM translations t WHERE t.key = q.description_key AND t.locale = 'en' AND t.namespace = 'questionnaires' LIMIT 1),
      ''
    ) as questionnaire_description,
    sq.questionnaire_id,
    COALESCE(
      (SELECT t.value FROM translations t WHERE t.key = sq.title_key AND t.locale = p_locale AND t.namespace = 'questionnaires' LIMIT 1),
      (SELECT t.value FROM translations t WHERE t.key = sq.title_key AND t.locale = 'en' AND t.namespace = 'questionnaires' LIMIT 1),
      (SELECT t.value FROM translations t WHERE t.key = q.name_key AND t.locale = p_locale AND t.namespace = 'questionnaires' LIMIT 1),
      (SELECT t.value FROM translations t WHERE t.key = q.name_key AND t.locale = 'en' AND t.namespace = 'questionnaires' LIMIT 1),
      q.name
    ) as questionnaire_title,
    sq.token_reward
  FROM study_questionnaires sq
  JOIN questionnaires q ON q.id = sq.questionnaire_id
  WHERE sq.study_id = p_study_id
    AND sq.questionnaire_type = v_type
    AND sq.is_active = true
    AND q.is_active = true
  ORDER BY sq.display_order
  LIMIT 1;
END;
$$;

-- Veřejná funkce - anon může načíst info o dotazníku pro registraci
REVOKE ALL ON FUNCTION get_study_registration_questionnaire(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_study_registration_questionnaire(text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION get_study_registration_questionnaire(text, uuid) TO authenticated;

COMMENT ON FUNCTION get_study_registration_questionnaire(text, uuid) IS
'Returns the registration/registration questionnaire for a given study.
Used during study registration to dynamically load the correct questionnaire.';
