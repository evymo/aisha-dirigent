-- Trigger: trg_rag_eval_golden_updated_at
-- Table: rag_eval_golden

CREATE TRIGGER trg_rag_eval_golden_updated_at
  BEFORE UPDATE ON public.rag_eval_golden
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_rag_eval_golden_set_updated_at();
