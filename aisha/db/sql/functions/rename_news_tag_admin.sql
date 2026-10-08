-- Function: public.rename_news_tag_admin
-- Description: Přejmenuje štítek novinek; existuje-li cílový štítek, SLOUČÍ je
--              (článek, který měl oba, ho má jednou, pořadí štítků se zachová).
--              Platí pro živé články i pro koncepty zveřejněných článků
--              (news_article_versions kind='draft', fields.tags) — jinak by
--              „Zveřejnit změny" starý štítek vrátilo. Historie verzí se nemění.
--              Zobrazované názvy (translations, namespace 'news-tags', klíč =
--              hodnota štítku) se přesunou na nový štítek tam, kde nový pro daný
--              jazyk název ještě nemá; zbytek starého se smaže.
--              Vrací počet změněných živých článků.
--
--              Tvar štítku hlídá klient (normalizujStitek: malá písmena, mezery →
--              pomlčky, jen písmena/číslice/_/-, max 40). Tady pojistka hranice:
--              neprázdný, max 40 znaků, bez bílých znaků, bez ASCII interpunkce
--              kromě - a _ a bez velkých písmen ASCII. (Třídy [[:alnum:]] v DB
--              s locale C nepoznají českou diakritiku, proto zákaz, ne povolení.)
--
-- ⛔ Přejmenování mění news_articles.updated_at — seed obsahu instance takový
--    článek pozná jako upravený a nevrátí ho (pojistka 02_content.sql).
-- Security: SECURITY DEFINER; admin/staff.
-- Created: 2026-10-02 (z instance: správkyně webu spravuje štítky sama)

CREATE OR REPLACE FUNCTION public.rename_news_tag_admin(p_from text, p_to text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_z text := btrim(COALESCE(p_from, ''));
  v_na text := btrim(COALESCE(p_to, ''));
  v_clanku integer := 0;
  v_konceptu integer := 0;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF v_z = '' OR v_na = '' THEN
    RAISE EXCEPTION 'Tag must not be empty' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_na) > 40
     OR v_na ~ '[[:space:]]'
     OR v_na ~ '[!-,./:-@\[-^`{-~]'
     OR v_na ~ '[A-Z]' THEN
    RAISE EXCEPTION 'Invalid tag: use lowercase letters, digits, - or _ (max 40)' USING ERRCODE = '22023';
  END IF;
  IF v_z = v_na THEN
    RETURN 0;
  END IF;

  UPDATE public.news_articles a
     SET tags = (
       SELECT array_agg(s.stitek ORDER BY s.poradi)
         FROM (SELECT u.stitek, min(u.poradi) AS poradi
                 FROM unnest(array_replace(a.tags, v_z, v_na)) WITH ORDINALITY AS u(stitek, poradi)
                GROUP BY u.stitek) s
     )
   WHERE v_z = ANY (a.tags);
  GET DIAGNOSTICS v_clanku = ROW_COUNT;

  UPDATE public.news_article_versions d
     SET fields = jsonb_set(d.fields, '{tags}', (
       SELECT COALESCE(jsonb_agg(s.stitek ORDER BY s.poradi), '[]'::jsonb)
         FROM (SELECT CASE WHEN u.stitek = v_z THEN v_na ELSE u.stitek END AS stitek, min(u.poradi) AS poradi
                 FROM jsonb_array_elements_text(d.fields -> 'tags') WITH ORDINALITY AS u(stitek, poradi)
                GROUP BY 1) s
     ))
   WHERE d.kind = 'draft'
     AND jsonb_typeof(d.fields -> 'tags') = 'array'
     AND d.fields -> 'tags' ? v_z;
  GET DIAGNOSTICS v_konceptu = ROW_COUNT;

  UPDATE public.translations t
     SET key = v_na
   WHERE t.namespace = 'news-tags' AND t.key = v_z
     AND NOT EXISTS (
       SELECT 1 FROM public.translations c
        WHERE c.namespace = 'news-tags' AND c.key = v_na AND c.locale = t.locale
     );
  DELETE FROM public.translations WHERE namespace = 'news-tags' AND key = v_z;

  PERFORM public.write_audit_journal(
    p_action_type := 'update'::public.journal_action_type,
    p_area := 'content'::public.journal_area,
    p_details := NULL,
    p_entity_id := v_na,
    p_entity_type := 'news_tag',
    p_new_values := jsonb_build_object('from', v_z, 'to', v_na, 'articles', v_clanku, 'drafts', v_konceptu),
    p_old_values := NULL,
    p_severity := 'info'::public.journal_severity,
    p_summary := 'Renamed news tag',
    p_tags := ARRAY['admin', 'content', 'news', 'tags'],
    p_user_id := auth.uid()
  );
  RETURN v_clanku;
END;
$$;

REVOKE ALL ON FUNCTION public.rename_news_tag_admin(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rename_news_tag_admin(text, text) TO authenticated;
