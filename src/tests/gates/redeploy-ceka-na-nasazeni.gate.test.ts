/**
 * Brána: `aisha-redeploy.mjs` nesmí hlásit úspěch dřív, než doběhne nasazení,
 * které sám spustil.
 *
 * PROČ (naměřeno 2026-08-10)
 * -------------------------
 * Ruční nasazení edge stacku:
 *
 *   07:16:20  node scripts/aisha-redeploy.mjs --only=edge
 *             → „triggered: 2, healthy after: 2, deploy failed: 0"  (exit 0)
 *   07:30:39  totéž nasazení v Coolify → status=failed
 *
 * Čtrnáct minut mezi „hotovo" a skutečným pádem. Web pak tři dny servíroval
 * bundle ze 7. srpna, zatímco nástroj tvrdil opak.
 *
 * ⭐ PŘÍČINA: podmínka úspěchu byla `allOk && deploymentFailures.length === 0`.
 * `allOk` znamená „appky jsou zdravé" — jenže u spadlého nasazení je STARÝ
 * kontejner zdravý PRÁVĚ PROTO, že ho nový nenahradil. Zdraví kontejneru tedy
 * není totéž co hotové nasazení; u no-opu je splněné okamžitě.
 *
 * Táž třída jako `ci-deploy-honesty` → „deploy čeká na SVÉ nasazení":
 * `deploy-and-verify.sh` měl stejnou vadu jinou cestou (koukal na globální
 * seznam AKTIVNÍCH nasazení). Dva nástroje, dvě různé cesty k témuž tichému
 * úspěchu.
 *
 * CO SE MĚŘÍ
 * ----------
 * Že návrat `ok: true` je podmíněný i tím, že známé `deployment_uuid` dosáhlo
 * terminálního stavu (`deploymentTerminal`).
 *
 * ⚠️ MĚŘÍ SE TEXTEM, A JE TO ÚSTUPEK — přiznaný, ne přehlédnutý.
 * `aisha-redeploy.mjs` nic neexportuje a spouští `main()` při načtení, takže
 * import kvůli unit testu by spustil SKUTEČNÝ deploy. Tutéž cestou jde i
 * sousední `redeploy-wave-coverage`, která parsuje `WAVES` ze zdrojáku.
 * Tvrzení je proto navázané na PODMÍNKU (řádek s `return { ok: true`), ne na
 * komentář — komentář smí zůstat i po odstranění stráže, a právě tak se dnes
 * dvakrát podařilo napsat bránu, která měřila text místo činu.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SKRIPT = join(ROOT, "scripts/aisha-redeploy.mjs");

/**
 * Tělo čekací funkce — a JEN její.
 *
 * ⚠️ První verze brány brala `return { ok: true` z CELÉHO skriptu a našla jich
 * patnáct: brány vln, env sync, rollback helpery. Tvrzení pak mluvilo o věcech,
 * se kterými nemá co dělat. Univerzum musí sedět na otázku, ne být co nejširší.
 */
function teloCekaciFunkce(zdroj: string): string {
  const zac = zdroj.indexOf("async function waitForHealthyOrFailedDeploy(");
  if (zac < 0) return "";
  const dalsi = zdroj.slice(zac + 1).search(/\n(async )?function \w+\(/);
  return dalsi < 0 ? zdroj.slice(zac) : zdroj.slice(zac, zac + 1 + dalsi);
}

/** Řádky s návratem úspěchu z čekací funkce (mimo `--no-wait` zkratku). */
function radkyUspechu(zdroj: string): string[] {
  return teloCekaciFunkce(zdroj)
    .split("\n")
    .filter((r) => /return\s*\{\s*ok:\s*true/.test(r))
    // `--no-wait` je VÝSLOVNÉ přání uživatele neměřit; ten návrat sem nepatří.
    .filter((r) => !/statuses:\s*\{\}/.test(r));
}

describe("redeploy čeká na nasazení, ne jen na zdraví (brána)", () => {
  const zdroj = readFileSync(SKRIPT, "utf8");

  test("univerzum není prázdné — jinak je tvrzení níž vakuové", () => {
    expect(
      radkyUspechu(zdroj).length,
      "v `aisha-redeploy.mjs` není ani jeden `return { ok: true` mimo --no-wait — " +
        "brána ztratila předmět nebo se změnil tvar čekací funkce"
    ).toBeGreaterThan(0);
  });

  test("úspěch je podmíněný terminálním stavem známého nasazení", () => {
    const bezStraze = radkyUspechu(zdroj).filter((r) => !/deploymentTerminal|cekaSeNaNasazeni/.test(r));
    // Stráž smí být i na řádku PŘED návratem (`if (…) { return … }` na dvou řádcích),
    // takže se dívám i o kus výš — jinak by brána nutila k jednomu konkrétnímu zápisu.
    const skutecneBez = bezStraze.filter((radek) => {
      const i = zdroj.indexOf(radek);
      const okoli = zdroj.slice(Math.max(0, i - 400), i);
      return !/deploymentTerminal|cekaSeNaNasazeni/.test(okoli);
    });
    expect(
      skutecneBez,
      "návrat `ok: true` není podmíněný tím, že sledované nasazení doběhlo.\n" +
        "`allOk` (appky zdravé) je u spadlého nasazení splněné OKAMŽITĚ — starý kontejner\n" +
        "je zdravý právě proto, že ho nový nenahradil. Naměřeno 2026-08-10: nástroj hlásil\n" +
        "„healthy after: 2, deploy failed: 0" + '"' + " a totéž nasazení o 14 minut později\n" +
        "skončilo v Coolify jako `failed`."
    ).toEqual([]);
  });

  test("terminální stav se zapisuje i při ÚSPĚCHU, ne jen u pádu", () => {
    // Bez tohohle by stráž výš čekala navždy: kdyby se `deploymentTerminal`
    // plnilo jen u `failed`, úspěšné nasazení by nikdy nebylo „terminální".
    expect(
      zdroj,
      "`deploymentTerminal` se nenaplní při `finished` — stráž by pak u úspěšného " +
        "nasazení čekala až do timeoutu a hlásila falešný pád"
    ).toMatch(/deploymentTerminal\.set\([^)]*status:\s*["']finished["']/);
  });
});
