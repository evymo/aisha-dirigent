-- Function: public.handle_new_user
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:50+01:00

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Insert member role for new user
  -- Use NULL for granted_by since user doesn't fully exist yet during trigger
  --
  -- ⛔ VÝJIMKA: ÚČET ZAŘÍZENÍ (tablet, F2 2026-09-29) roli `member` NEDOSTANE — tablet není
  -- člověk a role by mu otevřela všechno, co vidí člen. Pozná se JEN podle vazby na
  -- straně serveru (knock_device_credentials.ucet_id), kterou zaloz_ucet_zarizeni_interni
  -- zapíše DŘÍV, než uživatele vloží. Nikdy podle raw_user_meta_data — ta jde nastavit
  -- běžnou registrací (revize Aisha Guru 29. 9.; brána ucet-zarizeni-bez-role).
  IF NOT EXISTS (SELECT 1 FROM public.knock_device_credentials d WHERE d.ucet_id = NEW.id) THEN
    INSERT INTO public.user_roles (user_id, role, granted_by, granted_at)
    VALUES (NEW.id, 'member'::app_role, NULL, NOW())
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  
  -- Create profile record if not exists.
  --
  -- ⛔ NAMĚŘENO 2026-09-06: tenhle INSERT zakládal profil JEN s identifikátory,
  -- takže e-mail ani jméno z účtu se do profilu nikdy nedostaly. V produkci pak
  -- 7 účtů ze 7 mělo prázdný `email` i `display_name` — a protože registr
  -- publika i popisek dvojčete čtou právě je (`twin_backfill_accounts_admin`
  -- staví label jako COALESCE(display_name, email)), byla CELÁ plocha bezejmenná:
  -- sedm řádků, u kterých nešlo poznat, kdo to je. Jedna příčina, tři příznaky.
  --
  -- Jméno se bere z metadat účtu tolerantně: různí poskytovatelé identity ho
  -- posílají pod různým klíčem (`display_name` seed, `name`/`preferred_username`
  -- Keycloak). Chybí-li úplně, zůstane NULL a pohled degraduje na e-mail —
  -- prázdný řádek nevznikne ani tak.
  INSERT INTO public.profiles (id, user_id, email, display_name)
  VALUES (
    NEW.id,
    NEW.id,
    nullif(btrim(coalesce(NEW.email, '')), ''),
    nullif(btrim(coalesce(
      NEW.raw_user_meta_data->>'display_name',
      NEW.raw_user_meta_data->>'name',
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'preferred_username',
      '')), '')
  )
  ON CONFLICT (id) DO NOTHING;
  
  RETURN NEW;
END;
$function$
;

-- Trigger function: REVOKE to prevent direct invocation
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
