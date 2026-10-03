-- Function: current_device_kid
-- `kid` tabletu, jehož relací volající právě jedná — z claimu `device_kid` tokenu,
-- který vydává gateway (/auth/v1/device/session). Claim se NEBERE na slovo: platí jen,
-- když průkaz s tím kid patří účtu volajícího a je platný. Jinak NULL (člověk, nebo
-- podvržený claim). Zapisuje se do záznamu příběhu a auditu odbavení („na kterém
-- tabletu k předání došlo“).
CREATE OR REPLACE FUNCTION public.current_device_kid()
  RETURNS text
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_kid text;
BEGIN
  BEGIN
    v_kid := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'device_kid';
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  IF v_kid IS NULL OR auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN (SELECT d.kid FROM public.knock_device_credentials d
           WHERE d.kid = v_kid
             AND d.ucet_id = auth.uid()
             AND d.druh = 'tablet'
             AND d.approved_at IS NOT NULL
             AND d.revoked_at IS NULL
             AND (d.plati_do IS NULL OR d.plati_do > now()));
END;
$function$;

REVOKE ALL ON FUNCTION public.current_device_kid() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_device_kid() TO authenticated, service_role;
