-- Trigger: trg_ai_feedback_ready
-- Fires fn_notify_ai_feedback_ready() on ai_feedback inserts

CREATE TRIGGER trg_ai_feedback_ready
  AFTER INSERT ON public.ai_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notify_ai_feedback_ready();