-- Function: li_list_findings
-- Deterministické nálezy pravidel (price_mismatch, qty_mismatch…) — alert feed.
--
-- Čtecí protějšek k li_upsert_findings. Tabulka má RLS ON a hlavička slibuje "RPC-only lockdown",
-- ale read RPC nikdy nevznikl (5× upsert, 0× read) → evidence natekla a nešla přečíst.
-- Triáda 1:1 dle audience_admin_source_onboarding.sql:49-55,97-100.

CREATE OR REPLACE FUNCTION public.li_list_findings(
  p_severity text DEFAULT NULL, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, finding_key text, rule_key text, finding text, severity text,
  documents jsonb, evidence jsonb, engine_version text, verify_ok boolean,
  ingested_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT f.id, f.finding_key, f.rule_key, f.finding, f.severity,
         f.documents, f.evidence, f.engine_version, f.verify_ok, f.ingested_at
  FROM public.li_findings f
  WHERE (p_severity IS NULL OR f.severity = p_severity)
  ORDER BY CASE f.severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
           f.ingested_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit,100),1),500) OFFSET GREATEST(COALESCE(p_offset,0),0);
END;
$function$;

REVOKE ALL ON FUNCTION public.li_list_findings(text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.li_list_findings(text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.li_list_findings(text,integer,integer) TO authenticator;
GRANT EXECUTE ON FUNCTION public.li_list_findings(text,integer,integer) TO service_role;
