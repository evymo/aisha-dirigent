-- resolve_brand_for_hostname — inbound hostname → id značky (branding_profiles.id).
--
-- ⛔ JEDNO ROZLIŠENÍ ZNAČKY PRO VŠECHNY ČTEČKY WEBU. Stejný dotaz byl dřív
-- vepsaný ve čtyřech funkcích (get_branding_for_hostname, get_web_page_by_slug,
-- get_published_web_page_index, get_published_web_partials) a kopie se
-- rozešly: get_branding_for_hostname dostal 2026-06-01 opravu „rozlišuj podle
-- mapování bez ohledu na status", tři čtečky stránek ji nedostaly.
--
-- Změřený důsledek (2026-09-19, instance se čtyřmi značkami): platforma smí mít
-- publikovanou JEN JEDNU značku bez partnera (výchozí resolver
-- get_branding_profile by jinak vybíral podle pořadí publikace), ostatní jsou
-- 'draft' ZÁMĚRNĚ a dosažitelné jen přes branding_hostname_mapping. Čtečky
-- stránek ale filtrovaly `bp.status = 'published'`, takže pro tři ze čtyř
-- hostnamů vrátily NULL → globální stránky. Téma se přitom načetlo správně
-- (get_branding_for_hostname) — výsledkem byl web v barvách jedné značky
-- s obsahem jiné. Žádná chyba, jen tiše špatný web.
--
-- Pravidlo: řádek mapování JE rozhodnutí operátora „na tomhle hostname
-- servíruj tuhle značku". Status profilu určuje jen výchozí značku pro
-- nenamapované hostnamy, ne dosažitelnost namapovaných. Stránky samotné dál
-- hlídá jejich vlastní `web_pages.status = 'published'`.
--
-- ⛔ NEJMENŠÍ OPRÁVNĚNÍ: SECURITY INVOKER a EXECUTE jen pro service_role.
-- Všichni čtyři konzumenti jsou SECURITY DEFINER, takže vnořené volání běží
-- s právy vlastníka a anon/authenticated pomocníka volat NEPOTŘEBUJÍ. Jako
-- DEFINER s grantem pro anon by ho PostgREST vystavil jako další veřejné RPC
-- s definer právy — přesně třída, kterou core odstraňuje. Hlídá to brána
-- web-znacka-podle-mapovani (anon EXECUTE = false a čtečky pro anon fungují).
CREATE OR REPLACE FUNCTION public.resolve_brand_for_hostname(p_hostname text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT m.branding_profile_id
  FROM public.branding_hostname_mapping m
  WHERE p_hostname IS NOT NULL
    AND length(trim(p_hostname)) > 0
    AND lower(m.hostname) = lower(trim(p_hostname))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_brand_for_hostname(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_brand_for_hostname(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_brand_for_hostname(text) TO service_role;
