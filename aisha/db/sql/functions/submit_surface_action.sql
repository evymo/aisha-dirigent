-- ============================================================================
-- Source of Truth: submit_surface_action
-- Popis: JEDINÁ zápisová cesta akcí správy z plochy (ADR-003, program K4).
--   Klient posílá `action_slug` + cíl + payload; tady se slug přeloží přes
--   allowlist `surface_actions` (RLS: aktivní a publikum volajícího), cíl se
--   ověří a doplní (twin → účet přes potvrzenou referenci, actor → twin),
--   payload se ověří proti deklaraci `fields` (typ, povinnost, výčet; neznámé
--   klíče se zahodí), argumenty se složí podle `arg_map` POJMENOVANĚ
--   (`p_x => ($1)[n]::typ`, hodnoty jako parametr) a zavolá se cílové RPC.
--   Každé volání má audit (jen klíče payloadu, nikdy hodnoty).
--   Typ pole `secret` (heslo, klíč dodavatele): bez výchozí hodnoty, v chybě ani
--   v auditu se neobjeví, klient ho kreslí jako skryté pole a nevrací ho.
--
-- BEZPEČNOST:
--   · SECURITY INVOKER — běží jako volající: RLS nad surface_actions rozhoduje,
--     co vůbec existuje; cílové RPC drží VLASTNÍ autorizaci (is_admin_or_staff,
--     adresát taktu, subjekt) a spouští se s právy volajícího. Tenhle dispečer
--     nikomu nic nepřidává — jen překládá a hlídá tvar.
--   · Jméno RPC pochází z tabulky (CHECK identifikátor) a jde do SQL přes %I;
--     hodnoty jdou VŽDY jako PARAMETR (EXECUTE … USING, `($1)[n]`) s explicitním
--     castem na typ z povoleného výčtu. Nic z klienta se do SQL neskládá jako
--     text — ani jako literál, protože text příkazu končí v logu chyb.
--   · Neviditelná akce = 42501, ne „nenalezeno" (nic se neprozrazuje).
--
-- Vrací {ok, action_slug, result} (result = to_jsonb návratu RPC, null u void).
-- ============================================================================
-- BEZ PŘÍPONY `_audited` ZÁMĚRNĚ: přípona je smlouva „běží jako DEFINER" (brána
-- audited-function-integrity). Tohle RPC musí být INVOKER — cílová funkce běží
-- s právy VOLAJÍCÍHO (EXECUTE + RLS + její vlastní is_admin_or_staff), ne jako
-- vlastník; audit se zapisuje přes audience_log_event stejně jako jinde.
CREATE OR REPLACE FUNCTION public.submit_surface_action(
  p_action_slug text,
  p_target      jsonb DEFAULT '{}'::jsonb,
  p_payload     jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_act      public.surface_actions%rowtype;
  v_twin     uuid;
  v_user     uuid;
  v_story    uuid;
  v_payload  jsonb := '{}'::jsonb;
  v_field    jsonb;
  v_key      text;
  v_ftype    text;
  v_val      text;
  v_missing  text[] := '{}';
  v_arg      jsonb;
  v_from     text;
  v_atype    text;
  v_args     text[] := '{}';
  v_vals     text[] := '{}';
  v_res      jsonb;
  v_uuid_re  constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_action_slug IS NULL OR p_action_slug !~ '^[a-z][a-z0-9_.]*$' THEN
    RAISE EXCEPTION 'action slug is required' USING ERRCODE = '22023';
  END IF;

  -- 1. allowlist (RLS: aktivní + publikum volajícího)
  SELECT * INTO v_act FROM public.surface_actions a WHERE a.action_slug = p_action_slug;
  IF NOT FOUND OR NOT v_act.is_active THEN
    RAISE EXCEPTION 'action % is not available to you', p_action_slug USING ERRCODE = '42501';
  END IF;

  -- 2. cíl
  p_target := coalesce(p_target, '{}'::jsonb);
  CASE v_act.target_kind
    WHEN 'twin' THEN
      IF coalesce(p_target->>'twin_id', '') !~ v_uuid_re THEN
        RAISE EXCEPTION 'target twin_id is required' USING ERRCODE = '22023';
      END IF;
      v_twin := (p_target->>'twin_id')::uuid;
      SELECT r.source_key::uuid INTO v_user
      FROM public.twin_external_refs r
      WHERE r.twin_id = v_twin AND r.ref_kind = 'account' AND r.state = 'confirmed'
        AND r.valid_to IS NULL AND r.source_key ~ v_uuid_re
      ORDER BY r.confirmed_at DESC NULLS LAST LIMIT 1;
    WHEN 'actor' THEN
      IF coalesce(p_target->>'user_id', '') !~ v_uuid_re THEN
        RAISE EXCEPTION 'target user_id is required' USING ERRCODE = '22023';
      END IF;
      v_user := (p_target->>'user_id')::uuid;
      v_twin := public.twin_for_account(v_user);
    WHEN 'story' THEN
      IF coalesce(p_target->>'story_id', '') !~ v_uuid_re THEN
        RAISE EXCEPTION 'target story_id is required' USING ERRCODE = '22023';
      END IF;
      v_story := (p_target->>'story_id')::uuid;
    ELSE
      NULL;
  END CASE;

  -- 3. payload podle deklarace polí (neznámé klíče se zahodí)
  FOR v_field IN SELECT * FROM jsonb_array_elements(coalesce(v_act.fields, '[]'::jsonb)) LOOP
    v_key   := v_field->>'key';
    v_ftype := coalesce(v_field->>'type', 'text');
    -- Klíč jde jen do jsonb (payload, payload_json), nikdy do SQL jako identifikátor,
    -- takže smí i camelCase: konfigurace pluginů (`baseUrl`) má klíče tak, jak je
    -- plugin čte (2026-09-26, připojení zdroje z administrace).
    CONTINUE WHEN v_key IS NULL OR v_key !~ '^[a-zA-Z][a-zA-Z0-9_]*$';
    v_val := nullif(btrim(coalesce(p_payload->>v_key, '')), '');
    IF v_val IS NULL THEN
      IF v_ftype <> 'secret' AND v_field ? 'default' AND nullif(v_field->>'default', '') IS NOT NULL THEN
        v_val := v_field->>'default';
      ELSIF coalesce((v_field->>'required')::boolean, false) THEN
        v_missing := v_missing || v_key;
        CONTINUE;
      ELSE
        CONTINUE;
      END IF;
    END IF;
    CASE v_ftype
      WHEN 'uuid' THEN
        IF v_val !~ v_uuid_re THEN RAISE EXCEPTION 'field % must be a uuid', v_key USING ERRCODE = '22023'; END IF;
      WHEN 'date' THEN
        IF v_val !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'field % must be a date (YYYY-MM-DD)', v_key USING ERRCODE = '22023'; END IF;
      WHEN 'timestamptz' THEN
        -- Přijímá ISO 8601 z formuláře (datetime-local: 2026-09-10T09:00) i textový
        -- tvar Postgresu (2026-09-07 22:40:05.12+00 — posun může být jen HH).
        IF v_val !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?)?([Zz]|[+-][0-9]{2}(:?[0-9]{2})?)?$' THEN
          RAISE EXCEPTION 'field % must be a timestamp', v_key USING ERRCODE = '22023';
        END IF;
      WHEN 'integer' THEN
        IF v_val !~ '^-?[0-9]{1,12}$' THEN RAISE EXCEPTION 'field % must be an integer', v_key USING ERRCODE = '22023'; END IF;
      WHEN 'boolean' THEN
        IF lower(v_val) NOT IN ('true', 'false') THEN RAISE EXCEPTION 'field % must be true/false', v_key USING ERRCODE = '22023'; END IF;
        v_val := lower(v_val);
      WHEN 'enum' THEN
        IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_field->'options', '[]'::jsonb)) o WHERE o->>'value' = v_val) THEN
          RAISE EXCEPTION 'field % has a value outside its options', v_key USING ERRCODE = '22023';
        END IF;
      WHEN 'secret' THEN
        -- Tajná hodnota (heslo, klíč dodavatele): ověří se jen délka a do chyby se
        -- NIKDY nevypisuje. Výchozí hodnotu mít nesmí (deklarace je čitelná všem, kdo
        -- akci vidí) — `default` u tajného pole se ignoruje výš: prázdné = chybí.
        IF length(v_val) > 4000 THEN RAISE EXCEPTION 'field % is too long', v_key USING ERRCODE = '22023'; END IF;
      ELSE -- text | textarea
        IF length(v_val) > 4000 THEN RAISE EXCEPTION 'field % is too long', v_key USING ERRCODE = '22023'; END IF;
    END CASE;
    v_payload := v_payload || jsonb_build_object(v_key, v_val);
  END LOOP;
  IF coalesce(array_length(v_missing, 1), 0) > 0 THEN
    RAISE EXCEPTION 'missing required field(s): %', array_to_string(v_missing, ', ') USING ERRCODE = '22023';
  END IF;

  -- 4. argumenty podle arg_map — pojmenovaně, s explicitním typem, HODNOTY JAKO PARAMETR
  --
  -- ⛔ NE LITERÁLY V TEXTU PŘÍKAZU (2026-09-26). Hodnoty se dřív skládaly do textu
  -- (`p_x => 'hodnota'::text`). Když cílové RPC spadlo, Postgres zalogoval chybu
  -- i s kontextem PL/pgSQL („SQL statement …") — tedy s hodnotou; v provozu je
  -- log_min_error_statement=error. U tajného pole (heslo dodavatele) by to byl
  -- únik do logu serveru. Teď jde každá hodnota jako prvek pole `$1` přes
  -- EXECUTE … USING: text příkazu nese jen `($1)[n]::typ`.
  FOR v_arg IN SELECT * FROM jsonb_array_elements(coalesce(v_act.arg_map, '[]'::jsonb)) LOOP
    v_from  := v_arg->>'from';
    v_atype := coalesce(v_arg->>'type', 'text');
    IF coalesce(v_arg->>'name', '') !~ '^[a-z][a-z0-9_]*$' THEN
      RAISE EXCEPTION 'arg_map entry without a valid name' USING ERRCODE = '22023';
    END IF;
    IF v_atype NOT IN ('uuid','text','timestamptz','date','integer','boolean','numeric','jsonb','uuid[]','text[]') THEN
      RAISE EXCEPTION 'arg_map type % is not allowed', v_atype USING ERRCODE = '22023';
    END IF;
    v_val := CASE v_from
      WHEN 'target.twin_id'   THEN v_twin::text
      WHEN 'target.user_id'   THEN v_user::text
      WHEN 'target.user_ids'  THEN CASE WHEN v_user IS NULL THEN NULL ELSE '{' || v_user::text || '}' END
      WHEN 'target.story_id'  THEN v_story::text
      WHEN 'caller.user_id'   THEN v_uid::text
      WHEN 'const'            THEN v_arg->>'value'
      WHEN 'payload'          THEN v_payload->>(v_arg->>'key')
      WHEN 'payload_json'     THEN v_payload::text
      ELSE NULL
    END;
    IF v_from NOT IN ('target.twin_id','target.user_id','target.user_ids','target.story_id','caller.user_id','const','payload','payload_json') THEN
      RAISE EXCEPTION 'arg_map source % is not allowed', v_from USING ERRCODE = '22023';
    END IF;
    IF v_val IS NULL AND v_arg->>'fallback' = 'caller.user_id' THEN
      v_val := v_uid::text;
    END IF;
    IF v_val IS NULL THEN
      IF coalesce((v_arg->>'required')::boolean, true) THEN
        RAISE EXCEPTION 'argument % has no value (source %)', v_arg->>'name', v_from USING ERRCODE = '22023';
      END IF;
      v_args := v_args || format('%I => NULL::%s', v_arg->>'name', v_atype);
    ELSE
      v_vals := v_vals || v_val;
      v_args := v_args || format('%I => ($1)[%s]::%s', v_arg->>'name', array_length(v_vals, 1), v_atype);
    END IF;
  END LOOP;

  -- 5. volání cílového RPC (jméno z allowlistu, %I; argumenty pojmenované)
  IF coalesce(v_act.returns_void, false) THEN
    EXECUTE format('select public.%I(%s)', v_act.rpc_name, array_to_string(v_args, ', ')) USING v_vals;
    v_res := 'null'::jsonb;
  ELSE
    EXECUTE format('select to_jsonb(public.%I(%s))', v_act.rpc_name, array_to_string(v_args, ', ')) INTO v_res USING v_vals;
  END IF;

  -- 6. audit (bez PII: cíl jako id, jen klíče payloadu)
  PERFORM public.audience_log_event(
    'surface_action',
    p_action_slug,
    v_act.target_kind,
    coalesce(v_twin, v_user, v_story, v_uid),
    format('Surface action %s (%s)', p_action_slug, v_act.rpc_name),
    jsonb_build_object(
      'target', p_target,
      'payload_keys', (SELECT coalesce(jsonb_agg(k), '[]'::jsonb) FROM jsonb_object_keys(v_payload) k),
      'rpc', v_act.rpc_name,
      'result', v_res)
  );

  RETURN jsonb_build_object('ok', true, 'action_slug', p_action_slug, 'result', v_res);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_surface_action(text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_surface_action(text, jsonb, jsonb) TO authenticated, service_role;
