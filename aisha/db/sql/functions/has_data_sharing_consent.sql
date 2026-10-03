-- Function: public.has_data_sharing_consent
-- Arguments: p_user_id uuid, p_accessor_user_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:51+01:00

CREATE OR REPLACE FUNCTION public.has_data_sharing_consent(p_user_id uuid, p_accessor_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_has_consent boolean;
  v_uid uuid := auth.uid();
BEGIN
  -- ⛔ PREDIKÁT O TŘETÍ OSOBĚ JE ORÁKULUM (naměřeno 2026-09-19). Kterýkoli
  -- přihlášený uměl přes `/rpc/has_data_sharing_consent` zjistit, zda člen X
  -- sdílí zdravotní data s partnerem Y — tedy kdo je čím klientem, pro libovolnou
  -- dvojici uuid. A protože se níž zapisuje audit s `user_id = p_accessor_user_id`,
  -- každý takový dotaz navíc PODVRHL záznam „partner Y ověřoval přístup ke členu X"
  -- pod cizím jménem.
  --
  -- Ptát se smí jen ten, kdo přistupuje (accessor = volající); služba a správa
  -- na kohokoli. Změřeno, že to nic nerozbije: všech 13 politik předává jako
  -- accessor `auth.uid()` a všech 24 volání z definer funkcí proměnnou naplněnou
  -- z `auth.uid()` (řádek dat je vždy `p_user_id`, nikdy accessor). `false` bez
  -- auditního zápisu: zamítnutý dotaz nic nečetl a predikát v RLS má vracet deny,
  -- ne shodit dotaz.
  --
  -- Pořadí je záměrné: „ptám se za sebe" se ověří první (levně, per řádek v RLS)
  -- a role až potom. `IS DISTINCT FROM` + `v_uid IS NULL` drží stráž NULL-bezpečnou —
  -- prosté `<>` by pro anonyma dalo NULL a IF by stráž tiše přeskočil.
  IF v_uid IS NULL OR p_accessor_user_id IS DISTINCT FROM v_uid THEN
    IF NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
      RETURN false;
    END IF;
  END IF;

  -- Check if consent exists
  SELECT EXISTS (
    SELECT 1
    FROM data_sharing_consents dsc
    JOIN partner_profiles pp ON pp.id = dsc.partner_id
    WHERE dsc.user_id = p_user_id
      AND pp.user_id = p_accessor_user_id
      AND dsc.revoked_at IS NULL
      AND (dsc.expires_at IS NULL OR dsc.expires_at > now())
  ) INTO v_has_consent;

  -- Audit log for consent check (sensitive data access verification)
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    p_accessor_user_id,
    'has_data_sharing_consent',
    jsonb_build_object(
      'area', 'phi',
      'severity', 'info',
      'entity_type', 'data_sharing_consents',
      'target_user_id', p_user_id,
      'result', v_has_consent
    )
  );

  RETURN v_has_consent;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.has_data_sharing_consent(p_user_id uuid, p_accessor_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_data_sharing_consent(p_user_id uuid, p_accessor_user_id uuid) TO authenticated;
