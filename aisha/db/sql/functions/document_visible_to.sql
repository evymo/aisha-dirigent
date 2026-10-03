-- ============================================================================
-- Source of Truth: document_visible_to
-- Popis: JEDINÝ vlastník pravidla „smí tazatel vidět tento doklad?". Skládá
--        existující mašinerii, nic nového nevynalézá:
--          1. kanonická třída dokladu: document_registry.sensitivity
--             (promotion přes register_source_document_audited přiděluje třídu)
--          2. úroveň tazatele: audience_user_meets_tier_requirement — SPOČTENÁ
--             z dění, fail-closed (NULL uživatel = anonymous)
--          3. převod třída→úroveň: document_sensitivity_min_tier
--        NEPROMOVANÝ doklad (bez řádku v document_registry) je viditelný jen
--        adminovi/service — tím se enforcementem stává promotion šev: raw lane
--        se členům neukazuje, dokud doklad nedostane kanonickou identitu a třídu.
--
-- Použití: RLS policy li_source_registry_member_tier_select (INVOKER čtenáři
--        register/detail/digest ji dědí beze změny kódu) + download RPC.
--        Rozšíření o strukturální scope (vztah dvojčat) se zapne TADY — žádné
--        inline kopie (lekce z P0 #824).
--
-- ŠEV MEZI VRSTVAMI = `source_sha256` (obsahová identita dokladu), NIKOLI
--        `source_id`: document_registry.source_id je FK na agent_knowledge_sources
--        (tj. DATOVÝ ZDROJ, ze kterého doklad přišel), zatímco totožnost doklad↔
--        doklad nese content hash. Obě vrstvy ho mají (li_source_registry
--        UNIQUE(source_sha256), document_registry UNIQUE(source_id, sha)).
--        Spojení přes source_id by nikdy nesedlo a všechno by tiše zůstalo
--        neviditelné — ověřeno testem na čisté DB.
--
-- Argument je proto sha, ne id: predikát nezávisí na tom, ze které lane se ptáme.
--
-- Bezpečnost: SECURITY DEFINER (policy běží jako tazatel, ale lookup do
--        document_registry nesmí podléhat jeho RLS — jinak by se pravidlo
--        nikdy nevyhodnotilo). STABLE, bez zápisů.
-- Pozn. výkon: volá se per řádek; tier compute je uvnitř audience mašinerie.
--        Pro dnešní objemy (stovky dokladů) v pořádku; při růstu kešovat tier
--        per statement.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.document_visible_to(p_uid uuid, p_source_sha256 text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_sensitivity text;
BEGIN
  -- Oracle guard (týž vzor jako workflow_step_visible_to): přihlášený volající
  -- smí vyhodnocovat JEN SVOJI viditelnost; service_role/admin za kohokoliv.
  -- Bez něj by predikát prozrazoval úroveň cizích účtů.
  IF NOT (p_uid IS NOT DISTINCT FROM auth.uid()
          OR public.is_service_role()
          OR public.is_admin_or_staff()) THEN
    RETURN false;
  END IF;

  SELECT dr.sensitivity INTO v_sensitivity
  FROM public.document_registry dr
  WHERE dr.source_sha256 = p_source_sha256
    AND dr.superseded_by IS NULL
  ORDER BY dr.version DESC
  LIMIT 1;

  IF v_sensitivity IS NULL THEN
    RETURN false;  -- nepromovaný doklad: jen admin/service (ti jdou mimo predikát)
  END IF;

  -- 2-arg forma (tier-ACL): (požadovaná úroveň, uživatel) — pořadí dle SoT.
  RETURN public.audience_user_meets_tier_requirement(
    public.document_sensitivity_min_tier(v_sensitivity),
    p_uid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.document_visible_to(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.document_visible_to(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.document_visible_to(uuid, text) TO service_role;
