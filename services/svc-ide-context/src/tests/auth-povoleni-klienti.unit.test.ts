/**
 * Token smí přijít jen od klienta ze seznamu — a PRÁZDNÝ SEZNAM = NIKDO.
 *
 * ⛔ Do 2026-10-04 stálo v `isAllowedClient` „prázdný seznam pustí každého“: stačilo,
 * aby seznam vyšel prázdný, a služba věřila tokenu kteréhokoli klienta realmu.
 * Nevím-li, komu věřit, nevěřím nikomu.
 *
 * `isAllowedClient` není exportovaná — měří se přes `verifyToken` s ověřovačem
 * podpisu nahrazeným atrapou (podpis tu není předmět měření).
 */
import { describe, expect, it, vi } from "vitest";

async function sOveritelem(payload: Record<string, unknown>, kcAllowedClients: string[]) {
  vi.resetModules();
  vi.doMock("@aisha/security", () => ({
    createJwtVerifier: () => ({ verify: vi.fn().mockResolvedValue(payload) }),
    AuthError: class extends Error {
      statusCode = 401;
    },
  }));
  vi.doMock("../config.js", () => ({
    config: { jwksUrl: "http://kc.invalid/jwks", kcIssuer: "http://kc.invalid/realms/test", kcAllowedClients },
  }));
  return import("../auth.js");
}

describe("povolení klienti: prázdný seznam = nikdo", () => {
  const token = { sub: "u", azp: "klient-a", aud: ["klient-b"] };

  it("s prázdným seznamem dostane jinak platný token 403 — ani `azp`, ani `aud` nepomůže", async () => {
    const { verifyToken } = await sOveritelem(token, []);
    await expect(verifyToken("Bearer t")).rejects.toMatchObject({
      name: "AuthError",
      statusCode: 403,
      message: "Keycloak client not allowed",
    });
  });

  // Kotva: týž token projde, jakmile seznam jeho klienta nese — 403 výš je tedy seznamem, ne tokenem.
  it.each([
    ["podle azp", ["klient-a"]],
    ["podle aud", ["klient-b"]],
  ])("kotva: týž token s neprázdným seznamem projde (%s)", async (_popis, seznam) => {
    const { verifyToken } = await sOveritelem(token, seznam);
    await expect(verifyToken("Bearer t")).resolves.toMatchObject({ userId: "u" });
  });

  it("klient mimo seznam dostane 403", async () => {
    const { verifyToken } = await sOveritelem(token, ["nekdo-jiny"]);
    await expect(verifyToken("Bearer t")).rejects.toMatchObject({ statusCode: 403 });
  });
});
