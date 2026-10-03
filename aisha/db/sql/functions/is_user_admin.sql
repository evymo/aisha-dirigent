-- ============================================================================
-- Source of Truth: is_user_admin
-- Popis: Helper RPC volaný z n8n webhook handlerů (action button targets) pro
--        ověření admin role. Mapuje na is_admin_or_staff ale s explicitním
--        admin-only check (NEberou v potaz staff).
-- Volá: n8n action handlers (drift-now, force B/G switch, manual rollback, ...)
-- Auth: any authenticated (returns boolean, no exception throw)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_user_admin(
  p_user_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  -- ⛔ PREDIKÁT O TŘETÍ OSOBĚ JE ORÁKULUM (naměřeno 2026-09-19). S pořadím
  -- COALESCE s parametrem na prvním místě vyhrál parametr, takže kterýkoli přihlášený
  -- se pro libovolné uuid dozvěděl, zda je to administrátor — tatáž třída jako
  -- has_role. Oprava je fáze 2 z brány security-hardened-helpers: JWT vyhrává.
  -- Přihlášený se ptá vždy za sebe; parametr platí jen tam, kde JWT identitu
  -- nenese (service klíč n8n handlerů). Změřeno, že to nic nerozbije: všechna
  -- volání v repu (aisha_publish/deprecate_static_defense_rule, lock_tooling_proposal)
  -- jsou bez argumentu, tedy za sebe. Anon právo nemá — kdyby ho dostal,
  -- auth-first by ho NEchránil; hlídá to brána definer-subjekt-jen-volajici.
  v_user_id := COALESCE(auth.uid(), p_user_id);

  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = v_user_id
      AND role = 'admin'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_user_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_user_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_user_admin(uuid) TO service_role;
