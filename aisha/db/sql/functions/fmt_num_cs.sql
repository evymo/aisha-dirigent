-- České formátování čísel (mezery po tisících) pro answer_verified_facts.
-- SoT doplněn 2026-07-29 — týž důvod jako norm_text: baseline není zdroj.
CREATE OR REPLACE FUNCTION public.fmt_num_cs(n numeric, p_dec integer DEFAULT 0)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case when n is null then '—' else translate(to_char(round(n,p_dec),
    'FM999G999G999G990'|| case when p_dec>0 then 'D'||repeat('0',p_dec) else '' end), ',.', ' ,') end; $function$;

-- Stejná úvaha jako u norm_text: volá se pod právy volajícího (SECURITY INVOKER
-- nadřazené funkce), authenticated grant je nutný; PUBLIC/anon se odebírá.
revoke all on function public.fmt_num_cs(numeric, integer) from public, anon;
grant execute on function public.fmt_num_cs(numeric, integer) to authenticated, service_role;
