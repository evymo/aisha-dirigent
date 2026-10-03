-- Function: trigger_timeline_questionnaire_response
-- Purpose: Auto-creates timeline entry when member submits a questionnaire response
-- Access: Trigger-only (AFTER INSERT on questionnaire_responses)
-- Security: SECURITY DEFINER, no sensitive data in metadata

CREATE OR REPLACE FUNCTION public.trigger_timeline_questionnaire_response()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_questionnaire_title TEXT;
  v_questionnaire_code TEXT;
  v_study_title TEXT;
  v_study_id UUID;
  v_content TEXT;
  v_result JSONB;
BEGIN
  -- Only on INSERT (new response)
  IF TG_OP = 'INSERT' THEN

    -- Get questionnaire info (no sensitive data)
    SELECT q.name, q.code
    INTO v_questionnaire_title, v_questionnaire_code
    FROM questionnaires q
    WHERE q.id = NEW.questionnaire_id;

    -- Get study info if linked via registration
    IF NEW.study_registration_id IS NOT NULL THEN
      SELECT s.id, s.title
      INTO v_study_id, v_study_title
      FROM studies s
      JOIN study_registrations se ON se.study_id = s.id
      WHERE se.id = NEW.study_registration_id;
    END IF;

    -- i18n content key
    v_content := 'timeline.questionnaire_completed';

    -- Add timeline entry
    v_result := public.add_system_timeline_entry(
      p_user_id := NEW.user_id,
      p_entry_type := 'system_questionnaire',
      p_content := v_content,
      p_metadata := jsonb_build_object(
        'questionnaire_id', NEW.questionnaire_id,
        'questionnaire_code', COALESCE(v_questionnaire_code, ''),
        'questionnaire_title', COALESCE(v_questionnaire_title, ''),
        'score', NEW.score,
        'study_id', v_study_id,
        'study_title', COALESCE(v_study_title, '')
      ),
      p_occurred_at := COALESCE(NEW.completed_at, NEW.created_at),
      p_source_table := 'questionnaire_responses',
      p_source_id := NEW.id
    );

  END IF;

  RETURN NEW;
END;
$$;

-- Trigger on questionnaire_responses
DROP TRIGGER IF EXISTS trg_timeline_questionnaire_response ON questionnaire_responses;
CREATE TRIGGER trg_timeline_questionnaire_response
  AFTER INSERT ON questionnaire_responses
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_timeline_questionnaire_response();

COMMENT ON FUNCTION public.trigger_timeline_questionnaire_response() IS
  'Auto-creates StoryLoop timeline entry when member submits a questionnaire. No sensitive data in metadata.';

-- Permissions: Trigger function - prevent direct invocation
REVOKE ALL ON FUNCTION public.trigger_timeline_questionnaire_response() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_timeline_questionnaire_response() TO authenticated;
