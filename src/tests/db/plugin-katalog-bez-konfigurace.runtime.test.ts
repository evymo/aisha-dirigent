/**
 * Katalog pluginů nesmí vydat konfiguraci pluginu — ani anonymovi, ani nikomu.
 *
 * ⛔ NAMĚŘENO 2026-09-12 (rozbor forku automotive, potvrzeno nad origin/main
 * 2026-09-15): `get_available_plugins` je SECURITY DEFINER s GRANT pro `anon`
 * a projektoval `plugin_tenant_overrides.config_override` jako `config`.
 * V té konfiguraci žijí přihlašovací údaje konektorů (tokeny, hesla, API klíče
 * dodavatelů). Stačil anon klíč a `p_tenant_id` — DEFINER vypíná RLS, takže
 * politika tabulky (`tenant_id = auth.uid() OR is_admin_or_staff()`) se
 * neuplatnila a tělo funkce se na nárok neptalo.
 *
 * ⭐ PROČ „NIKOMU", NE „JEN SLUŽBĚ". Katalog volá i broker sandboxu
 * (`/sandbox/rpc` → `rpcSandboxed` → service_role) s parametry, které si zvolí
 * PLUGIN — a šablona scaffoldu dává pluginu `rpc.get_available_plugins` jako
 * výchozí schopnost. Konfigurace podmíněná rolí `service_role` by tak dál
 * patřila každému pluginu, jehož instance katalog povolí. Katalog proto nese
 * jen to, co katalog potřebuje (identitu, artefakt, stav); konfigurace má svůj
 * domov v tabulce pod RLS.
 *
 * ⛔ KONTROLNÍ VZOREK JE POVINNÝ. „Tajemství ve výstupu není" projde i nad
 * prázdnou databází nebo když funkce spadne. Každý negativní případ proto stojí
 * vedle tvrzení, že (a) fixtura s tajemstvím v DB je a oprávněný ji vidí,
 * (b) katalog tentýž plugin TÉŽE identitě opravdu vrací.
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const RUN = randomUUID().slice(0, 8);
const TAJEMSTVI = `sonda-tajemstvi-${RUN}`;
const TENANT = randomUUID();
const CIZI = randomUUID();
const ADMIN = randomUUID();
const PLUGIN = randomUUID();
const VYPNUTY = randomUUID();
const SLUG = `zz-katalog-sonda-${RUN}`;
const SLUG_VYPNUTY = `zz-katalog-vypnuty-${RUN}`;

type Identita =
  | { kind: "anon" }
  | { kind: "authenticated"; uid: string }
  | { kind: "service_role" };

/** Spojení je superuser — `SET ROLE` + claims, aby platila skutečná práva identity. */
function psql(identita: Identita, sql: string): string {
  const claims =
    identita.kind === "authenticated"
      ? `{"sub":"${identita.uid}","role":"authenticated"}`
      : `{"role":"${identita.kind}"}`;
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    {
      input: `\\o /dev/null\nSET request.jwt.claims = '${claims}';\nSET ROLE ${identita.kind};\n\\o\n${sql};`,
      encoding: "utf-8",
      env: { ...process.env, PGPASSWORD: PG_PASSWORD },
      stdio: ["pipe", "pipe", "pipe"],
    },
  ).trim();
}

/** Fixtury a úklid — superuser bez SET ROLE. */
function superuser(sql: string): string {
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA", "-c", sql],
    { encoding: "utf-8", env: { ...process.env, PGPASSWORD: PG_PASSWORD } },
  ).trim();
}

/** Výsledek volání: výstup, nebo text chyby (aby šlo měřit i odmítnutí). */
function zavolej(identita: Identita, volani: string): { ok: boolean; vystup: string } {
  try {
    return { ok: true, vystup: psql(identita, `SELECT public.${volani}::text`) };
  } catch (err) {
    const e = err as { stderr?: string | Buffer; message?: string };
    return { ok: false, vystup: String(e.stderr ?? e.message ?? err) };
  }
}

const ANON: Identita = { kind: "anon" };
const SLUZBA: Identita = { kind: "service_role" };
const tenant: Identita = { kind: "authenticated", uid: TENANT };
const cizi: Identita = { kind: "authenticated", uid: CIZI };
const admin: Identita = { kind: "authenticated", uid: ADMIN };

describe.skipIf(!isPgReachable())("get_available_plugins: katalog bez konfigurace pluginu", () => {
  beforeAll(() => {
    superuser(`INSERT INTO aisha_auth.users (id,email) VALUES
                 ('${TENANT}','katalog-tenant-${RUN}@test.local'),
                 ('${CIZI}','katalog-cizi-${RUN}@test.local'),
                 ('${ADMIN}','katalog-admin-${RUN}@test.local')
               ON CONFLICT (id) DO NOTHING`);
    superuser(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}','admin') ON CONFLICT DO NOTHING`);
    superuser(`INSERT INTO public.plugin_catalog (id, slug, name, kind, trust_tier, status, capabilities) VALUES
                 ('${PLUGIN}','${SLUG}','Sonda katalogu','agent','partner','ga','[]'::jsonb),
                 ('${VYPNUTY}','${SLUG_VYPNUTY}','Sonda vypnutého','agent','partner','ga','[]'::jsonb)`);
    superuser(`INSERT INTO public.plugin_versions (plugin_id, version, artifact_sha256, artifact_url) VALUES
                 ('${PLUGIN}','1.0.0','sha-${RUN}','http://artefakty.test/${SLUG}.js'),
                 ('${VYPNUTY}','1.0.0','sha2-${RUN}','http://artefakty.test/${SLUG_VYPNUTY}.js')`);
    superuser(`INSERT INTO public.plugin_tenant_overrides (plugin_id, tenant_id, enabled, config_override) VALUES
                 ('${PLUGIN}','${TENANT}', true, '{"apiToken":"${TAJEMSTVI}","endpoint":"https://dodavatel.test"}'::jsonb),
                 ('${VYPNUTY}','${TENANT}', false, '{"password":"${TAJEMSTVI}"}'::jsonb)`);
  });

  afterAll(() => {
    superuser(`DELETE FROM public.plugin_catalog WHERE id IN ('${PLUGIN}','${VYPNUTY}')`);
    superuser(`DELETE FROM public.user_roles WHERE user_id = '${ADMIN}'`);
    superuser(`DELETE FROM aisha_auth.users WHERE id IN ('${TENANT}','${CIZI}','${ADMIN}')`);
  });

  it("kontrolní vzorek: tajemství v DB je a oprávnění ho ve svém domově (tabulka pod RLS) vidí", () => {
    const sql = `SELECT count(*) FROM public.plugin_tenant_overrides
                  WHERE plugin_id = '${PLUGIN}' AND config_override->>'apiToken' = '${TAJEMSTVI}'`;
    expect(psql(tenant, sql), "tenant nevidí vlastní konfiguraci — sonda je slepá").toBe("1");
    expect(psql(admin, sql), "admin nevidí konfiguraci tenanta — sonda je slepá").toBe("1");
    expect(psql(SLUZBA, sql), "služba nevidí konfiguraci — sonda je slepá").toBe("1");
    // A cizí přihlášený ji ani v tabulce nevidí — tohle je nárok, který RPC musí držet taky.
    expect(psql(cizi, sql)).toBe("0");
  });

  it("⛔ anon: katalog vrací plugin, ale bez konfigurace", () => {
    const r = zavolej(ANON, "get_available_plugins(NULL, NULL)");
    expect(r.ok, r.vystup).toBe(true);
    expect(r.vystup, "anon nevidí ani fixturní plugin — sonda je slepá").toContain(SLUG);
    expect(r.vystup).not.toContain(TAJEMSTVI);
    expect(r.vystup).not.toContain('"config"');
  });

  it("⛔ anon s cizím p_tenant_id nedostane konfiguraci tenanta", () => {
    const r = zavolej(ANON, `get_available_plugins(NULL, '${TENANT}')`);
    expect(r.vystup, "anon dostal přihlašovací údaje tenanta").not.toContain(TAJEMSTVI);
  });

  it("⛔ anon s p_tenant_id je odmítnut (DEFINER nesmí obejít RLS overrides)", () => {
    const r = zavolej(ANON, `get_available_plugins(NULL, '${TENANT}')`);
    expect(r.ok, `anon se dozvěděl stav overrides cizího tenanta: ${r.vystup}`).toBe(false);
    expect(r.vystup).toMatch(/Unauthorized|42501/);
  });

  it("⛔ přihlášený bez nároku s cizím p_tenant_id je odmítnut a nedostane nic z konfigurace", () => {
    const r = zavolej(cizi, `get_available_plugins(NULL, '${TENANT}')`);
    expect(r.vystup).not.toContain(TAJEMSTVI);
    expect(r.ok, `cizí uživatel se dozvěděl stav overrides tenanta: ${r.vystup}`).toBe(false);
    // Bez tenanta katalog dostane — jen bez konfigurace.
    const bez = zavolej(cizi, "get_available_plugins('agent', NULL)");
    expect(bez.ok, bez.vystup).toBe(true);
    expect(bez.vystup).toContain(SLUG);
    expect(bez.vystup).not.toContain(TAJEMSTVI);
  });

  it("⭐ tenant sám: vypnutý plugin se vynechá, konfigurace ani tak ne", () => {
    const r = zavolej(tenant, `get_available_plugins(NULL, '${TENANT}')`);
    expect(r.ok, r.vystup).toBe(true);
    expect(r.vystup).toContain(SLUG);
    expect(r.vystup, "tenant si plugin vypnul, katalog ho přesto nabízí").not.toContain(SLUG_VYPNUTY);
    expect(r.vystup).not.toContain(TAJEMSTVI);
  });

  it("⭐ admin smí katalog pro tenanta (správa) — bez konfigurace", () => {
    const r = zavolej(admin, `get_available_plugins(NULL, '${TENANT}')`);
    expect(r.ok, r.vystup).toBe(true);
    expect(r.vystup).not.toContain(SLUG_VYPNUTY);
    expect(r.vystup).not.toContain(TAJEMSTVI);
  });

  /**
   * ⭐ DRUHÝ SMĚR: oprava nesmí zavřít dveře službě. svc-plugin-system
   * (`resolvePlugin`, `/registry`) volá katalog jako service_role a potřebuje
   * z něj artefakt a verzi. Konfiguraci nedostane ani služba — katalog volá
   * i broker s parametry pluginu.
   */
  it("⭐ service_role dostane, co běh potřebuje (artefakt, verze), a konfiguraci ne", () => {
    const r = zavolej(SLUZBA, `get_available_plugins(NULL, '${TENANT}')`);
    expect(r.ok, r.vystup).toBe(true);
    expect(r.vystup).toContain(`http://artefakty.test/${SLUG}.js`);
    expect(r.vystup).toContain(`sha-${RUN}`);
    expect(r.vystup).not.toContain(SLUG_VYPNUTY);
    expect(r.vystup).not.toContain(TAJEMSTVI);
  });

  it("granty: EXECUTE mají právě anon, authenticated a service_role — PUBLIC ne", () => {
    const fn = "'public.get_available_plugins(text, uuid)'";
    expect(
      superuser(`SELECT has_function_privilege('anon', ${fn}, 'EXECUTE')::text || ',' ||
                        has_function_privilege('authenticated', ${fn}, 'EXECUTE')::text || ',' ||
                        has_function_privilege('service_role', ${fn}, 'EXECUTE')::text`),
    ).toBe("true,true,true");
    const publicMa = superuser(`SELECT count(*) FROM pg_proc p, aclexplode(p.proacl) a
                                 WHERE p.oid = ${fn}::regprocedure AND a.grantee = 0`);
    expect(publicMa, "EXECUTE pro PUBLIC by grant obešel").toBe("0");
  });
});
