-- Function: public.register_knock_device
-- Arguments: p_kid text, p_public_key_hex text, p_scope text, p_push_device_id text
-- Security: SECURITY DEFINER, jen `authenticated`; NIC NESCHVALUJE.
--
-- Zařízení se ohlásí SAMO, jakmile je uživatel přihlášený.
--
-- ⭐ PROČ TO NEMUSÍ NIKDO POSÍLAT (majitel, 2026-09-09): „posílat otisk správci
-- je hovadina, ten se má stát součástí zaklepání a administrátor ho dostane
-- a může ho schválit, aniž by mu uživatel aplikace musel něco posílat."
-- Kořen důvěry je ruční zaklepání člověkem: teprve otevřenými dveřmi se dá
-- přihlásit, a přihlášení nese identitu. Otisk tedy dorazí spolu s ní.
--
-- ⛔ TAHLE FUNKCE NESMÍ NIKDY NIC SCHVÁLIT. Kdyby uměla nastavit `approved_at`,
-- stačilo by se přihlásit a zařízení by si otevřelo dveře samo — schvalování
-- v administraci by bylo jen ozdoba. Schválení má vlastní RPC pro správce.
--
-- ⛔ CIZÍ PRŮKAZ SE NEPŘEPÍŠE. `kid` je odvozený z veřejného klíče, takže kdo
-- klíč nemá, nemá jak platný `kid` vyrobit — ale kdyby přesto poslal cizí
-- `kid` s vlastním klíčem, CHECK na tabulce to zamítne a `WHERE` níž taky:
-- existující řádek se aktualizuje jen tehdy, sedí-li veřejný klíč.

CREATE OR REPLACE FUNCTION public.register_knock_device(
  p_kid text,
  p_public_key_hex text,
  p_scope text,
  p_push_device_id text DEFAULT NULL::text
)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Tvar se ověřuje i tady, ne jen CHECKem: hlášení „porušen constraint" je
  -- pro appku nečitelné a schoval by se v něm rozdíl mezi překlepem a útokem.
  IF p_public_key_hex !~ '^04[0-9a-f]{128}$' THEN
    RAISE EXCEPTION 'public_key_hex musí být SEC1 nekomprimovaný bod (04 || X || Y, 65 B)';
  END IF;
  IF p_kid IS DISTINCT FROM 'dev-' || substring(p_public_key_hex from 3 for 16) THEN
    RAISE EXCEPTION 'kid neodpovídá klíči — otisk se odvozuje z klíče, nevymýšlí se';
  END IF;
  IF p_scope IS NULL OR length(p_scope) = 0 THEN
    RAISE EXCEPTION 'scope je povinný — prázdný by u vrátného znamenal rámec, který nikdy neprojde';
  END IF;

  -- ⛔ STARÝ PRŮKAZ TÉHOŽ TELEFONU SE ODVOLÁ. Nový `kid` na známém
  -- `push_device_id` znamená, že člověk zařízení zapomněl a zavedl znovu —
  -- soukromý klíč k předchozímu už NEEXISTUJE. Nechat ho schválený by byl
  -- záznam v rosteru, kterým nikdo nikdy nezaťuká, a nikdo by nevěděl proč.
  IF p_push_device_id IS NOT NULL THEN
    UPDATE public.knock_device_credentials
       SET revoked_at = now(), updated_at = now()
     WHERE push_device_id = p_push_device_id
       AND kid <> p_kid
       AND revoked_at IS NULL
       -- ⛔ JEN VLASTNÍ PRŮKAZY (2026-09-28). Bez téhle podmínky mohl kdokoli
       --    přihlášený, kdo zná cizí push id, odvolat cizí průkaz — a tablet
       --    (druh 'tablet', bez vlastníka) by šel odvolat úplně komukoli.
       AND owner_user_id = v_uid;
  END IF;

  INSERT INTO public.knock_device_credentials (
    kid, public_key_hex, scope, owner_user_id, push_device_id, first_seen_at, last_seen_at
  ) VALUES (
    p_kid, p_public_key_hex, p_scope, v_uid, p_push_device_id, now(), now()
  )
  ON CONFLICT (kid) DO UPDATE SET
    -- `owner_user_id` se NEPŘEPISUJE: majitel je ten, kdo zařízení zavedl.
    -- Kdo ho používá, se čte z `mobile_sessions` přes `push_device_id`.
    scope = EXCLUDED.scope,
    push_device_id = COALESCE(EXCLUDED.push_device_id, knock_device_credentials.push_device_id),
    last_seen_at = now(),
    updated_at = now()
  WHERE knock_device_credentials.public_key_hex = EXCLUDED.public_key_hex;

  RETURN p_kid;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.register_knock_device(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_knock_device(text, text, text, text) TO authenticated;
