-- ============================================================================
-- Source of Truth: twin_ref_group_decide
-- Popis: HROMADNÉ schválení skupiny návrhů identit z bloku get_twin_ref_group_block
--        (entity_kind 'twin_identity_group' v submit_evidence_review_audited).
--
-- ⛔ Majitel 2026-09-28: „teprve dva zdroje pravdy se shodou sto procent opravňují
-- k návrhu na hromadné sloučení" + „vše vratné, s původem u dat". Proto:
--   1. Skupina se najde v DATECH: aktivní blok get_twin_ref_group_block, jehož
--      konfigurace dává totéž id skupiny (md5 zdroje, druhu entity a group_key)
--      a jehož `batch_classes` třídu povolují. Jinak chyba — žádné hádání.
--   2. Třída se spočítá ZNOVU teď (twin_ref_tridy). Do dávky jde jen to, co do
--      skupiny patří v okamžiku provedení; co mezitím přestalo platit, nepadne.
--   3. Každá položka jde TOUŽ lidskou ratifikací jako jednotlivé schválení
--      (twin_identity_confirm_binding: správa, reálné auth.uid(), audit položky)
--      ve vlastním savepointu — chyba položky dávku nezastaví, zapíše se.
--   4. Deník twin_ref_davky nese, co dávka udělala; vrácení twin_ref_davka_vratit.
--   5. Předání klíče jinému dvojčeti (p_supersede) dávka NEDĚLÁ — zůstává vědomým
--      úkonem u jednotlivé položky; v dávce skončí jako chyba položky.
-- Rozhodnutí je jen 'confirmed' — hromadné zamítnutí se nenabízí.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.twin_ref_group_decide(
  p_group_id uuid,
  p_decision text,
  p_note     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_params    jsonb;
  v_group_key text;
  v_batch     uuid := gen_random_uuid();
  v_poradi    integer := 0;
  v_ok        integer := 0;
  v_uz        integer := 0;
  v_chyb      integer := 0;
  v_res       jsonb;
  v_err       text;
  v_pred      timestamptz;
  r           record;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff required (human ratification)' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Ratification requires an authenticated reviewer (auth.uid() is null)' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('confirmed', 'approved', 'HUMAN_CONFIRMED') THEN
    RAISE EXCEPTION 'decision % not supported for twin_identity_group (confirmed only)', p_decision
      USING ERRCODE = '22023';
  END IF;

  -- 1. Skupina z dat bloku.
  SELECT b.source_params, g.group_key
    INTO v_params, v_group_key
    FROM public.surface_blocks b
    CROSS JOIN LATERAL jsonb_array_elements_text(b.source_params->'batch_classes') bc(trida)
    CROSS JOIN LATERAL (
      SELECT DISTINCT 'twin_identity:' || x.ref_kind || ':' || bc.trida AS group_key
        FROM public.twin_external_refs x
       WHERE x.source = b.source_params->>'source' AND x.state = 'proposed'
    ) g
   WHERE b.source_rpc = 'get_twin_ref_group_block'
     AND b.is_active
     AND jsonb_typeof(b.source_params->'batch_classes') = 'array'
     AND md5('twin_ref_group:' || (b.source_params->>'source') || ':'
             || coalesce(b.source_params->>'entity_type', '') || ':' || g.group_key)::uuid = p_group_id
   LIMIT 1;
  IF v_group_key IS NULL THEN
    RAISE EXCEPTION 'group % not found in any active group block (configuration changed?)', p_group_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 2.–4. Členové skupiny TEĎ, deterministicky po položkách.
  FOR r IN
    SELECT t.ref_id FROM public.twin_ref_tridy(v_params) t
     WHERE t.group_key = v_group_key
     ORDER BY t.ref_id
  LOOP
    v_poradi := v_poradi + 1;
    SELECT x.valid_from INTO v_pred FROM public.twin_external_refs x WHERE x.id = r.ref_id;
    BEGIN
      v_res := public.twin_identity_confirm_binding(r.ref_id);
      IF coalesce((v_res->>'already')::boolean, false) THEN
        v_uz := v_uz + 1;
        INSERT INTO public.twin_ref_davky (batch_id, poradi, ref_id, group_key, vysledek, stav_pred,
                                           platnost_pred, provedl)
        VALUES (v_batch, v_poradi, r.ref_id, v_group_key, 'uz_potvrzeno', 'proposed', v_pred, v_uid);
      ELSE
        v_ok := v_ok + 1;
        INSERT INTO public.twin_ref_davky (batch_id, poradi, ref_id, group_key, vysledek, stav_pred,
                                           platnost_pred, potvrzeno_at, provedl)
        SELECT v_batch, v_poradi, r.ref_id, v_group_key, 'potvrzeno', 'proposed', v_pred, x.confirmed_at, v_uid
          FROM public.twin_external_refs x WHERE x.id = r.ref_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      v_chyb := v_chyb + 1;
      INSERT INTO public.twin_ref_davky (batch_id, poradi, ref_id, group_key, vysledek, chyba, stav_pred,
                                         platnost_pred, provedl)
      VALUES (v_batch, v_poradi, r.ref_id, v_group_key, 'chyba', left(v_err, 500), 'proposed', v_pred, v_uid);
    END;
  END LOOP;

  -- Audit dávky (bez klíčů zdroje — IČO/jméno mohou být osobní údaj).
  INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, tags, details)
  VALUES (v_uid, 'twin_external_refs.batch_confirmed', 'twin_external_refs.batch_confirmed', 'content', 'info',
          array['surface', 'write', 'twin_identity', 'batch'],
          jsonb_build_object('batch_id', v_batch, 'group_id', p_group_id, 'group_key', v_group_key,
                             'potvrzeno', v_ok, 'uz_potvrzeno', v_uz, 'chyba', v_chyb,
                             'celkem', v_poradi, 'note', p_note));

  RETURN jsonb_build_object('batch_id', v_batch, 'group_key', v_group_key, 'celkem', v_poradi,
                            'potvrzeno', v_ok, 'uz_potvrzeno', v_uz, 'chyba', v_chyb);
END;
$$;

REVOKE ALL ON FUNCTION public.twin_ref_group_decide(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.twin_ref_group_decide(uuid, text, text) TO authenticated, service_role;
