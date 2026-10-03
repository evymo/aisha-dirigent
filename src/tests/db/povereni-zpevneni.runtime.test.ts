/**
 * Domov pověření — zpevnění (b): žádná role nečte tabulku ani obecné orákulum (RUNTIME).
 *
 * ⛔ ROZBOR 2026-09-28 (Guru) + MĚŘENÍ 2026-09-29 (riq, jen čtení):
 *   · `aisha_decrypt_column_audited` / `_encrypt_` měly EXECUTE pro authenticated
 *     a service_role — služba si šifrotext přečetla přes REST a dešifrovala RPC,
 *     admin dešifroval libovolný šifrotext, který získal. Jediný volající v kódu je
 *     get_plugin_runtime_config (DEFINER); na riq 0 dešifrování za celou historii.
 *   · audit dešifrování přes DEFINER měl auth.uid() = NULL a žádný kontext —
 *     nevěděl, kdo ani co dešifroval.
 *   · get_api_keys_status_admin počítal stav DEŠIFROVÁNÍM a vracel první
 *     a poslední 4 znaky tajemství.
 *
 * Měří se chování (každá role zvlášť, service_role i s BYPASSRLS):
 *   - anon / authenticated / service_role tabulku agent_knowledge_source_secrets NEPŘEČTE;
 *   - žádná z nich nezavolá aisha_decrypt_column_audited ani _encrypt_;
 *   - KONTROLNÍ VZOREK: správce uloží pověření (set_data_source_secrets), služba je
 *     dostane (get_plugin_runtime_config) — jinak by „nikdo nic nepřečte" prošlo
 *     i nad rozbitým domovem; audit nese klíč, plugin, zdroj a roli, NE hodnotu;
 *   - stav klíčů ve správě = přítomnost s pevnou maskou, bez zlomku hodnoty.
 *
 * Spouští se přes: npm run test:db:app-secrets (throwaway DB z baseline + heals + seed)
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const DB_SLIBENA = Boolean(process.env.AISHA_DB_URL);
const RUN = randomUUID().slice(0, 8);
const ADMIN = randomUUID();
const PLUGIN = randomUUID();
const SLUG = `zpevneni-${RUN}`;
const ZDROJ = `zpevneni-zdroj-${RUN}`;
const HODNOTA = `sk-zpevneni-${RUN}-TAJNE`;

function psql(sql: string, claims?: string, role?: string): string {
  const pre = ["\\o /dev/null", claims ? `SET request.jwt.claims = '${claims}';` : "", role ? `SET ROLE ${role};` : "", "\\o"].join("\n");
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
const ROLE_CLAIMS: Record<string, string> = {
  anon: '{"role":"anon"}',
  authenticated: `{"sub":"${ADMIN}","role":"authenticated"}`, // i ADMIN přes roli authenticated
  service_role: '{"role":"service_role"}',
};
const ADMIN_CLAIMS = ROLE_CLAIMS.authenticated;
const SLUZBA = ROLE_CLAIMS.service_role;

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("domov pověření: zpevnění (b)", () => {
  it("příprava: admin, plugin a jeho datový zdroj", () => {
    psql(`INSERT INTO aisha_auth.users (id, email) VALUES ('${ADMIN}', 'zpevneni-${RUN}@example.invalid') ON CONFLICT DO NOTHING`);
    psql(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin') ON CONFLICT DO NOTHING`);
    psql(`INSERT INTO public.plugin_catalog (id, slug, name, kind, trust_tier, status, capabilities)
          VALUES ('${PLUGIN}', '${SLUG}', 'Sonda zpevnění', 'agent', 'partner', 'ga', '[]'::jsonb)`);
    psql(`INSERT INTO public.agent_knowledge_sources (source_slug, namespace, source_plugin_id)
          VALUES ('${ZDROJ}', 'test/zpevneni-${RUN}', '${PLUGIN}')`);
  });

  for (const role of ["anon", "authenticated", "service_role"]) {
    it(`${role}: tabulku pověření NEPŘEČTE (ani service_role s BYPASSRLS)`, () => {
      const r = jako("SELECT count(*) FROM public.agent_knowledge_source_secrets", ROLE_CLAIMS[role], role);
      expect(r.ok, r.ok ? `${role} přečetl tabulku: ${r.out}` : "").toBe(false);
      if (!r.ok) expect(r.err).toMatch(/permission denied/i);
    });

    it(`${role}: obecné orákulum (decrypt/encrypt) NEZAVOLÁ`, () => {
      for (const sql of [
        "SELECT public.aisha_decrypt_column_audited('\\x00'::bytea)",
        "SELECT public.aisha_encrypt_column_audited('x')",
      ]) {
        const r = jako(sql, ROLE_CLAIMS[role], role);
        expect(r.ok, r.ok ? `${role} zavolal: ${sql}` : "").toBe(false);
        if (!r.ok) expect(r.err).toMatch(/permission denied/i);
      }
    });
  }

  it("KONTROLNÍ VZOREK: správce uloží, služba dostane; audit nese klíč, plugin, zdroj a roli — ne hodnotu", () => {
    const ulozeno = jako(`SELECT public.set_data_source_secrets('${ZDROJ}', '{"apiKey":"${HODNOTA}"}'::jsonb)`, ADMIN_CLAIMS, "authenticated");
    expect(ulozeno.ok, ulozeno.ok ? "" : ulozeno.err).toBe(true);
    const cfg = psql(`SELECT public.get_plugin_runtime_config('${SLUG}') ->> 'apiKey'`, SLUZBA);
    expect(cfg).toBe(HODNOTA);

    const audit = psql(`SELECT user_role || '|' || (details->>'klic') || '|' || (details->>'plugin') || '|' || (details->>'ucel') || '|' || entity_id
                          FROM public.audit_journal
                         WHERE action = 'crypto.column_decrypt' AND details->>'plugin' = '${SLUG}'
                         ORDER BY created_at DESC LIMIT 1`);
    expect(audit.split("|").slice(0, 4)).toEqual(["service_role", "apiKey", SLUG, "plugin_runtime"]);
    const zapis = psql(`SELECT (details->>'klic') || '|' || (details->>'zdroj') FROM public.audit_journal
                         WHERE action = 'crypto.column_encrypt' AND details->>'zdroj' = '${ZDROJ}' ORDER BY created_at DESC LIMIT 1`);
    expect(zapis).toBe(`apiKey|${ZDROJ}`);
    // hodnota v auditu NIKDY
    expect(psql(`SELECT count(*) FROM public.audit_journal WHERE details::text LIKE '%${HODNOTA}%' OR metadata::text LIKE '%${HODNOTA}%'`)).toBe("0");
  });

  it("stav klíčů ve správě = přítomnost s pevnou maskou, bez zlomku hodnoty", () => {
    // Vlastní klíč (ne openai_api_key z app-secrets-trezor): druhý zápis téhož jména jde cestou
    // vault.update_secret, rozbitou v mainu od #1090 (CASE bytea × text; oprava v DB dávce Guru).
    const tajne = `sk-stav-${RUN}-9876`;
    const r = jako(`SELECT public.set_api_key_admin('packeta_sender_id', '${tajne}')`, ADMIN_CLAIMS, "authenticated");
    expect(r.ok, r.ok ? "" : r.err).toBe(true);
    const stav = jako(`SELECT is_set || '|' || coalesce(masked_value, '') FROM public.get_api_keys_status_admin() WHERE key_name = 'packeta_sender_id'`, ADMIN_CLAIMS, "authenticated");
    expect(stav.ok, stav.ok ? "" : stav.err).toBe(true);
    if (stav.ok) {
      expect(stav.out).toBe("true|••••");
      expect(stav.out).not.toContain(tajne.slice(0, 4));
      expect(stav.out).not.toContain(tajne.slice(-4));
    }
  });
});
