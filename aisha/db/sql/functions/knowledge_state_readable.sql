-- Function: knowledge_state_readable
--
-- JEDEN domov pravidla „kterou položku znalostí smí čtení vydat“: jen stav z allowlistu.
--
-- ⛔ ALLOWLIST, NE DENYLIST. Do 2026-10-04 se čtení bránilo výčtem ZAKÁZANÝCH stavů
-- (`NOT IN ('flagged', 'quarantined')`) — a to jen na části cest. Nový stav, neznámá
-- hodnota i NULL tak prošly jako „čisté“. Tady je výčet POVOLENÝCH: cokoli jiného,
-- včetně NULL a hodnoty, kterou dnes nikdo nezná, se nevydá (NULL IN (…) je NULL,
-- a to podmínka WHERE i politika berou jako „ne“).
--
-- Jazyk sql, IMMUTABLE, s právy volajícího a bez SET: plánovač ji vloží do dotazu,
-- takže z ní zbude prostý test `IN (…)` — žádné volání na řádek, index na stavu zůstává
-- použitelný. Volat VŽDY s kvalifikací `public.` (brána definer-search-path).
--
-- ROLÍM API SE NEVYDÁVÁ. Volají ji jen funkce, které běží právy vlastníka; pro anon ani
-- authenticated to není volatelná funkce (a tedy ani RPC). Politiky tabulky, které se
-- vyhodnocují právy tazatele, proto nesou TÝŽ výčet doslova — shodu hlídá brána
-- znalosti-citelny-stav-jeden-seznam.
CREATE OR REPLACE FUNCTION public.knowledge_state_readable(p_state text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT p_state IN ('clear', 'reviewed', 'reinstated')
$$;

REVOKE ALL ON FUNCTION public.knowledge_state_readable(text) FROM PUBLIC;
