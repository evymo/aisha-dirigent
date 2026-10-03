-- ============================================================================
-- Source of Truth: hr_odvaz_ucet_admin
-- Popis: HR ukončí vazbu ÚČET → OSOBA. Nic nemaže: vazbě skončí platnost
--        (valid_to = now()), stav zůstává `confirmed` = historie „kdo to byl
--        a do kdy" (stejná sémantika jako předání v twin_identity_confirm_binding).
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT; jen admin/staff s reálnou identitou
-- Audit: twin_external_refs.ended (bez source_key — id účtu je osobní údaj)
--
-- Proč existuje: hr_prirad_ucet_admin osobu s JINÝM účtem vědomě nepřebírá.
-- Bez odvázání by se omyl (účet na špatném člověku) nedal opravit jinak než
-- v SQL — a přístup navíc, který omyl dává, nikdo nenahlásí.
--
-- Viditelnost končí OKAMŽITĚ: workflow_step_visible_to i twin_for_account
-- čtou jen vazby platné v čase `now()`.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.hr_odvaz_ucet_admin(
  p_ref_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hr uuid := auth.uid();
  v_ref record;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff required';
  END IF;
  IF v_hr IS NULL THEN
    RAISE EXCEPTION 'Unbinding requires an authenticated person (auth.uid() is null)';
  END IF;

  SELECT r.id, r.twin_id, r.ref_kind, r.state, r.valid_to
    INTO v_ref
    FROM public.twin_external_refs r
   WHERE r.id = p_ref_id
   FOR UPDATE;
  IF v_ref.id IS NULL THEN
    RAISE EXCEPTION 'binding % not found', p_ref_id;
  END IF;
  -- Jen účtové vazby: tahle obrazovka nesahá na vazby zdrojů (ty ratifikuje
  -- review lane) — jinak by HR omylem odpojilo osobu od Webdispečinku.
  IF v_ref.ref_kind <> 'account' THEN
    RAISE EXCEPTION 'binding % is not an account binding', p_ref_id;
  END IF;
  IF v_ref.state <> 'confirmed' OR v_ref.valid_to IS NOT NULL THEN
    RETURN jsonb_build_object('ref_id', p_ref_id, 'already', true);
  END IF;

  UPDATE public.twin_external_refs
     SET valid_to = now(), updated_at = now()
   WHERE id = p_ref_id;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (v_hr, 'twin_external_refs.ended',
          jsonb_build_object('ref_id', p_ref_id, 'twin_id', v_ref.twin_id,
                             'ref_kind', v_ref.ref_kind, 'duvod', 'hr_odvazani'));

  RETURN jsonb_build_object('ref_id', p_ref_id, 'already', false);
END;
$$;

REVOKE ALL ON FUNCTION public.hr_odvaz_ucet_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_odvaz_ucet_admin(uuid) TO authenticated;
