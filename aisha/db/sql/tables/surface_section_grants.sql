-- =============================================================================
-- surface_section_grants — do které sekce extranetu smí KONKRÉTNÍ uživatel.
--
-- ⭐ ROZHODNUTÍ MAJITELE 2026-09-28: „přístup k datům z podstaty úhlu pohledu je
-- jedna věc, přístup do sekce extranetu je další úroveň. Stačilo by každou sekci
-- extranetu u uživatele v administraci nastavovat — a tam pak vidí jen data, na
-- která má nárok." Proto udělení u uživatele, ne role: role je pevný výčet stacku
-- a jméno sekce je slovník instance.
--
-- Vyhodnocuje ho JEDINÝ interpret publika (surface_audience_allows, osa
-- `"udeleni": "<sekce>"`): řádek umístění s touhle osou uvidí správa (bypass)
-- nebo uživatel s udělením. Data v sekci dál řídí nárok (RLS) — udělení otevírá
-- dveře, ne data.
--
-- Zápis jen přes surface_udel_admin (auditované); čtení přes interpret a
-- surface_udeleni_admin. RLS bez politik, žádné granty pro anon/authenticated.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.surface_section_grants (
  user_id     uuid        NOT NULL REFERENCES aisha_auth.users (id) ON DELETE CASCADE,
  surface     text        NOT NULL CHECK (surface ~ '^[a-z][a-z0-9_]*$'),
  granted_by  uuid,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT surface_section_grants_pkey PRIMARY KEY (user_id, surface)
);

COMMENT ON TABLE public.surface_section_grants IS
  'Udělení sekce extranetu uživateli (osa publika "udeleni"). Otevírá sekci, data dál řídí nárok. Zápis jen surface_udel_admin.';

ALTER TABLE public.surface_section_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.surface_section_grants FROM PUBLIC, anon, authenticated;
