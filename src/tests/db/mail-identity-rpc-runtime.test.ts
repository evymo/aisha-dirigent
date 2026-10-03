/**
 * Mail Identity RPC Runtime — KC-rooted tier → parametric domain/quota
 *
 * get_mail_identity resolves a user's email identity from the Keycloak-rooted identity
 * already in the stack (NO parallel identity). The tier — and thus domain + quota — is
 * DERIVED, never self-assigned:
 *   admin   (user_roles 'admin' / admin-staff) → mail.domain.admin   / mail.quota.admin.mb
 *   partner (partner_profiles.is_certified)     → mail.domain.partner / mail.quota.partner.mb
 *   user    (everyone else)                     → mail.domain.user    / mail.quota.user.mb
 *
 * Domains + quotas are PARAMETRIC (system_config). This test seeds TEST domains (never
 * prod literals) inside a rolled-back transaction, so nothing leaks and the run is clean.
 * Runs against a real PostgreSQL; skips without one.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { psqlQuery, psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

const SIG = "public.get_mail_identity(uuid)";
const dbAvailable = isPgReachable();

beforeAll(async () => {
  await reportTestCapabilities("Mail Identity RPC Runtime");
});

describe("get_mail_identity — KC-rooted tier → parametric domain/quota", () => {
  it.skipIf(!dbAvailable)("grants: anon blocked, authenticated/service_role allowed", () => {
    const g = psqlQuery(
      `SELECT has_function_privilege('anon','${SIG}','EXECUTE') , ` +
        `has_function_privilege('authenticated','${SIG}','EXECUTE') , ` +
        `has_function_privilege('service_role','${SIG}','EXECUTE')`,
    );
    const [anon, auth, svc] = g.split("|");
    expect(anon).toBe("f");
    expect(auth).toBe("t");
    expect(svc).toBe("t");
  });

  it.skipIf(!dbAvailable)(
    "derives tier (user/partner/admin) from KC roles + partner cert; composes parametric address + quota; sanitises the local-part",
    () => {
      psqlMultiline(`
\\set ON_ERROR_STOP on
BEGIN;
-- Parametric tier config — TEST domains only (no prod literals), rolled back at the end.
INSERT INTO public.system_config (key, value, category, is_public) VALUES
  ('mail.domain.user',     '"users.test.local"'::jsonb,    'mail', true),
  ('mail.domain.partner',  '"partners.test.local"'::jsonb, 'mail', true),
  ('mail.domain.admin',    '"admin.test.local"'::jsonb,    'mail', true),
  ('mail.quota.user.mb',   '10'::jsonb,  'mail', true),
  ('mail.quota.partner.mb','100'::jsonb, 'mail', true),
  ('mail.quota.admin.mb',  '0'::jsonb,   'mail', true)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

DO $$
DECLARE
  v_u   uuid := gen_random_uuid();
  v_p   uuid := gen_random_uuid();
  v_a   uuid := gen_random_uuid();
  v_res jsonb;
BEGIN
  -- minimal KC-rooted users (auth schema) + profiles
  INSERT INTO aisha_auth.users (id, email)
  VALUES (v_u, 'mt-u-' || v_u || '@test.local'),
         (v_p, 'mt-p-' || v_p || '@test.local'),
         (v_a, 'mt-a-' || v_a || '@test.local');
  -- UPSERT, not INSERT: on_auth_user_created → handle_new_user() already created
  -- a profile row for each user above, so a plain INSERT hits
  -- profiles_user_id_key. The trigger is the CORRECT behaviour (restored to the
  -- baseline in #814); this fixture predates it and only surfaced now because CI
  -- runs test:run with no database, so src/tests/db/* never executes there.
  INSERT INTO public.profiles (user_id, nickname) VALUES (v_u, 'Alice K. Žluťoučký!!')  -- sanitise target
    ON CONFLICT (user_id) DO UPDATE SET nickname = EXCLUDED.nickname;
  INSERT INTO public.profiles (user_id, nickname) VALUES (v_p, 'partner_bob')
    ON CONFLICT (user_id) DO UPDATE SET nickname = EXCLUDED.nickname;
  INSERT INTO public.profiles (user_id, nickname) VALUES (v_a, 'root_admin')
    ON CONFLICT (user_id) DO UPDATE SET nickname = EXCLUDED.nickname;
  -- partner tier marker
  INSERT INTO public.partner_profiles (user_id, display_name, city, is_certified)
  VALUES (v_p, 'Test Partner', 'Praha', true);
  -- admin tier marker (KC role)
  INSERT INTO public.user_roles (user_id, role) VALUES (v_a, 'admin');

  PERFORM set_config('role', 'service_role', true);

  -- USER tier
  v_res := public.get_mail_identity(v_u);
  IF v_res->>'tier' <> 'user' THEN RAISE EXCEPTION 'user tier wrong: %', v_res->>'tier'; END IF;
  IF v_res->>'domain' <> 'users.test.local' THEN RAISE EXCEPTION 'user domain wrong: %', v_res->>'domain'; END IF;
  IF (v_res->>'quota_mb')::int <> 10 THEN RAISE EXCEPTION 'user quota wrong'; END IF;
  IF v_res->>'local_part' !~ '^[a-z0-9._-]+$' THEN RAISE EXCEPTION 'local-part not sanitised: %', v_res->>'local_part'; END IF;
  IF (v_res->>'address') <> ((v_res->>'local_part') || '@users.test.local') THEN RAISE EXCEPTION 'address composition wrong: %', v_res->>'address'; END IF;
  IF (v_res->>'configured')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'should be configured'; END IF;

  -- PARTNER tier
  v_res := public.get_mail_identity(v_p);
  IF v_res->>'tier' <> 'partner' THEN RAISE EXCEPTION 'partner tier wrong: %', v_res->>'tier'; END IF;
  IF v_res->>'domain' <> 'partners.test.local' THEN RAISE EXCEPTION 'partner domain wrong'; END IF;
  IF (v_res->>'quota_mb')::int <> 100 THEN RAISE EXCEPTION 'partner quota wrong'; END IF;

  -- ADMIN tier (unlimited)
  v_res := public.get_mail_identity(v_a);
  IF v_res->>'tier' <> 'admin' THEN RAISE EXCEPTION 'admin tier wrong: %', v_res->>'tier'; END IF;
  IF (v_res->>'unlimited')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'admin must be unlimited (quota 0)'; END IF;

  RAISE NOTICE 'get_mail_identity tier/domain/quota/sanitise assertions passed';
END $$;
ROLLBACK;
`);
      expect(true).toBe(true);
    },
  );

  it.skipIf(!dbAvailable)(
    "unconfigured tier (no system_config) yields a null address — parametric, never a hardcoded default",
    () => {
      // No mail.domain.* seeded in this transaction → address is null (must be configured per-instance).
      psqlMultiline(`
\\set ON_ERROR_STOP on
BEGIN;
DELETE FROM public.system_config WHERE key LIKE 'mail.domain.%';
DO $$
DECLARE v_res jsonb;
BEGIN
  PERFORM set_config('role', 'service_role', true);
  v_res := public.get_mail_identity(gen_random_uuid());
  IF v_res->>'tier' <> 'user' THEN RAISE EXCEPTION 'default tier should be user'; END IF;
  IF (v_res->>'configured')::boolean THEN RAISE EXCEPTION 'must be NOT configured without a domain'; END IF;
  IF v_res->>'address' IS NOT NULL THEN RAISE EXCEPTION 'address must be null when unconfigured'; END IF;
END $$;
ROLLBACK;
`);
      expect(true).toBe(true);
    },
  );
});
