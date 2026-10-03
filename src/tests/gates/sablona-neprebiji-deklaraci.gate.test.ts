/**
 * Brána: šablona platformy NEPŘEBÍJÍ deklaraci instance (CLASS gate)
 *
 * TŘÍDA VADY: `config/domains.env` se sourcuje JAKO POSLEDNÍ
 * (`scripts/lib/resolve-domains-env.sh`: operátorský trezor → resolver topologie →
 * šablona). Doslovné přiřazení v ní proto přepíše i hodnotu, kterou instance
 * výslovně deklarovala — a nikomu se nic nezčervená.
 *
 * ⛔ NAMĚŘENO 2026-09-16 na studeném startu instance:
 *   · trezor instance deklaroval `EXTRANET_ENABLED=1`,
 *   · šablona nesla `EXTRANET_ENABLED=false` a sourcovala se po něm,
 *   · `coolify-story-init.sh` vyhodnotil bránu provisioningu (`provision_when_env`)
 *     jako vypnutou a aplikaci extranetu NEZALOŽIL,
 *   · `coolify-deploy-init.sh` pak hlásil „stack je v manifestu, ale aplikace
 *     v Coolify NENÍ" a studený start doběhl s dírou ve stacku.
 *
 * INVARIANT: každé přiřazení v šabloně je buď SLOŽENINA (odkazuje na jiné klíče),
 * nebo výchozí hodnota tvarem `${KLIC:-…}` téhož klíče. Doslovná hodnota, která
 * se dá deklarovat jinde, je nález.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SABLONA = join(ROOT, "config", "domains.env");

/**
 * VĚDOMÉ VÝJIMKY: hodnoty, které platforma diktuje a instance je měnit NESMÍ.
 * Každá musí mít vlastní měřidlo, jinak by tenhle seznam byl jen zadní vrátka.
 */
const DIKTOVANE: Record<string, string> = {
  // Mesh není doplněk: brána `mesh-toggle` doslovné `MESH_ENABLED=true` v šabloně
  // přímo VYŽADUJE („je to podmínka, ne volba“).
  MESH_ENABLED: "src/tests/gates/mesh-toggle.gate.test.ts",
};

/** Klíče, které v šabloně přebíjejí cokoli dřív nastaveného. */
export function prebijejiciKlice(obsah: string): string[] {
  const nalezy: string[] = [];
  for (const radek of obsah.split("\n")) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(radek);
    if (!m) continue;
    const [, klic, hodnota] = m;
    // Vlastní výchozí hodnota: `${KLIC:-…}` nebo `${KLIC-…}` — když je klíč
    // nastavený dřív, tvar se na něj rozvine a deklarace přežije.
    if (new RegExp(`^"?\\$\\{${klic}:?-`).test(hodnota)) continue;
    // Složenina: hodnota se skládá z JINÝCH klíčů (URL z domén apod.).
    if (/\$\{[A-Z_][A-Z0-9_]*/.test(hodnota)) continue;
    if (klic in DIKTOVANE) continue;
    nalezy.push(klic);
  }
  return nalezy;
}

describe("šablona platformy nepřebíjí deklaraci instance", () => {
  test("každá vědomá výjimka má vlastní měřidlo", () => {
    for (const [klic, brana] of Object.entries(DIKTOVANE)) {
      expect(existsSync(join(ROOT, brana)), `${klic}: výjimka bez měřidla je zadní vrátka — brána ${brana} neexistuje`).toBe(true);
      expect(
        readFileSync(join(ROOT, brana), "utf-8"),
        `${klic}: brána ${brana} o tom klíči nic netvrdí, takže výjimku nic nedrží`,
      ).toContain(klic);
    }
  });

  test("negativní sonda: detektor pozná doslovnou hodnotu, vlastní výchozí i složeninu", () => {
    const vzorek = [
      "MESH_ENABLED=true",
      "JINY_PRIZNAK=true",
      "EXTRANET_ENABLED=${EXTRANET_ENABLED:-false}",
      "INTRANET_ENABLED=${INTRANET_ENABLED-false}",
      "AISHA_API_URL=https://${API_DOMAIN}",
      '# komentář=nepočítá se',
      "SEZNAM=a,b,c",
    ].join("\n");
    expect(prebijejiciKlice(vzorek)).toEqual(["JINY_PRIZNAK", "SEZNAM"]);
  });

  test("config/domains.env nepřebíjí žádný klíč", () => {
    expect(
      prebijejiciKlice(readFileSync(SABLONA, "utf-8")),
      "Šablona se sourcuje POSLEDNÍ (lib/resolve-domains-env.sh), takže doslovná hodnota\n" +
        "přepíše deklaraci instance z trezoru i z resolveru. Naměřeno 2026-09-16:\n" +
        "`EXTRANET_ENABLED=false` v šabloně přebilo deklaraci instance, story-init\n" +
        "aplikaci extranetu nezaložil a studený start doběhl s dírou.\n" +
        "Napiš výchozí hodnotu jako `${KLIC:-výchozí}`.",
    ).toEqual([]);
  });
});

/**
 * Druhá polovina téhož studeného startu: KDO hlídá cookie secret.
 *
 * ⛔ NAMĚŘENO 2026-09-16. Doktor měl seznam hlídaných klíčů NAPSANÝ RUČNĚ;
 * `EXTRANET_COOKIE_SECRET` a `OPENCLAW_COOKIE_SECRET` v něm chyběly. Do nasazení
 * odešla zkamenělá hodnota o 69 bajtech, oauth2-proxy přijímá jen 16/24/32 —
 * `extranet-auth` odmítl start, spadl s ním edge stack a veřejné adresy
 * instance vracely 404.
 *
 * INVARIANT: množina klíčů, které doktor kontroluje, se MĚŘÍ z compose, ne píše.
 */
describe("cookie secret hlídá měření, ne výčet", () => {
  test("doktor bere klíče z compose (žádný ruční seznam)", () => {
    const doktor = readFileSync(join(ROOT, "scripts", "aisha-env-doctor.mjs"), "utf-8");
    expect(doktor, "doktor musí měřit klíče z compose").toContain("kliceCookieSecretu(ROOT)");
    const radek = doktor.split("\n").find((r) => r.includes("const COOKIE_SECRET_KEYS")) ?? "";
    expect(
      radek,
      "ruční výčet klíčů je ta vada — nová brána s vlastním cookie secretem by v něm chyběla",
    ).not.toMatch(/\[\s*"/);
  });

  test("měření najde KAŽDÝ klíč, který compose podává oauth2-proxy (chování)", async () => {
    const { kliceCookieSecretu } = await import("../../../scripts/lib/cookie-secrety.mjs");
    const namerene = kliceCookieSecretu(ROOT);
    expect(namerene.length, "aspoň jeden cookie secret musí být v compose").toBeGreaterThan(0);
    // Sonda: hodnoty se čtou ze SKUTEČNÝCH compose souborů, ne z konstanty v bráně.
    const zCompose = new Set<string>();
    for (const f of readdirSync(ROOT).filter((x) => /^docker-compose\.coolify.*\.yml$/.test(x))) {
      for (const m of readFileSync(join(ROOT, f), "utf-8").matchAll(
        /OAUTH2_PROXY_COOKIE_SECRET[:=]\s*["']?\$\{([A-Z_][A-Z0-9_]*)/g,
      )) zCompose.add(m[1]);
    }
    expect(namerene).toEqual([...zCompose].sort());
  });
});
