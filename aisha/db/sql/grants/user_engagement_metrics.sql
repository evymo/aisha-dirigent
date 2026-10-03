-- Grants: user_engagement_metrics

-- SEC-F4b (20260610180000): anon keeps SELECT only — the DELETE/INSERT/UPDATE
-- over-grant is removed (the aggregate is broker/admin-written; anon never writes).
-- authenticated retains DML (RLS-scoped via user_engagement_metrics_self_read/_admin_all).
GRANT SELECT ON public.user_engagement_metrics TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.user_engagement_metrics TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.user_engagement_metrics TO service_role;
