/**
 * Gate: kdo volá mesh management API, musí použít tvář, která ho OBSLUHUJE.
 *
 * ⛔ NAMĚŘENO 2026-09-07 na produkci. `live.<public-tld>` vracelo 502 a při
 * hledání příčiny se ukázalo, že smíření mesh DNS je celé mrtvé:
 *
 *     ! peer mapa nedostupná (GET /api/peers → 404 page not found)
 *       — cíle spadnou na docker alias, tedy na plochou síť
 *     PLÁN (0 jmen)     NEVYŘEŠENO (58)
 *
 * `netbird-dns-provision.mjs` sahal na API VEŘEJNÝM jménem. Veřejnou zónu ale
 * posílá edge na uzel EDGE, zatímco netbird bydlí u pki — na jiném uzlu. Změřeno
 * týmž dotazem dvěma jmény:
 *
 *     https://netbird.<public-tld>/api/peers                → 404
 *     https://<prefix>-netbird.backend.<tld>/api/peers      → 401
 *
 * ⭐ 404 VS 401 JE CELÁ DIAGNÓZA. 404 = „tady taková cesta není", tedy mluvím
 * s CIZÍ službou. 401 = „obsluhuji a chci token", tedy správný adresát. Nástroj
 * ta dvě čísla nerozlišoval, tiše propadl na docker alias — a ten propad si
 * jeho vlastní komentář označuje za „plochou síť", čili za stav, který má
 * odstraňovat. Návrat k horší odpovědi místo poctivého selhání.
 *
 * ⭐ TŘÍDA, NE JEDNORÁZOVKA. Táž vada byla naměřena a opravena 2026-08-25
 * v `netbird-peer-discover.mjs` (tehdy vzniklo `NETBIRD_DOMAIN_DIRECT` i
 * pomocník `tvarKteraObsluhuje`). `coolify-domain-doctor.mjs` přímé jméno taky
 * používá. Provisioning byl jediný, kdo zůstal pozadu — a nikdo si toho dva
 * týdny nevšiml, protože se to projeví až u toho, kdo na mesh jméno sáhne.
 *
 * Tvrzení je proto VLASTNOST: každý skript, který volá cestu mesh management
 * API, musí buď použít `tvarKteraObsluhuje` (ověří a případně přepne na přímé
 * jméno), nebo přímé jméno vzít rovnou. Samotné `NETBIRD_API_URL` nestačí.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SCRIPTS = join(ROOT, "scripts");

/** Text bez komentářů — komentář není chování. */
const bezKomentaru = (text: string) =>
  text
    .split("\n")
    .filter((r) => !/^\s*(\/\/|\*|#)/.test(r))
    .join("\n");

/** Cesty, které identifikují mesh management API (ne jakékoli /api/). */
const MESH_API = /\/api\/(peers|dns\/|groups|nameservers|routes|setup-keys)/;

function skriptyVolajiciMeshApi(): { soubor: string; zdroj: string }[] {
  const out: { soubor: string; zdroj: string }[] = [];
  for (const dir of [SCRIPTS, join(SCRIPTS, "lib")]) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".mjs"))) {
      const cesta = join(dir, f);
      const zdroj = bezKomentaru(readFileSync(cesta, "utf-8"));
      // VOLÁ = sám posílá požadavek. Modul, který jen skládá cesty pro vložené
      // `call` (lib/netbird-dns-zony.mjs), adresáta nevolí — základ URL určuje
      // ten, kdo `call` sestavil, a TEN je tu měřen (má fetch i cestu).
      if (MESH_API.test(zdroj) && /\bfetch\s*\(|https?\.request\s*\(/.test(zdroj)) {
        out.push({ soubor: cesta.slice(ROOT.length + 1), zdroj });
      }
    }
  }
  return out;
}

describe("mesh management API — volá se tváří, která obsluhuje", () => {
  const volajici = skriptyVolajiciMeshApi();

  test("nějaké volající vůbec existují (jinak brána nic neměří)", () => {
    expect(
      volajici.map((v) => v.soubor),
      "žádný skript nevolá cesty mesh management API — detekce se rozešla se skutečností",
    ).not.toEqual([]);
  });

  test("každý volající zná PŘÍMOU tvář, ne jen veřejné jméno", () => {
    const slepi = volajici
      .filter((v) => !/tvarKteraObsluhuje|NETBIRD_DOMAIN_DIRECT/.test(v.zdroj))
      .map((v) => v.soubor);
    expect(
      slepi,
      "Tenhle skript volá mesh management API a zná jen veřejné jméno. Veřejnou zónu\n" +
        "posílá edge na uzel EDGE, ale netbird bydlí u pki — dostane 404 a NEUDĚLÁ NIC.\n" +
        "Náprava: `import { tvarKteraObsluhuje } from './lib/netbird-auth.mjs'` a před\n" +
        "prvním dotazem přepnout základ na tvář, která '/api/peers' opravdu obsluhuje\n" +
        "(živé = 200/401/403; 404 znamená špatného adresáta, ne chybějící oprávnění).",
    ).toEqual([]);
  });

  test("pomocník má JEDEN domov (sdílená lib), ne kopii v každém nástroji", () => {
    // Kopie by se rozešly stejně, jako se rozešly ty tři cesty k tokenu — proto
    // `netbird-auth.mjs` existuje. Definice smí být jen tam.
    const domov = "scripts/lib/netbird-auth.mjs";
    const kopie: string[] = [];
    for (const dir of [SCRIPTS, join(SCRIPTS, "lib")]) {
      for (const f of readdirSync(dir).filter((x) => x.endsWith(".mjs"))) {
        const cesta = join(dir, f);
        const rel = cesta.slice(ROOT.length + 1);
        if (rel === domov) continue;
        const zdroj = bezKomentaru(readFileSync(cesta, "utf-8"));
        if (/(async\s+)?function\s+tvarKteraObsluhuje\s*\(/.test(zdroj)) kopie.push(rel);
      }
    }
    expect(
      kopie,
      `Vlastní definice 'tvarKteraObsluhuje' mimo ${domov}. Kopie se rozejdou — přesně\n` +
        "tak, jako se rozešly tři vlastní cesty k tokenu, kvůli kterým ta lib vznikla.\n" +
        "Náprava: importovat ze sdílené knihovny a lokální kopii smazat.",
    ).toEqual([]);
  });
});
