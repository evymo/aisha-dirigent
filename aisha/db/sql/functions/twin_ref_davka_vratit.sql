-- ============================================================================
-- Source of Truth: twin_ref_davka_vratit
-- Popis: VRÁCENÍ hromadného schválení návrhů identit (twin_ref_group_decide).
--        Majitel: „vše vratné, s původem u dat". Kontrakt dávek (2026-09-23):
--        po položkách v OPAČNÉM pořadí přes batch_id; co se od dávky změnilo,
--        se nevrací a zapíše se jako `preskoceno_zmenene`.
--
-- Položka se vrací jen tehdy, když ji od dávky nikdo nezměnil:
--   potvrzeno     → návrh je pořád confirmed, platný (valid_to NULL) a nese
--                   confirmed_at zapsané dávkou → zpět na proposed
--   uz_potvrzeno  → návrh je pořád superseded (bezpředmětný) → zpět na proposed
-- Chybové položky dávka nezměnila, vracet není co.
-- Audit: jeden záznam vrácení s počty (bez klíčů zdroje).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.twin_ref_davka_vratit(p_batch_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_vraceno integer := 0;
  v_skip    integer := 0;
  v_hit     integer;
  r         record;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff required' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Revert requires an authenticated reviewer (auth.uid() is null)' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.twin_ref_davky WHERE batch_id = p_batch_id) THEN
    RAISE EXCEPTION 'batch % not found', p_batch_id USING ERRCODE = 'P0002';
  END IF;

  FOR r IN
    SELECT d.ref_id, d.vysledek, d.potvrzeno_at, d.platnost_pred
      FROM public.twin_ref_davky d
     WHERE d.batch_id = p_batch_id AND d.vraceno IS NULL AND d.vysledek <> 'chyba'
     ORDER BY d.poradi DESC
     FOR UPDATE
  LOOP
    IF r.vysledek = 'potvrzeno' THEN
      UPDATE public.twin_external_refs
         SET state = 'proposed', confirmed_by = NULL, confirmed_at = NULL,
             valid_from = r.platnost_pred, updated_at = now()
       WHERE id = r.ref_id AND state = 'confirmed' AND valid_to IS NULL
         AND confirmed_at IS NOT DISTINCT FROM r.potvrzeno_at;
    ELSE
      UPDATE public.twin_external_refs
         SET state = 'proposed', updated_at = now()
       WHERE id = r.ref_id AND state = 'superseded';
    END IF;
    GET DIAGNOSTICS v_hit = ROW_COUNT;

    UPDATE public.twin_ref_davky
       SET vraceno = CASE WHEN v_hit > 0 THEN 'vraceno' ELSE 'preskoceno_zmenene' END,
           vraceno_at = now(), vratil = v_uid
     WHERE batch_id = p_batch_id AND ref_id = r.ref_id;
    IF v_hit > 0 THEN v_vraceno := v_vraceno + 1; ELSE v_skip := v_skip + 1; END IF;
  END LOOP;

  INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, tags, details)
  VALUES (v_uid, 'twin_external_refs.batch_reverted', 'twin_external_refs.batch_reverted', 'content', 'info',
          array['surface', 'write', 'twin_identity', 'batch'],
          jsonb_build_object('batch_id', p_batch_id, 'vraceno', v_vraceno,
                             'preskoceno_zmenene', v_skip, 'note', p_note));

  RETURN jsonb_build_object('batch_id', p_batch_id, 'vraceno', v_vraceno, 'preskoceno_zmenene', v_skip);
END;
$$;

REVOKE ALL ON FUNCTION public.twin_ref_davka_vratit(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.twin_ref_davka_vratit(uuid, text) TO authenticated, service_role;
