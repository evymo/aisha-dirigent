-- ============================================================================
-- Source of Truth: set_data_source_secrets
-- Popis: Uloží (nebo přepíše) pověření ke zdroji. Šifrovaně, auditovaně.
--
-- Tvar vstupu je ROVNOU tvar, který plugin o sobě tvrdí: klíče odpovídají
-- `config_schema.properties.*` s `secret: true`. Administrace tedy formulář
-- NEVYMÝŠLÍ — vykreslí ho ze schématu a pošle sem, co člověk vyplnil.
--
-- ⛔ PRÁZDNÁ HODNOTA MAŽE, NEULOŽÍ PRÁZDNO. „Vymazat pověření" je legitimní
-- úkon a musí mít vyjádření; uložený prázdný řetězec by naopak vypadal jako
-- vyplněný a stráž při aktivaci by ho pustila dál.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_data_source_secrets(
  p_source_slug text,
  p_secrets     jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_source_id uuid;
  v_key       text;
  v_val       text;
  v_ulozeno   int := 0;
  v_smazano   int := 0;
BEGIN
  IF NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_secrets IS NULL OR jsonb_typeof(p_secrets) <> 'object' THEN
    RAISE EXCEPTION 'set_data_source_secrets: p_secrets musí být objekt {klíč: hodnota}';
  END IF;

  SELECT id INTO v_source_id
    FROM public.agent_knowledge_sources
   WHERE source_slug = p_source_slug;

  IF v_source_id IS NULL THEN
    RAISE EXCEPTION 'set_data_source_secrets: zdroj % neexistuje', p_source_slug;
  END IF;

  FOR v_key, v_val IN SELECT k, v FROM jsonb_each_text(p_secrets) AS e(k, v) LOOP
    IF v_val IS NULL OR length(btrim(v_val)) = 0 THEN
      DELETE FROM public.agent_knowledge_source_secrets
       WHERE source_id = v_source_id AND secret_key = v_key;
      v_smazano := v_smazano + 1;
    ELSE
      INSERT INTO public.agent_knowledge_source_secrets (source_id, secret_key, value_enc, set_by)
      VALUES (v_source_id, v_key,
              public.aisha_encrypt_column_audited(v_val, jsonb_build_object(
                'ucel', 'ulozeni_povereni', 'entita', 'agent_knowledge_source',
                'entita_id', v_source_id::text, 'zdroj', p_source_slug, 'klic', v_key)),
              auth.uid())
      ON CONFLICT (source_id, secret_key) DO UPDATE
        SET value_enc = EXCLUDED.value_enc,
            set_by    = EXCLUDED.set_by,
            updated_at = now();
      v_ulozeno := v_ulozeno + 1;
    END IF;
  END LOOP;

  -- ⛔ Do žurnálu jdou JMÉNA klíčů, nikdy hodnoty ani jejich délky.
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'DATA_SOURCE_SECRETS_SET', jsonb_build_object(
    'area', 'ingest', 'severity', 'warning',
    'source_slug', p_source_slug,
    'keys', (SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(p_secrets) k),
    'stored', v_ulozeno, 'cleared', v_smazano
  ));

  RETURN jsonb_build_object('source_slug', p_source_slug, 'stored', v_ulozeno, 'cleared', v_smazano);
END;
$$;

COMMENT ON FUNCTION public.set_data_source_secrets(text, jsonb) IS
  'Uloží pověření ke zdroji šifrovaně (aisha_encrypt_column_audited). Prázdná hodnota klíč MAŽE. Hodnoty se nikdy nevracejí ani neloggují. Admin/staff nebo service_role.';

REVOKE ALL ON FUNCTION public.set_data_source_secrets(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_data_source_secrets(text, jsonb) TO authenticated, service_role;
