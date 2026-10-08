/**
 * Privilegované sloupce profilu partnera (is_certified, is_production_provider) si klient nesmí přidělit
 * ani ZALOŽENÍM profilu — na skutečné databázi.
 *
 * Revize 2 (2026-10-05, N2): spoušť partner_profiles_privilege_guard byla jen BEFORE UPDATE (tgtype 19),
 * takže přihlášený si vložil vlastní profil rovnou s is_certified = true (politika „Users can insert own
 * partner profile“ hlídá jen user_id) — změřeno revizí. Na is_certified stojí gilda G1
 * (knowledge_audience_in_guild), úroveň publika (audience_compute_actor_tier) i validate_invitation.
 *
 * Drží:
 *  · samozvaný INSERT s is_certified = true → 42501, profil nevznikne, gilda zůstane prázdná;
 *  · samozvaný INSERT s is_production_provider = true → 42501;
 *  · INSERT s výchozími hodnotami projde (registrace partnera dál funguje);
 *  · kotva: správa (admin) založí certifikovaný profil; serverový kontext (service_role) také;
 *  · UPDATE dál jen správa (beze změny);
 *  · spoušť je BEFORE INSERT OR UPDATE (bity tgtype: řádek 1, před 2, INSERT 4, UPDATE 16).
 *
 * Běh: node scripts/db/with-throwaway-db.mjs -- npx vitest run src/tests/db/partner-profil-privilegia.runtime.test.ts
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isPgReachable } from "./test-env-probe";
import { psql, psqlOk } from "./viditelnost-matice";

const DB_SLIBENA = Boolean(process.env.AISHA_DB_URL);
const [JA, SPRAVCE, CIZI, SLUZBOU] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const vsichni = [JA, SPRAVCE, CIZI, SLUZBOU];

/** Jedna transakce pod rolí API se značkami JWT; vždy ROLLBACK. */
const jako = (role: "authenticated" | "service_role", sub: string | null, telo: string) => `BEGIN;
SELECT set_config('request.jwt.claims', '${JSON.stringify(sub ? { role, sub } : { role })}', true);
SELECT set_config('request.jwt.claim.sub', '${sub ?? ""}', true);
SET LOCAL ROLE ${role};
${telo}
ROLLBACK;`;

const profil = (kdo: string, sloupce = "", hodnoty = "") =>
  `INSERT INTO public.partner_profiles (user_id, display_name, city${sloupce}) VALUES ('${kdo}', 'ZKPP', 'Brno'${hodnoty});`;

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("profil partnera: privilegované sloupce ani při založení", () => {
  beforeAll(() => {
    if (!isPgReachable()) throw new Error("AISHA_DB_URL je nastavené (throwaway wrapper), ale DB není dosažitelná — vada harnessu, ne důvod přeskočit.");
    psqlOk(`INSERT INTO aisha_auth.users (id, email) VALUES ${vsichni.map((u, i) => `('${u}', 'zkpp-${i}-${u}@test.local')`).join(", ")};
INSERT INTO public.user_roles (user_id, role) VALUES ('${SPRAVCE}', 'admin');`);
  });

  afterAll(() => {
    if (!isPgReachable()) return;
    const ids = vsichni.map((u) => `'${u}'`).join(", ");
    psqlOk(`DELETE FROM public.partner_profiles WHERE user_id IN (${ids});
DELETE FROM public.user_roles WHERE user_id IN (${ids});
DELETE FROM aisha_auth.users WHERE id IN (${ids});`);
  });

  it("spoušť guardu je BEFORE INSERT OR UPDATE nad řádkem", () => {
    const t = psqlOk(`SELECT tgtype FROM pg_trigger WHERE tgrelid = 'public.partner_profiles'::regclass AND tgname = 'partner_profiles_privilege_guard'`);
    expect(Number(t) & 1, "FOR EACH ROW").toBe(1);
    expect(Number(t) & 2, "BEFORE").toBe(2);
    expect(Number(t) & 4, "INSERT").toBe(4);
    expect(Number(t) & 16, "UPDATE").toBe(16);
  });

  it("samozvaný INSERT s is_certified = true → 42501; profil nevznikne, gilda zůstane prázdná", () => {
    const r = psql(jako("authenticated", JA, `${profil(JA, ", is_certified", ", true")}`));
    expect(r.kod, "INSERT musí spadnout").not.toBe(0);
    expect(r.chyba).toMatch(/is_certified is server-managed/);
    expect(psqlOk(`SELECT count(*) FROM public.partner_profiles WHERE user_id = '${JA}'`)).toBe("0");
    expect(psqlOk(`SELECT public.knowledge_audience_in_guild('${JA}'::uuid)`)).toBe("f");
  });

  it("samozvaný INSERT s is_production_provider = true → 42501", () => {
    const r = psql(jako("authenticated", JA, profil(JA, ", is_production_provider", ", true")));
    expect(r.kod).not.toBe(0);
    expect(r.chyba).toMatch(/is_production_provider is server-managed/);
  });

  it("INSERT s výchozími hodnotami projde (registrace partnera dál funguje)", () => {
    const r = psql(jako("authenticated", JA, `${profil(JA)}\nSELECT 'vysledek=' || is_certified::text || '/' || is_production_provider::text FROM public.partner_profiles WHERE user_id = '${JA}';`));
    expect(r.kod, r.chyba).toBe(0);
    expect(r.vystup).toContain("vysledek=false/false");
  });

  it("kotva: správa založí certifikovaný profil; serverový kontext (service_role) také", () => {
    const s = psql(jako("authenticated", SPRAVCE, `${profil(CIZI, ", is_certified", ", true")}\nSELECT 'vysledek=' || is_certified::text FROM public.partner_profiles WHERE user_id = '${CIZI}';`));
    expect(s.kod, s.chyba).toBe(0);
    expect(s.vystup).toContain("vysledek=true");
    const k = psql(jako("service_role", null, `${profil(SLUZBOU, ", is_certified, is_production_provider", ", true, true")}\nSELECT 'vysledek=' || is_certified::text FROM public.partner_profiles WHERE user_id = '${SLUZBOU}';`));
    expect(k.kod, k.chyba).toBe(0);
    expect(k.vystup).toContain("vysledek=true");
  });

  it("UPDATE vlastního profilu na is_certified = true dál odmítne (beze změny)", () => {
    const r = psql(jako("authenticated", JA, `${profil(JA)}\nUPDATE public.partner_profiles SET is_certified = true WHERE user_id = '${JA}';`));
    expect(r.kod).not.toBe(0);
    expect(r.chyba).toMatch(/is_certified is server-managed/);
  });
});
