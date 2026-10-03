/**
 * Brána: mesh discovery se spouští podle FÁZE, ne podle prázdných placeholderů
 *
 * ⛔ NAMĚŘENO 2026-09-03 V PROVOZU. V `refreshMeshIps` stálo:
 *
 *     const emptyKeys = [...src.matchAll(/^([A-Z0-9_]+_MESH_IP)=\s*$/gm)]…
 *     if (emptyKeys.length === 0) return { ok: true };
 *
 * Discovery tedy běželo JEN tehdy, když byl nějaký `*_MESH_IP` placeholder
 * prázdný. Ty se ale vyplní při PRVNÍM úspěšném běhu a zůstanou vyplněné — od
 * té chvíle se discovery nespustilo NIKDY.
 *
 * Následek byl tichý: `MESH_PEER_IPS` zůstalo prázdné navždy, a protože z něj
 * vzniká `GATEWAY_TRUSTED_PROXIES`, nesl nasazený seznam důvěry samé ROZSAHY
 * a loopback — ani jednu adresu peera. Chůze zprava (`clientIpFrom`) se pak
 * zastaví na mesh skoku: v `measure` je to špatné měření, v `enforce` špatné
 * řízení přístupu. Do 2026-09-02 to maskoval `100.64.0.0/10`, který mesh peery
 * pokrýval spolu s CGNATem operátorů; odebrání toho rozsahu díru odkrylo.
 *
 * ⭐ TŘÍDA VADY: OBNOVA HODNOTY JAKO VEDLEJŠÍ EFEKT NESOUVISEJÍCÍ PODMÍNKY.
 * Seznam peerů se neobnovuje proto, že „je co vyplnit", ale proto, že se peeři
 * MĚNÍ — odejitý peer musí z důvěry zmizet. Podmínka proto musí mířit na fázi.
 *
 * ⭐ A ZÁROVEŇ SE NESMÍ SPUSTIT VŽDY: před vlnou mesh warmupu netbird neběží,
 * takže by vznikla podmínka, která v té fázi nemůže platit (třída PKI/mesh
 * 2026-08). Proto `meshGuardApplies`, ne bezpodmínečné spuštění.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const CESTA = "scripts/aisha-redeploy.mjs";
const src = existsSync(join(ROOT, CESTA)) ? readFileSync(join(ROOT, CESTA), "utf-8") : "";

/** Tělo `refreshMeshIps`, vymezené párováním závorek — ne vzdáleností. */
function teloRefreshMeshIps(source: string): string {
  const zacatek = source.indexOf("async function refreshMeshIps");
  if (zacatek < 0) return "";
  let hloubka = 0;
  for (let i = source.indexOf("{", zacatek); i < source.length; i += 1) {
    if (source[i] === "{") hloubka += 1;
    else if (source[i] === "}") {
      hloubka -= 1;
      if (hloubka === 0) return source.slice(zacatek, i + 1);
    }
  }
  return "";
}

/** Kód bez komentářů — brána nesmí trestat text, který pravidlo VYSVĚTLUJE. */
function bezKomentaru(zdroj: string): string {
  return zdroj
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("mesh discovery se spouští podle fáze", () => {
  test("nástroj existuje a má refreshMeshIps", () => {
    expect(src.length, `${CESTA} nenalezen`).toBeGreaterThan(0);
    expect(teloRefreshMeshIps(src).length).toBeGreaterThan(0);
  });

  test("předčasný návrat NESMÍ viset jen na prázdných placeholderech", () => {
    const telo = bezKomentaru(teloRefreshMeshIps(src));
    // ⛔ NE REGULÁRKA PŘES ZÁVORKY: `[^)]*` se zastaví na `)` uvnitř
    // `meshGuardApplies(wave)` a uřízne půlku podmínky — měřidlo by pak hlásilo
    // vadu tam, kde je oprava. Bere se celý logický řádek.
    const navraty = telo
      .split("\n")
      .map((r) => r.trim())
      .filter((r) => r.includes("emptyKeys") && /\breturn\b/.test(r));
    expect(navraty.length, "podmínka nad `emptyKeys` s předčasným návratem zmizela — brána měří vedle").toBeGreaterThan(0);
    for (const podminka of navraty) {
      expect(
        podminka,
        `předčasný návrat "${podminka}" se ptá jen na placeholdery. ` +
          "Seznam peerů se musí obnovovat i tehdy, když je co vyplnit NENÍ — jinak " +
          "MESH_PEER_IPS zůstane prázdné navždy a odejitý peer zůstane důvěryhodný.",
      ).toMatch(/meshGuardApplies/);
    }
  });

  test("a NENÍ bezpodmínečné — před warmupem se přeskakuje", () => {
    const telo = bezKomentaru(teloRefreshMeshIps(src));
    // Kdyby se discovery pouštělo vždy, vznikla by podmínka, kterou v raných
    // vlnách nemá co uspokojit. Fáze se proto musí ptát, ne ignorovat.
    expect(telo, "discovery bez ohledu na fázi = stráž, která v raných vlnách nemůže projít")
      .toMatch(/meshGuardApplies\(wave\)/);
  });

  test("MESH_PEER_IPS se PŘEPISUJE celý, ne doplňuje", () => {
    const telo = bezKomentaru(teloRefreshMeshIps(src));
    // Doplňovat jen prázdnou hodnotu by znamenalo, že odejitý peer zůstane
    // v důvěře navždy. Náhrada musí mířit na CELÝ řádek.
    expect(telo).toMatch(/\^MESH_PEER_IPS=\.\*\$/);
  });
});
