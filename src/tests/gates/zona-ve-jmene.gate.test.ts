/**
 * brána: zóna ve jméně proměnné musí odpovídat zóně v hodnotě
 *
 * ⛔ NAMĚŘENO 2026-08-27. Repo si tohle pravidlo zapsalo už 2026-08-26
 * (docs/deploy/MESH-NEBYLA-POUZIVANA-2026-08-26.md) po incidentu, kdy `*_MESH`
 * proměnné nesly při vypnuté meshi adresu NEMESHOVOU. Zapsané pravidlo bez
 * měřidla ale vydrží do příště — a příště přišlo v opačném směru:
 *
 *   API_UPSTREAM_PUBLIC=https://<prefix>-api.mesh.<instance>.internal
 *
 * Jméno slibuje veřejnou zónu, hodnota je meshová. Nic nespadne; provoz jen
 * jde cestou, která pro tu roli neexistuje.
 *
 * Druhý test je SEBETEST měřidla. Detektor, který nikdy nic nenajde, je
 * k nerozeznání od slepého — proto se na dočasném env ověřuje, že vadu
 * v OBOU směrech vidí a že směrovací tabulku nechá být.
 */
import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const ROOT = resolve(__dirname, "../../..");
const AUDIT = join(ROOT, "scripts/audit-zona-ve-jmene.mjs");

function spustit(envPath: string): { kod: number; vystup: string } {
  try {
    const vystup = execFileSync("node", [AUDIT, envPath], { encoding: "utf8", stdio: "pipe" });
    return { kod: 0, vystup };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { kod: err.status ?? 1, vystup: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

const ZONY = [
  "MESH_TLD=mesh.pokus.internal",
  "PUBLIC_TLD=verejna.example.com",
  "INTERNAL_TLD=example.com",
].join("\n");

describe("brána: zóna ve jméně proměnné odpovídá zóně v hodnotě", () => {
  test("sebetest měřidla: vidí obě strany vady a tabulku nechá být", () => {
    const dir = mkdtempSync(join(tmpdir(), "zona-"));
    try {
      const env = join(dir, ".env.test");
      writeFileSync(
        env,
        [
          ZONY,
          // 1) jméno slibuje PUBLIC, hodnota je meshová — vada, co se našla v prod
          "API_UPSTREAM_PUBLIC=https://pokus-api.mesh.pokus.internal",
          // 2) opačný směr: jméno slibuje MESH, hodnota je z vnitřní zóny
          "AUTH_UPSTREAM_MESH=pokus-auth.backend.example.com",
          // 3) SPRÁVNĚ — nesmí se hlásit
          "API_UPSTREAM_MESH=http://pokus-api.mesh.pokus.internal:3001",
          "API_DOMAIN_PUBLIC=api.verejna.example.com",
          // 4) směrovací TABULKA — Host z vnitřní zóny je tu záměr, ne vada
          "ADMIN_MESH_INGRESS_ROUTES=8080|pokus-admin.backend.example.com|http://admin:8080",
        ].join("\n") + "\n",
      );

      const { kod, vystup } = spustit(env);
      expect(kod, "měřidlo musí vadu ohlásit nenulovým kódem").toBe(1);
      expect(vystup, "PUBLIC jméno s meshovou hodnotou musí vidět").toContain("API_UPSTREAM_PUBLIC");
      expect(vystup, "MESH jméno s nemeshovou hodnotou musí vidět").toContain("AUTH_UPSTREAM_MESH");
      expect(vystup, "správně pojmenovanou meshovou proměnnou NESMÍ hlásit").not.toContain(
        "API_UPSTREAM_MESH\n",
      );
      expect(vystup, "směrovací tabulku NESMÍ hlásit — Host je tam záměr").not.toContain(
        "ADMIN_MESH_INGRESS_ROUTES",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("chybějící deklarace zón = odmítnutí, ne tiché 'čisto'", () => {
    const dir = mkdtempSync(join(tmpdir(), "zona-"));
    try {
      const env = join(dir, ".env.test");
      // ⛔ Bez MESH_TLD/PUBLIC_TLD/INTERNAL_TLD nelze rozhodnout, kam hodnota patří.
      // Audit, který by v té situaci ohlásil „čisto", je horší než žádný.
      writeFileSync(env, "API_UPSTREAM_PUBLIC=https://cokoliv.example.com\n");
      const { kod, vystup } = spustit(env);
      expect(kod, "chybějící měřítko musí skončit kódem 2, ne 0").toBe(2);
      expect(vystup).toContain("chybí deklarace zón");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("nedosažitelný vstup = odmítnutí, ne tiché 'čisto'", () => {
    const { kod } = spustit(join(tmpdir(), "urcite-neexistuje-zona-audit.env"));
    expect(kod, "nečitelný vstup musí skončit kódem 2").toBe(2);
  });
});
