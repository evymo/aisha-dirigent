-- ============================================================================
-- Source of Truth: broker_quarantine_discard_admin
-- Popis: Zahodí odložené (karanténované) balíčky zdroje ROZHODNUTÍM ČLOVĚKA —
--        se stopou původu a s možností vrácení.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT (admin/staff nebo service_role)
--
-- ⛔ PROČ VZNIKLA. Naměřeno 2026-09-16 v produkci instance: tři balíčky ze 3.–4. 8.
--    ležely v `metadata->'karantena'` od té doby. Driver je při KAŽDÉM tiku hlásí
--    („balíčky v karanténě čekají na rozhodnutí — fronta jede dál"), ale vyřídit je
--    nešlo ničím: karanténa se vyprázdní jen tím, že se týž balíček znovu objeví
--    na disku a projde. Ty soubory už neexistují (retence exportu je dávno smazala),
--    takže by se seznam nevyprázdnil NIKDY. Varování, které nejde vyřídit, učí
--    operátora přehlížet varování.
--
-- ⭐ ZAHOZENÍ NENÍ ZTRÁTA DAT. Engine skládá korpus při každém běhu znovu ze vstupu
--    a exportuje ho CELÝ: obsah starého balíčku veze i ten dnešní (ověřeno 09-16 —
--    registr 4 923 řádků pokrývá doklady 2022–2026). Zahazuje se ZÁZNAM O ČEKÁNÍ,
--    ne doklady.
--
-- ⛔ VÝSLOVNÝ SEZNAM, NE „všechno staré". `p_export_ids` NULL = celá karanténa
--    zdroje, ale i tehdy se do rozhodnutí zapíše, co přesně se zahodilo —
--    aby vrácení vědělo, co obnovit, a aby šlo dohledat, co v seznamu bylo.
--
-- ⭐ NÁHLED JE VÝCHOZÍ (p_dry_run = true): vrátí, co by se zahodilo, a nic nezapíše.
--
-- ⭐ DOHLEDATELNÉ A VRATNÉ (zadání majitele 2026-09-15: „všechny tyto autonomní
--    kroky potřebujeme umět dohledat, dohledovat a případně zrušit a opravit
--    uživatelem z UI"). Ostrý běh = řádek audit_journal (entity_type
--    'broker_decision') s důvodem, kritériem a seznamem PŘED zahozením; vrácení
--    dělá revert_broker_quarantine_discard_admin, přehled get_decisions_admin.
--
-- Kontrakt: (text, text[], text, boolean) ->
--   jsonb {ok, dry_run, decision_id?, zahozeno, zbyva, nezname, kriterium} | {ok:false, error}
-- ============================================================================

CREATE OR REPLACE FUNCTION public.broker_quarantine_discard_admin(
  p_source_slug text,
  p_export_ids  text[] DEFAULT NULL,
  p_reason      text DEFAULT NULL,
  p_dry_run     boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_decision   uuid := gen_random_uuid();
  v_karantena  text[];
  v_zahodit    text[];
  v_zbyva      text[];
  v_nezname    text[];
  v_kriterium  jsonb;
BEGIN
  IF NOT (public.is_service_role() OR public.is_admin_or_staff(auth.uid())) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'nedostatečné oprávnění');
  END IF;
  IF coalesce(btrim(p_source_slug), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'p_source_slug je povinný');
  END IF;
  -- Důvod je povinný i u náhledu: rozhodnutí bez důvodu se nedá doložit, a kdo
  -- si ho vymyslí až u ostrého běhu, vymyslí ho jinak než ten, kdo náhled četl.
  IF coalesce(btrim(p_reason), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'důvod (p_reason) je povinný');
  END IF;

  SELECT array(SELECT jsonb_array_elements_text(coalesce(s.metadata->'karantena', '[]'::jsonb)))
    INTO v_karantena
    FROM public.audience_broker_sync_state s
   WHERE s.source_slug = p_source_slug;
  IF v_karantena IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error',
      format('zdroj %s nemá stav synchronizace — není co zahazovat', p_source_slug));
  END IF;

  v_zahodit := coalesce(
    ARRAY(SELECT x FROM unnest(v_karantena) x
           WHERE p_export_ids IS NULL OR x = ANY (p_export_ids)),
    ARRAY[]::text[]);
  v_zbyva := coalesce(
    ARRAY(SELECT x FROM unnest(v_karantena) x WHERE NOT (x = ANY (v_zahodit))),
    ARRAY[]::text[]);
  -- Id, které v karanténě není, se NEPŘEJDE MLČKY: buď je překlep, nebo už
  -- někdo zahodil dřív — a obojí má volající vidět.
  v_nezname := coalesce(
    ARRAY(SELECT x FROM unnest(coalesce(p_export_ids, ARRAY[]::text[])) x
           WHERE NOT (x = ANY (v_karantena))),
    ARRAY[]::text[]);

  v_kriterium := jsonb_build_object('source_slug', p_source_slug,
                                    'export_ids', to_jsonb(coalesce(p_export_ids, ARRAY[]::text[])));

  IF p_dry_run THEN
    RETURN jsonb_build_object('ok', true, 'dry_run', true,
                              'zahozeno', to_jsonb(v_zahodit), 'zbyva', to_jsonb(v_zbyva),
                              'nezname', to_jsonb(v_nezname), 'kriterium', v_kriterium);
  END IF;

  IF array_length(v_zahodit, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'v karanténě není nic, co by odpovídalo',
                              'nezname', to_jsonb(v_nezname), 'kriterium', v_kriterium);
  END IF;

  UPDATE public.audience_broker_sync_state s
     SET metadata = jsonb_set(coalesce(s.metadata, '{}'::jsonb), '{karantena}', to_jsonb(v_zbyva)),
         updated_at = now()
   WHERE s.source_slug = p_source_slug;

  INSERT INTO public.audit_journal (id, user_id, action, action_type, area, entity_type, entity_id,
                                    summary, details, metadata)
  VALUES (v_decision, auth.uid(), 'broker.quarantine_discarded', 'update', 'integrations',
          'broker_decision', v_decision::text,
          format('Karanténa zdroje %s: zahozeno %s balíčků — %s',
                 p_source_slug, array_length(v_zahodit, 1), p_reason),
          jsonb_build_object('duvod', p_reason, 'kriterium', v_kriterium,
                             'pocty', jsonb_build_object('zahozeno', array_length(v_zahodit, 1),
                                                         'zbyva', coalesce(array_length(v_zbyva, 1), 0)),
                             'zahozeno', to_jsonb(v_zahodit),
                             'pred_zahozenim', to_jsonb(v_karantena),
                             'vratne', true),
          jsonb_build_object('source_slug', p_source_slug,
                             'zahozeno', array_length(v_zahodit, 1)));

  RETURN jsonb_build_object('ok', true, 'dry_run', false, 'decision_id', v_decision,
                            'zahozeno', to_jsonb(v_zahodit), 'zbyva', to_jsonb(v_zbyva),
                            'nezname', to_jsonb(v_nezname), 'kriterium', v_kriterium);
END;
$function$;

REVOKE ALL ON FUNCTION public.broker_quarantine_discard_admin(text, text[], text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.broker_quarantine_discard_admin(text, text[], text, boolean) TO authenticated, service_role;
