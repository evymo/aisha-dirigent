-- ==============================================================================
-- Syntetický autor demo vrstvy — jen CI a lokální vývoj (profil demo)
-- ==============================================================================
-- Expertní pravidla v demo/02 (a v core/38–40 při opakovaném seedu) vyžadují
-- autora: expert_rules.author_partner_id je NOT NULL a bere se
-- `SELECT id FROM partner_profiles LIMIT 1`. Dřív ho dodával demo/00_prod_users.sql,
-- který odešel spolu s ostatními projektovými daty (rozhodnutí majitele
-- 2026-09-24: v centrálním repu žádná data žádného projektu).
--
-- Rozhodnutí majitele: autor je SYNTETICKÝ a žije jen v demo vrstvě — produkce
-- ani forky ho nedostanou (profil instance demo vrstvu nekompiluje, hlídá
-- demo-seed-nesmi-do-produkce).
--
-- Vyhrazená deterministická id (tvar RFC 4122 v4, blok 0de0 — „demo"):
--   uživatel 00000000-0000-4000-a000-000000000de0
--   partner  00000000-0000-4000-b000-000000000de0
-- Neviditelný v adresáři, nepřijímá klienty, přihlásit se nedá (bez hesla).
-- Je CERTIFIKOVANÝ: runtime testy partnerských funkcí (marketplace agentů,
-- rezervace, publikace pravidel) potřebují certifikovaného partnera a dřív ho
-- braly z odebraných demo dat. Pořád jen demo vrstva — produkce ho nedostane.
-- Idempotentní: ON CONFLICT drží hodnoty čerstvé při opakovaném seedu.
-- ==============================================================================

INSERT INTO aisha_auth.users (id, email, raw_user_meta_data, created_at, updated_at)
VALUES (
  '00000000-0000-4000-a000-000000000de0',
  'demo-autor@example.com',
  '{"display_name": "Demo autor", "synthetic": true}'::jsonb,
  now(), now()
)
ON CONFLICT (id) DO UPDATE SET
  raw_user_meta_data = EXCLUDED.raw_user_meta_data,
  updated_at = now();

-- Tvar skutečného partnerského účtu: profil + role member a partner. Runtime
-- cesty partnera (marketplace, route_task) čtou roli volajícího.
INSERT INTO public.profiles (user_id, display_name, preferred_language, created_at, updated_at)
VALUES ('00000000-0000-4000-a000-000000000de0', 'Demo autor', 'cs', now(), now())
ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now();

INSERT INTO public.user_roles (user_id, role, granted_by, granted_at)
VALUES
  ('00000000-0000-4000-a000-000000000de0', 'member', NULL, now()),
  ('00000000-0000-4000-a000-000000000de0', 'partner', NULL, now())
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO partner_profiles (
  id, user_id, display_name, business_name, description, city, country,
  is_visible, is_accepting_clients, accepts_online_appointments,
  accepts_in_person_appointments, services, languages,
  certification_level, certification_passed_at
)
VALUES (
  '00000000-0000-4000-b000-000000000de0',
  '00000000-0000-4000-a000-000000000de0',
  'Demo autor',
  'Demo autor',
  'Syntetický autor expertních pravidel pro CI a lokální vývoj. Není to specialista ani účet k přihlášení.',
  'demo',
  'CZ',
  false,
  false,
  false,
  false,
  ARRAY['demo'],
  ARRAY['cs', 'en'],
  'certified_partner',
  '2026-01-01 00:00:00+00'
)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description  = EXCLUDED.description,
  is_visible   = EXCLUDED.is_visible,
  is_accepting_clients = EXCLUDED.is_accepting_clients,
  certification_level = EXCLUDED.certification_level,
  certification_passed_at = EXCLUDED.certification_passed_at,
  updated_at   = now();
