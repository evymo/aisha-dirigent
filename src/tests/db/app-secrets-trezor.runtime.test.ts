/**
 * app_secrets — tajemství jen v trezoru, klient je nepřečte (RUNTIME, throwaway DB).
 *
 * ⛔ NAMĚŘENO 2026-09-28 (riq produkce, jen čtení): `app_secrets` měla SELECT pro
 * anon a ALL pro authenticated, `set_api_key_admin` do ní psal NEŠIFROVANOU kopii
 * a admin ji přečetl přes `GET /rest/v1/app_secrets`. Tady se měří chování, ne tvar:
 *
 *   admin (role authenticated, jako PostgREST)  → SELECT app_secrets = odepřeno
 *   set_api_key_admin                          → hodnota v trezoru, app_secrets beze změny
 *   get_app_secret / _batch (služba)           → hodnotu vydají z trezoru (servisní
 *                                                token BEZ `sub` — dřív tu padal na
 *                                                auth.uid() a čtenář tiše šel na env)
 *   migrate_app_secrets_to_vault               → převede jen chybějící, podruhé 0,
 *                                                hodnotu z administrace nepřepíše
 *
 * Kontrolní vzorek: služba (service_role claims přes DEFINER) klíč DOSTANE — jinak
 * by „admin nic nepřečte" prošlo i nad prázdnou nebo rozbitou databází.
 *
 * Spouští se přes: npm run test:db:app-secrets (throwaway DB z baseline + heals + seed)
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

/** Wrapper throwaway DB nastaví AISHA_DB_URL — pak je nedosažitelná DB vada, ne důvod přeskočit. */
const DB_SLIBENA = Boolean(process.env.AISHA_DB_URL);
const ADMIN = randomUUID();
const RUN = randomUUID().slice(0, 8);

function psql(sql: string, claims?: string, role?: string): string {
  const pre = [
    "\\o /dev/null",
    claims ? `SET request.jwt.claims = '${claims}';` : "",
    role ? `SET ROLE ${role};` : "",
    "\\o",
  ].join("\n");
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    { input: `${pre}\n${sql};`, encoding: "utf-8", env: { ...process.env, PGPASSWORD: PG_PASSWORD }, stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}
const jako = (sql: string, claims: string, role?: string) => {
  try {
    return { ok: true as const, out: psql(sql, claims, role) };
  } catch (e) {
    return { ok: false as const, err: String((e as { stderr?: string }).stderr ?? e) };
  }
};
const SLUZBA = '{"role":"service_role"}';
const ADMIN_CLAIMS = `{"sub":"${ADMIN}","role":"authenticated"}`;

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("app_secrets: tajemství jen v trezoru", () => {
  it("připrava: admin (user_roles) a nešifrovaný řádek ze staré instance", () => {
    psql(`INSERT INTO aisha_auth.users (id, email) VALUES ('${ADMIN}', 'admin-${RUN}@example.invalid') ON CONFLICT DO NOTHING`);
    psql(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin') ON CONFLICT DO NOTHING`);
    psql(`INSERT INTO public.app_secrets (key, value) VALUES ('stary_klic_${RUN}', 'hodnota-${RUN}') ON CONFLICT (key) DO NOTHING`);
  });

  it("admin přes roli authenticated app_secrets NEPŘEČTE (grant odebrán)", () => {
    const r = jako("SELECT count(*) FROM public.app_secrets", ADMIN_CLAIMS, "authenticated");
    expect(r.ok, `admin přečetl app_secrets: ${r.ok ? r.out : ""}`).toBe(false);
    if (!r.ok) expect(r.err).toMatch(/permission denied/i);
  });

  it("anonym app_secrets NEPŘEČTE", () => {
    const r = jako("SELECT count(*) FROM public.app_secrets", '{"role":"anon"}', "anon");
    expect(r.ok).toBe(false);
  });

  it("převod: nešifrovaný klíč do trezoru jednou, podruhé nic", () => {
    const prvni = Number(psql("SELECT public.migrate_app_secrets_to_vault()"));
    expect(prvni).toBeGreaterThanOrEqual(1);
    expect(Number(psql("SELECT public.migrate_app_secrets_to_vault()"))).toBe(0);
    expect(psql(`SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'stary_klic_${RUN}'`)).toBe(`hodnota-${RUN}`);
  });

  it("kontrolní vzorek: služba klíč z trezoru DOSTANE (get_app_secret i _batch)", () => {
    expect(psql(`SELECT public.get_app_secret('stary_klic_${RUN}')`, SLUZBA)).toBe(`hodnota-${RUN}`);
    expect(psql(`SELECT value FROM public.get_app_secrets_batch(ARRAY['stary_klic_${RUN}'])`, SLUZBA)).toBe(`hodnota-${RUN}`);
  });

  it("uživatel (i admin) get_app_secret NEZAVOLÁ — tajemství čte jen služba", () => {
    const r = jako(`SELECT public.get_app_secret('stary_klic_${RUN}')`, ADMIN_CLAIMS);
    expect(r.ok, r.ok ? `admin dostal tajemství: ${r.out}` : "").toBe(false);
  });

  it("set_api_key_admin ukládá JEN do trezoru — app_secrets se nezmění", () => {
    const pred = psql("SELECT count(*) FROM public.app_secrets");
    const r = jako(`SELECT public.set_api_key_admin('openai_api_key', 'sk-test-${RUN}')`, ADMIN_CLAIMS, "authenticated");
    expect(r.ok, r.ok ? "" : r.err).toBe(true);
    expect(psql("SELECT count(*) FROM public.app_secrets")).toBe(pred);
    expect(psql("SELECT count(*) FROM public.app_secrets WHERE key = 'openai_api_key'")).toBe("0");
    expect(psql("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'openai_api_key'")).toBe(`sk-test-${RUN}`);
  });

  it("převod nepřepíše hodnotu nastavenou v administraci", () => {
    psql(`INSERT INTO public.app_secrets (key, value) VALUES ('openai_api_key', 'stara-nesifrovana') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    psql("SELECT public.migrate_app_secrets_to_vault()");
    expect(psql("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'openai_api_key'")).toBe(`sk-test-${RUN}`);
  });
});
