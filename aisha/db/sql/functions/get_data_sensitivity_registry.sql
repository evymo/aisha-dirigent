-- Function: public.get_data_sensitivity_registry
-- §11: the DB-driven residency anchor list. svc-ai-chat reads this into a TTL
-- cache (governedOrchestration.ts) — NEVER on the hot path — and matches request
-- content / RAG provenance against the 'confidential' rows to force on-prem
-- residency. STABLE + a single tiny table scan = fast.
--
-- SECURITY INVOKER (the default — deliberately NOT definer): a config reader needs
-- NO elevated privilege, so it must not bypass RLS. Access is governed entirely by
-- the data_sensitivity_registry RLS policies (admin + service_role read). Least
-- privilege: the function is never more powerful than its caller, and there is no
-- SECURITY DEFINER surface to audit.
CREATE OR REPLACE FUNCTION public.get_data_sensitivity_registry()
 RETURNS TABLE(table_name text, sensitivity text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT r.table_name, r.sensitivity::text
  FROM public.data_sensitivity_registry r;
$function$;

REVOKE ALL ON FUNCTION public.get_data_sensitivity_registry() FROM PUBLIC;
-- Only the svc (service_role) calls this; admin/UI reads go direct to the table
-- under the same RLS. No anon/authenticated EXECUTE — minimal call surface.
GRANT EXECUTE ON FUNCTION public.get_data_sensitivity_registry() TO service_role;
