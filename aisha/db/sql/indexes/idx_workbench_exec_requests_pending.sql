-- Index: idx_workbench_exec_requests_pending
-- Hot path: the extension's claim scan reads the oldest pending request first.

CREATE INDEX IF NOT EXISTS idx_workbench_exec_requests_pending
  ON public.workbench_execution_requests (enqueued_at ASC)
  WHERE status = 'pending';
