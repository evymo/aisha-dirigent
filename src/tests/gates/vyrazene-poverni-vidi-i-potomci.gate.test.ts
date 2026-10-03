/**
 * Co běh vyrazí, to musí vidět i jeho vlastní potomci (CLASS gate)
 *
 * TŘÍDA VADY: hodnota má dva domovy s různou přednostÍ, a ten s VYŠŠÍ
 * předností je STARŠÍ. Oprava novějšího domova pak nic nezmění a chyba
 * vypadá jako závada sítě.
 *
 * Naměřeno 2026-08-26 na ostrém wipe deployi riqi:
 *   · Fáze D vyrazila 4 nové NetBird setup klíče a uložila čerstvý
 *     AISHA_BOOTSTRAP_CLIENT_SECRET do `.env.coolify`.
 *   · Fáze D2 (`coolify-mesh-sync` → `netbird-peer-discover`) dostávala
 *     `401 unauthorized_client` a stála 90 minut.
 *   · Secret v `.env.coolify` přitom s Keycloakem SEDĚL (otisk 756db28f na
 *     obou stranách) a ruční ROPC výměna s ním vracela HTTP 200.
 *
 * Vada měla DVĚ patra a oprava jednoho z nich nestačila:
 *   1) `.env-prod-backup` má v kanonickém řetězu VYŠŠÍ přednost než
 *      `.env.coolify` (lib/config-env-files.mjs:36) — záměrně, aby wipe
 *      hodnoty neztratil. Snapshot ale vzniká PŘED wipem, takže drží mrtvé
 *      kopie všeho, co běh vyrobí až potom. Stínilo přesně 6 klíčů — a byly
 *      to přesně ta pověření, která běh přegeneroval.
 *   2) `pre_resolve_load_env` ten snapshot navíc EXPORTUJE do prostředí
 *      (`load_env_file_keys … overwrite`). Potomci čtou `process.env`, a to
 *      přebíjí soubor — takže ani oprava souboru sama o sobě nedosáhne.
 *
 * Ověřeno mutací na běžícím systému: se starou hodnotou v prostředí
 * `netbird-peer-discover` končí exit 2 + 401, bez ní exit 0.
 *
 * INVARIANT (tři vlastnosti, všechny nutné):
 *   1. cold-start VOLÁ vault-drift-doctor s `--oprav` (ne jen zmiňuje).
 *   2. hned nato ZNOVU NAČTE prostředí — jinak potomci dál dostávají
 *      hodnoty vyexportované na začátku běhu. Obojí, nebo nic.
 *   3. oprava se smí dotknout JEN klíčů, které si platforma vyrábí; klíč
 *      operátorův ani klíč, který nelze posoudit, se nepřepisuje.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { opravTrezor, zmerRozchod } from "../../../scripts/vault-drift-doctor.mjs";

const ROOT = process.cwd();
const COLD_START = join(ROOT, "scripts", "aisha-cold-start.sh");

function read(p: string): string {
  expect(existsSync(p), `${p} musí existovat`).toBe(true);
  return readFileSync(p, "utf-8");
}

/**
 * Index řádku, který výraz SPOUŠTÍ — ne komentáře, ne dokumentace.
 *
 * ⛔ Nekotvit na první výskyt jména souboru: nad voláním bývá desítky řádků
 * komentáře, který totéž jméno zmiňuje, a brána pak měří komentář. Tuhle
 * chybu jsem 2026-08-26 udělal ve VLASTNÍ bráně — mutace jí neprošla skrz.
 */
function radekVolani(src: string, jehla: string): number {
  const radky = src.split("\n");
  return radky.findIndex((l) => {
    const t = l.trim();
    if (t.startsWith("#") || t.startsWith("*") || t.startsWith("//")) return false;
    return t.includes(jehla);
  });
}

describe("pověření vyražená během běhu vidí i potomci téhož běhu", () => {
  test("cold-start volá vault-drift-doctor s --oprav (ne jen zmiňuje v komentáři)", () => {
    const src = read(COLD_START);
    const i = radekVolani(src, "vault-drift-doctor.mjs");
    expect(
      i,
      "cold-start musí vault-drift-doctor.mjs SPOUŠTĚT. Samotná zmínka v komentáři " +
        "není zapojení — přesně tak roky ležel nezapojený coolify-mesh-sync.",
    ).toBeGreaterThan(-1);
    expect(
      src.split("\n")[i],
      "doktor musí běžet s `--oprav`; pouhé měření rozchod nahlásí, ale běh stejně padne",
    ).toContain("--oprav");
  });

  test("po opravě souboru se ZNOVU NAČTE prostředí — a to před fází D2", () => {
    const src = read(COLD_START);
    const doktor = radekVolani(src, "vault-drift-doctor.mjs");
    const meshSync = radekVolani(src, "coolify-mesh-sync.mjs --apply");
    expect(meshSync, "cold-start musí volat coolify-mesh-sync.mjs --apply").toBeGreaterThan(-1);
    expect(
      doktor,
      "oprava trezoru musí předcházet fázi D2 — po ní už je pozdě, D2 je první konzument",
    ).toBeLessThan(meshSync);

    const mezi = src
      .split("\n")
      .slice(doktor, meshSync)
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith("#") && t.includes("load_env_file_keys") && t.includes("overwrite");
      });
    expect(
      mezi.length,
      "Mezi opravou trezoru a fází D2 musí být `load_env_file_keys … overwrite`. " +
        "Bez toho potomci dál dědí hodnoty vyexportované na začátku běhu a oprava " +
        "souboru NEDOSÁHNE — ověřeno mutací (exit 2 + 401 se starou hodnotou v prostředí).",
    ).toBeGreaterThan(0);
  });

  test("oprava se nedotkne klíče operátorova ani klíče, který nelze posoudit", () => {
    const dir = mkdtempSync(join(tmpdir(), "drift-"));
    const generovany = join(dir, ".env.coolify");
    const trezor = join(dir, ".env-prod-backup");
    // Tři klíče, tři třídy: vyráběný / operátorův / neregistrovaný.
    writeFileSync(generovany, "VYROBENY=cerstvy\nOPERATORUV=cerstvy\nNEZNAMY=cerstvy\n");
    writeFileSync(trezor, "VYROBENY=zkamenely\nOPERATORUV=operatorova\nNEZNAMY=zahadna\n");
    const registr = new Map([
      ["VYROBENY", "secret"],
      ["OPERATORUV", "external"],
    ]);

    const v = zmerRozchod({ generovany, trezor, registr });
    expect(v.vady.map((z: { klic: string }) => z.klic)).toEqual(["VYROBENY"]);
    expect(v.podleZameru.map((z: { klic: string }) => z.klic)).toEqual(["OPERATORUV"]);
    expect(v.neznameTypy.map((z: { klic: string }) => z.klic)).toEqual(["NEZNAMY"]);

    opravTrezor({ generovany, trezor, vady: v.vady, casovaZnacka: "test" });
    const po = readFileSync(trezor, "utf-8");
    expect(po, "vyráběný klíč se přerazí čerstvou hodnotou").toContain("VYROBENY=cerstvy");
    expect(po, "u operátorova klíče je trezor autorita — nesahat").toContain("OPERATORUV=operatorova");
    expect(
      po,
      "klíč, který nelze posoudit, se NEPŘEPISUJE: přepsat cizí vstup na základě " +
        "domněnky je horší než nechat rozchod viditelný",
    ).toContain("NEZNAMY=zahadna");
  });
});
