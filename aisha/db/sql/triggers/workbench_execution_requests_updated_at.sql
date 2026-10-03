-- Trigger: workbench_execution_requests_updated_at
-- Table: workbench_execution_requests — stamp updated_at on every status transition.

DROP TRIGGER IF EXISTS workbench_execution_requests_updated_at ON public.workbench_execution_requests;
CREATE TRIGGER workbench_execution_requests_updated_at
  BEFORE UPDATE ON public.workbench_execution_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
