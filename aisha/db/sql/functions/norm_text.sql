-- Normalizace textu dotazu (lowercase + bez diakritiky) pro answer_verified_facts.
-- SoT doplněn 2026-07-29: funkce žila jen v generované baseline a v živé DB —
-- nešla opravit pipeline cestou. Odteď je zdrojem TENHLE soubor.
CREATE OR REPLACE FUNCTION public.norm_text(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select translate(lower(coalesce(t,'')),'áčďéěíňóřšťúůýžäöü','acdeeinorstuuyzaou'); $function$;

-- answer_verified_facts je SECURITY INVOKER — tenhle helper tedy exekuuje přímo
-- volající role a authenticated ho potřebuje; PUBLIC/anon nemá důvod.
revoke all on function public.norm_text(text) from public, anon;
grant execute on function public.norm_text(text) to authenticated, service_role;
