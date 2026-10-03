-- Function: li_list_obligations
-- Závazky ze smluv — VŽDY NEEDS_REVIEW, právně významný obsah není autoritativní bez člověka.
--
-- Čtecí protějšek k li_upsert_obligations. Tabulka má RLS ON a hlavička slibuje
-- "RPC-only lockdown", ale read RPC nikdy nevznikl → evidence natekla a nešla přečíst.
-- Triáda 1:1 dle audience_admin_source_onboarding.sql:49-55,97-100.
-- quote + char_start/char_end vracíme vždy: bez verbatim citace a spanu je závazek
-- jen tvrzení (G2 / provenance doktrína).

CREATE OR REPLACE FUNCTION public.li_list_obligations(
  p_doc_slug text DEFAULT NULL, p_candidate_status text DEFAULT NULL,
  p_limit integer DEFAULT 100, p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, obligation_key text, doc_slug text, filename text, rule_key text,
  clause_ref text, clause_title text, quote text,
  char_start integer, char_end integer, page integer,
  obliged_party text, action text, deadline_text text, consequence_text text,
  candidate_status text, engine_version text, verify_ok boolean, ingested_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT o.id, o.obligation_key, o.doc_slug, o.filename, o.rule_key,
         o.clause_ref, o.clause_title, o.quote, o.char_start, o.char_end, o.page,
         o.obliged_party, o.action, o.deadline_text, o.consequence_text,
         o.candidate_status, o.engine_version, o.verify_ok, o.ingested_at
  FROM public.li_obligations o
  WHERE (p_doc_slug IS NULL OR o.doc_slug = p_doc_slug)
    AND (p_candidate_status IS NULL OR o.candidate_status = p_candidate_status)
  ORDER BY o.ingested_at DESC, o.clause_ref
  LIMIT LEAST(GREATEST(COALESCE(p_limit,100),1),500) OFFSET GREATEST(COALESCE(p_offset,0),0);
END;
$function$;

REVOKE ALL ON FUNCTION public.li_list_obligations(text,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.li_list_obligations(text,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.li_list_obligations(text,text,integer,integer) TO authenticator;
GRANT EXECUTE ON FUNCTION public.li_list_obligations(text,text,integer,integer) TO service_role;
