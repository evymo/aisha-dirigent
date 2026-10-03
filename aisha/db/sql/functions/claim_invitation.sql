-- Function: public.claim_invitation
-- Arguments: p_code text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:25:58+01:00

CREATE OR REPLACE FUNCTION public.claim_invitation(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invitation RECORD;
  v_user_id UUID := auth.uid();
  v_twin_navrzeno BOOLEAN := false;
  v_adresovana BOOLEAN := false;
  v_result JSONB;
BEGIN
  -- Get the invitation
  SELECT * INTO v_invitation
  FROM invitations
  WHERE code = p_code
    AND is_active = true
    AND (expires_at IS NULL OR expires_at > now())
    AND (max_uses IS NULL OR used_count < max_uses)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_OR_EXPIRED');
  END IF;

  -- Check if already claimed by this user
  IF EXISTS (
    SELECT 1 FROM invitation_claims 
    WHERE invitation_id = v_invitation.id AND user_id = v_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_CLAIMED');
  END IF;

  -- Insert claim record
  INSERT INTO invitation_claims (invitation_id, user_id)
  VALUES (v_invitation.id, v_user_id);

  -- Update used_count
  UPDATE invitations
  SET used_count = used_count + 1
  WHERE id = v_invitation.id;

  -- Deactivate if max uses reached
  IF v_invitation.max_uses IS NOT NULL AND v_invitation.used_count + 1 >= v_invitation.max_uses THEN
    UPDATE invitations SET is_active = false WHERE id = v_invitation.id;
  END IF;

  -- Assign role if specified
  IF v_invitation.role IS NOT NULL THEN
    INSERT INTO user_roles (user_id, role)
    VALUES (v_user_id, v_invitation.role::app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  -- Enroll in study if specified
  IF v_invitation.study_id IS NOT NULL THEN
    INSERT INTO study_registrations (user_id, study_id, status)
    VALUES (v_user_id, v_invitation.study_id, 'enrolled')
    ON CONFLICT (user_id, study_id) DO NOTHING;
  END IF;

  -- ── PROPOJENÍ BUDOUCÍ IDENTITY S ENTITOU (2026-09-10) ─────────────────────
  --
  -- ⭐ ZADÁNÍ MAJITELE, které určilo tvar: „pozvánka je propojení BUDOUCÍ
  -- identity s entitou v systému."
  --
  -- Z toho plyne všechno ostatní. Pozvánka je ZÁMĚR vyslovený dopředu, ne fakt:
  -- v okamžiku jejího vystavení ten účet ještě neexistuje. Uplatnění dodá
  -- KANDIDÁTA („tenhle účet přišel s tím kódem"), ne důkaz totožnosti — kód je
  -- přenositelný a `claim_invitation` adresáta nekontroluje.
  --
  -- ⭐ AUTORIZACI PŘEDPŘIPRAVIL ODESÍLATEL (majitel): „přijetí pozvánky
  -- a přihlášení — autorizace uživatele je další krok, ale už schválený, resp.
  -- předpřipravený tím, kdo tu pozvánku posílá."
  --
  -- Otázka při uplatnění tedy NENÍ „smí ten člověk dovnitř?" — to už správce
  -- rozhodl. Je to „JE TO ON?". A právě tam byla díra: pozvánka nemusela být
  -- ADRESOVANÁ, takže se jí prokázal kdokoli, kdo získal kód.
  --
  -- Proto dvě větve, které se liší jen tím, jestli je komu to platí:
  --
  --   ADRESOVANÁ (má `email` a sedí s účtem)  → `confirmed`
  --       Předpřipravená autorizace platí pro TOHO adresáta a ten se přihlásil.
  --       Potvrzujícím zůstává SPRÁVCE (`confirmed_by = created_by`), ne ten,
  --       kdo pozvánku uplatnil — rozhodl přece on.
  --
  --   NEADRESOVANÁ (kód předaný jinak)        → `proposed`
  --       Není koho ověřit, takže předpřipravená autorizace nemá nositele.
  --       Ratifikuje člověk v review lane, která běží.
  --
  -- ⭐ SPOR JE VIDĚT: dva kandidáti na jednu entitu vyrobí dva návrhy vedle
  -- sebe. Dřív by druhý tiše prošel — a „vidím víc" nikdo nenahlásí.
  --
  -- Neúspěch NESHODÍ uplatnění: člověk musí dostat účet i roli, i když je
  -- s vazbou spor — ten rozsekne správce. Twin zůstane v `twin_accounts_missing`.
  IF v_invitation.twin_id IS NOT NULL THEN
    BEGIN
      -- Adresovaná = pozvánka nese e-mail A účet, který ji uplatňuje, ho má.
      -- Porovnává se bez ohledu na velikost písmen a okolní mezery; e-mail je
      -- case-insensitive a opsaný ručně bývá s mezerou.
      SELECT lower(btrim(v_invitation.email)) IS NOT NULL
             AND lower(btrim(v_invitation.email)) = lower(btrim(pr.email))
        INTO v_adresovana
        FROM public.profiles pr
       WHERE pr.user_id = v_user_id
       LIMIT 1;
      v_adresovana := COALESCE(v_adresovana, false);

      INSERT INTO public.twin_external_refs (
        twin_id, source, source_key, ref_kind, state, proposed_by, confidence,
        confirmed_by, confirmed_at, note
      ) VALUES (
        v_invitation.twin_id, 'aisha_auth', v_user_id::text, 'account',
        CASE WHEN v_adresovana THEN 'confirmed' ELSE 'proposed' END,
        'invitation:' || v_invitation.id::text, 1.0,
        CASE WHEN v_adresovana THEN v_invitation.created_by END,
        CASE WHEN v_adresovana THEN now() END,
        CASE WHEN v_adresovana
             THEN 'Adresovaná pozvánka uplatněna účtem se shodným e-mailem.'
             ELSE 'Pozvánka bez adresáta — čeká na ratifikaci člověkem.' END
      )
      ON CONFLICT DO NOTHING;
      v_twin_navrzeno := FOUND;
    EXCEPTION WHEN unique_violation THEN
      v_twin_navrzeno := false;
    END;
  END IF;

  -- Write audit
  PERFORM public.write_audit_journal(
      p_action_type := 'create'::journal_action_type,
      p_area := 'invitation'::journal_area,
      p_details := jsonb_build_object('code', v_invitation.code, 'role', v_invitation.role, 'study_id', v_invitation.study_id, 'twin_id', v_invitation.twin_id, 'twin_navrzeno', v_twin_navrzeno),
      p_entity_id := 'Invitation claimed',
      p_entity_type := 'invitation_claim',
      p_severity := NULL,
      p_summary := v_invitation.id::text,
    p_user_id := v_user_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'invitation_id', v_invitation.id,
    'role', v_invitation.role,
    'study_id', v_invitation.study_id,
    -- ⛔ `twin_navrzeno` NENÍ „máš přístup". Vazba čeká na potvrzení člověkem;
    -- do té doby `my_twins` neobsahuje nic a uživatel svoje věci NEVIDÍ. Kdyby
    -- se tenhle údaj četl jako hotovo, vzniklo by UI, které slibuje přístup,
    -- jenž ještě neplatí.
    'twin_id', v_invitation.twin_id,
    'twin_navrzeno', v_twin_navrzeno,
    'twin_potvrzeno', v_adresovana,
    'prefill_first_name', v_invitation.prefill_first_name,
    'prefill_last_name', v_invitation.prefill_last_name,
    'prefill_phone', v_invitation.prefill_phone,
    'prefill_notes', v_invitation.prefill_notes
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.claim_invitation(p_code text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_invitation(p_code text) TO authenticated;
