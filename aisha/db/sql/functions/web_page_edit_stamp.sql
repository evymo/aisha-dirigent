-- Function: public.web_page_edit_stamp
-- Description: Razítko stavu, který editor stránky upravuje: novější z času
--              živé stránky a jejího konceptu. Klient ho posílá zpět při
--              uložení (p_expected_stamp); nesedí-li, uložení skončí 409 —
--              dva editoři naráz se nepřepíšou potichu.
-- Security: SECURITY DEFINER; admin/staff NEBO service_role.
-- Created: 2026-10-02 (zrcadlí news_article_edit_stamp)

CREATE OR REPLACE FUNCTION public.web_page_edit_stamp(p_page_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (public.is_admin_or_staff() OR public.is_service_role()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN (
    SELECT GREATEST(p.updated_at, COALESCE(d.updated_at, p.updated_at))
    FROM public.web_pages p
    LEFT JOIN public.web_page_versions d
      ON d.page_id = p.id AND d.kind = 'draft'
    WHERE p.id = p_page_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.web_page_edit_stamp(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.web_page_edit_stamp(uuid) TO authenticated, service_role;
