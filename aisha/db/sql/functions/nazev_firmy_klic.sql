-- ============================================================================
-- Source of Truth: nazev_firmy_klic
-- Popis: KLÍČ JMÉNA FIRMY pro porovnání „je to totéž jméno?" mezi zdroji.
--        Totéž jméno zapíše účetnictví, smlouva a veřejný rejstřík různě:
--        „Alfa, s.r.o." · „ALFA s. r. o." · „Alfa spol. s r.o.". Klíč srovná JEN
--        zápis — malá písmena, bez diakritiky, bez interpunkce, jedna mezera —
--        a právní formu na jednu zkratku. Nic víc: jiné slovo v názvu je jiné
--        jméno (přejmenování, jiná firma), a to se schovávat nesmí.
--
-- Proč ne norm_text: ten jen sníží písmena a odstraní diakritiku, takže
-- „a.s." a „a. s." by byla dvě jména a každá druhá shoda by spadla do rozporu.
--
-- Použití: twin_ref_tridy (shoda jména mezi zdroji v čase).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.nazev_firmy_klic(p_nazev text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  select nullif(btrim(
    -- právní forma na konci názvu → jedna zkratka (zápis „spol. s r. o." i „s.r.o.")
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(
      ' ' || btrim(regexp_replace(regexp_replace(
        translate(lower(coalesce(p_nazev, '')), 'áčďéěíňóřšťúůýžäöü', 'acdeeinorstuuyzaou'),
        '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g')) || ' ',
      ' spol s r o $', ' sro '),
      ' s r o $', ' sro '),
      ' a s $', ' as '),
      ' v o s $', ' vos '),
      ' k s $', ' ks '),
      ' o p s $', ' ops '),
      ' z s $', ' zs '),
      ' z u $', ' zu ')
  ), '');
$$;

COMMENT ON FUNCTION public.nazev_firmy_klic(text) IS
  'Klíč jména firmy pro porovnání mezi zdroji: malá písmena, bez diakritiky a interpunkce, právní forma jednou zkratkou. Jiné slovo = jiné jméno.';

REVOKE ALL ON FUNCTION public.nazev_firmy_klic(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nazev_firmy_klic(text) TO authenticated, service_role;
