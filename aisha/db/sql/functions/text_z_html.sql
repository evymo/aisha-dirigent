-- Source of truth for text_z_html
-- Čitelný text z HTML — pro HLEDÁNÍ, ne pro zobrazení.
--
-- ⛔ PROČ VŮBEC: těla novinek jsou HTML, ne prostý text (naměřeno 2026-09-21 na
-- instanci: všech 226 uložených těl obsahuje `<p`, 119 `<h3`, 175 odkazů,
-- 120 `<img>`). Hledání přes `value ILIKE '%…%'` proto:
--   • našlo KAŽDÝ článek na dotaz „img", „href", „strong" — shoda se značkou,
--     ne s obsahem;
--   • NENAŠLO souvislou frázi, kterou značka rozděluje: „Dzogchen je" se
--     v těle vyskytuje jako `<strong>Dzogchen</strong> je`.
-- Text bez značek obojí spravuje.
--
-- IMMUTABLE: výsledek závisí jen na vstupu (žádné nastavení, žádná tabulka),
-- takže se smí použít i v indexovém výrazu, kdyby listing přerostl sekvenční
-- čtení. STRICT: NULL na vstupu → NULL na výstupu, o NULL se nehledá.

CREATE OR REPLACE FUNCTION public.text_z_html(p_html text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path TO 'public'
AS $$
  SELECT btrim(regexp_replace(
    -- 3. pojmenované/číselné entity, které v obsahu reálně jsou
    replace(replace(replace(replace(replace(replace(
      -- 2. ostatní značky → mezera (NE prázdný řetězec: `a<br>b` je „a b", ne „ab")
      regexp_replace(
        -- 1. skript a styl VČETNĚ těla — jejich obsah není text článku
        regexp_replace(p_html, '<(script|style)\b[^>]*>.*?</\1\s*>', ' ', 'gis'),
        '<[^>]*>', ' ', 'g'),
      '&nbsp;', ' '), '&amp;', '&'), '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&#39;', ''''),
    -- 4. shluky mezer/nových řádků na jednu mezeru
    '\s+', ' ', 'g'));
$$;

-- PUBLIC nesmí mít nic (výchozí EXECUTE pro PUBLIC je právě to, co se odebírá).
REVOKE ALL ON FUNCTION public.text_z_html(text) FROM PUBLIC;

-- ⛔ ŽÁDNÝ GRANT PRO ROLE API — ZÁMĚR, NE OPOMENUTÍ.
--
-- Jediný volající je `get_published_news_articles_filtered`, a ta je
-- SECURITY DEFINER: běží pod svým VLASTNÍKEM, ne pod anon/authenticated.
-- Vlastník na svou pomocnou funkci právo má, takže grant pro role API by nic
-- neumožnil — jen by tuhle funkci vystavil jako RPC přes PostgREST (a brána
-- `db-types-cover-exposed-rpcs` by pak správně žádala její záznam
-- v generovaných typech). Pomocník na ořezání značek není součást API.
