/**
 * Stráž story přes SKUTEČNÝ PostgREST — podvržená role neprojde.
 *
 * `can_access_story` pouští service_role vždy a pozná ho z `request.jwt.claims`
 * (is_service_role → get_jwt_role). To je bezpečné jen proto, že claims nastavuje
 * PostgREST AŽ po ověření podpisu tokenu. Tenhle test to měří na živé cestě
 * HTTP → PostgREST → Postgres, ne předpokladem:
 *
 *   - token s rolí service_role podepsaný CIZÍM klíčem → 401
 *   - token s rolí service_role bez podpisu (alg none) → 401
 *   - platně podepsaný cizí uživatel → 403 (42501 ze stráže)
 *   - KONTROLNÍ VZOREK: platný service token projde stráží a narazí až na
 *     dohledání story (404 / P0002) — bez něj by „401 všude" mohla znamenat
 *     rozbitou cestu, ne fungující ověření.
 *
 * Spouští se přes: npm run test:db:story-straz (throwaway DB + PostgREST)
 */
import { describe, it, expect } from "vitest";
import { createHmac, randomUUID } from "crypto";

const URL_PGRST = process.env.POSTGREST_URL ?? "";
const SECRET = process.env.POSTGREST_JWT_SECRET ?? "";
const SERVICE_TOKEN = process.env.POSTGREST_SERVICE_TOKEN ?? "";
const POVINNE = process.env.STORY_STRAZ_POSTGREST === "1";
const dostupne = Boolean(URL_PGRST && SECRET && SERVICE_TOKEN);

const b64u = (v: string | Buffer) => Buffer.from(v).toString("base64url");
function jwt(payload: object, klic: string | null): string {
  const alg = klic === null ? "none" : "HS256";
  const hlava = b64u(JSON.stringify({ alg, typ: "JWT" }));
  const telo = b64u(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 300, ...payload }));
  const podpis = klic === null ? "" : b64u(createHmac("sha256", klic).update(`${hlava}.${telo}`).digest());
  return `${hlava}.${telo}.${podpis}`;
}

async function zavolej(token: string): Promise<{ status: number; code?: string }> {
  const r = await fetch(`${URL_PGRST}/rpc/get_allowed_transitions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ p_story_id: randomUUID() }),
  });
  const telo = (await r.json().catch(() => ({}))) as { code?: string };
  return { status: r.status, code: telo.code };
}

describe("stráž story přes PostgREST", () => {
  it("lane s PostgREST opravdu běží (když ji skript vyžaduje, nesmí se tiše přeskočit)", () => {
    if (POVINNE) expect(dostupne, "STORY_STRAZ_POSTGREST=1, ale chybí POSTGREST_URL/JWT_SECRET/SERVICE_TOKEN").toBe(true);
  });

  it.skipIf(!dostupne)("kontrolní vzorek: platný service token projde stráží až k dohledání story", async () => {
    const r = await zavolej(SERVICE_TOKEN);
    // P0002 = stráž prošla a funkce story nenašla. PostgREST v12 tenhle kód na HTTP
    // nemapuje (vrací 500, naměřeno) — rozhoduje kód, status jen nesmí být 401/403.
    expect(r.code).toBe("P0002");
    expect([401, 403]).not.toContain(r.status);
  });

  it.skipIf(!dostupne)("service_role podepsaná cizím klíčem → 401", async () => {
    const r = await zavolej(jwt({ role: "service_role" }, "cizi-klic-0123456789-0123456789-0123456789"));
    expect(r.status).toBe(401);
  });

  it.skipIf(!dostupne)("service_role bez podpisu (alg none) → 401", async () => {
    const r = await zavolej(jwt({ role: "service_role" }, null));
    expect(r.status).toBe(401);
  });

  it.skipIf(!dostupne)("platně podepsaný cizí uživatel → 403 ze stráže", async () => {
    const r = await zavolej(jwt({ role: "authenticated", sub: randomUUID() }, SECRET));
    expect(r.code).toBe("42501");
    expect(r.status).toBe(403);
  });
});
