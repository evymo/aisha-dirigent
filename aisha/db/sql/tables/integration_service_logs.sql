-- ============================================================================
-- Source of Truth: integration_service_logs
-- Popis: Log operací prováděných na integračních službách (audit trail).
--        Sleduje co Aisha dělá v NocoDB, Langfuse, atd.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.integration_service_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id      uuid NOT NULL REFERENCES public.integration_services(id) ON DELETE CASCADE,
  action          text NOT NULL,               -- 'create_table', 'update_view', 'health_check', 'sync_schema', ...
  action_detail   jsonb NOT NULL DEFAULT '{}'::jsonb,  -- request/response metadata
  performed_by    uuid REFERENCES aisha_auth.users(id) ON DELETE SET NULL,  -- NULL = system/Aisha
  status          text NOT NULL DEFAULT 'success'
                  CHECK (status IN ('success', 'failure', 'partial')),
  error_message   text,
  duration_ms     integer,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Komentáře
COMMENT ON TABLE public.integration_service_logs IS 'Audit log operací na integračních službách';
COMMENT ON COLUMN public.integration_service_logs.performed_by IS 'UUID uživatele nebo NULL pro systémové/Aisha operace';
COMMENT ON COLUMN public.integration_service_logs.action_detail IS 'JSONB detail operace (nikdy sensitive data!)';

ALTER TABLE public.integration_service_logs ENABLE ROW LEVEL SECURITY;
