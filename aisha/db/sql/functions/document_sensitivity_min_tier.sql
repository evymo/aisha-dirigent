-- ============================================================================
-- Source of Truth: document_sensitivity_min_tier
-- Popis: Mapování třídy dokumentu (document_registry.sensitivity) na MINIMÁLNÍ
--        úroveň tazatele v existujícím audience žebříku
--        (anonymous < registered < active < qualified < partner < admin).
--        Doktrína: úroveň se POČÍTÁ z dění (audience_compute_actor_tier),
--        nepřiděluje se; tenhle převod je jediné místo, kde se třída dokumentu
--        potkává s žebříkem. Vyhodnocení dělá audience_user_meets_tier_requirement
--        (fail-closed: neznámý uživatel = anonymous).
-- Fail-closed: neznámá/NULL třída → 'admin' (nepromovaný nebo neznámý dokument
--        nesmí být viditelný nikomu pod adminem).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.document_sensitivity_min_tier(p_sensitivity text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_sensitivity
    WHEN 'public'       THEN 'registered'   -- každý přihlášený vázaný účet
    WHEN 'internal'     THEN 'active'       -- spočtená aktivita, ne jmenovka
    WHEN 'restricted'   THEN 'qualified'
    WHEN 'confidential' THEN 'admin'
    ELSE 'admin'                            -- fail-closed (NULL / neznámá třída)
  END;
$$;

REVOKE ALL ON FUNCTION public.document_sensitivity_min_tier(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.document_sensitivity_min_tier(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.document_sensitivity_min_tier(text) TO service_role;
