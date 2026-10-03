/**
 * Brána: ARG, na kterém se Dockerfile VĚTVÍ, musí compose předat.
 *
 * PROČ (naměřeno 2026-08-10)
 * -------------------------
 * `services/svc-web-artifact/Dockerfile` deklaruje `ARG AISHA_WEB_DESIGN_GIT_URL=`
 * a rozhoduje se podle něj: prázdná hodnota = „skipped — committed placeholder".
 * `docker-compose.coolify.yml` ho ale NEPŘEDÁVAL — build blok měl jen `context`
 * a `dockerfile`, žádné `args:`.
 *
 * Následek: instance měla designové repo nastavené v env a do obrazu se NIKDY
 * nedostalo. Build hlásil úspěch, protože přeskočení overlaye je legitimní stav
 * (community instalace bez značky). Rozdíl mezi „nechci overlay" a „chtěl jsem
 * ho, ale nedotekl" nebyl z ničeho poznat.
 *
 * ⭐ TÁŽ TŘÍDA, PÁTÝ VÝSKYT ZA DEN. Hodnota existuje, spotřebitel existuje,
 * a nikdo nespojil poslední článek:
 *   • `<prefix>-edge` nenasazovala žádná úloha
 *   • detektor změn na `edge` nic neposílal
 *   • `deploy-and-verify.sh` koukal na cizí seznam nasazení
 *   • `aisha-redeploy.mjs` měřil zdraví kontejneru
 *   • a tenhle ARG
 *
 * CO SE MĚŘÍ
 * ----------
 * Pro každou službu v `docker-compose.coolify*.yml`, která staví z Dockerfilu:
 * ARG deklarovaný v tom Dockerfilu, na kterém se soubor VĚTVÍ (objeví se
 * v podmínce vedle `FATAL`/`exit 1`), musí být v `build.args` té služby.
 *
 * Neměří se všechny ARG — spousta jich má rozumný default a na jejich prázdnotě
 * nic nestojí. Měří se jen ty, o kterých Dockerfile SÁM říká, že bez nich
 * odmítá pokračovat nebo tiše přeskočí funkci.
 *
 * ⛔ ŠESTÝ VÝSKYT, NAMĚŘENO 2026-09-13 — A BRÁNA HO NEVIDĚLA. Extranet
 * (`deploy/surface-host/Dockerfile`) se větví na `SURFACE_OVERLAY_GIT_URL`,
 * compose ho nepředával, build šel `if [ -n "" ]` → ENOENT. Obecné pravidlo
 * vyžadovalo hlášku „skipped" do 600 znaků od testu; povrch žádnou nepíše.
 * Změřeno nad celým stromem: stará heuristika nehlásila NIC v žádné z 87
 * stavějících služeb — ani původní svc-web-artifact („skipped" tam leží 26
 * řádků pod testem), ten držel jen jmenovitý test níž. Rozlišení je teď
 * strukturní (`scripts/lib/dockerfile-branaci-argy.mjs`), ne pravopisné.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { branaciArgy } from "../../../scripts/lib/dockerfile-branaci-argy.mjs";

const ROOT = process.cwd();

interface Sluzba {
  compose: string;
  sluzba: string;
  dockerfile: string;
  args: string[];
}

/** Služby, které staví z Dockerfilu, napříč všemi coolify compose soubory. */
function stavejiciSluzby(): Sluzba[] {
  const out: Sluzba[] = [];
  for (const f of readdirSync(ROOT).filter((x) => /^docker-compose\.coolify.*\.ya?ml$/.test(x))) {
    let doc: { services?: Record<string, { build?: { dockerfile?: string; args?: unknown } }> };
    try {
      doc = yaml.load(readFileSync(join(ROOT, f), "utf8")) as typeof doc;
    } catch {
      continue; // tvar souboru hlídají jiné brány
    }
    for (const [jmeno, svc] of Object.entries(doc?.services ?? {})) {
      const df = svc?.build?.dockerfile;
      if (!df) continue;
      const raw = svc.build?.args;
      const args = Array.isArray(raw)
        ? raw.map((x) => String(x).split("=")[0])
        : Object.keys((raw as Record<string, unknown>) ?? {});
      out.push({ compose: f, sluzba: jmeno, dockerfile: df, args });
    }
  }
  return out;
}

/**
 * ARG, bez jehož předání funkce NEJDE — tiše se vypne, nebo build padne.
 *
 * ⚠️ ZÚŽENO PO PRVNÍM BĚHU (a 2026-09-13 přestavěno). První verze brala každý
 * ARG poblíž `exit 1` a chytala `SKIP_I18N_CHECK` — opt-out se správným
 * defaultem. Brána, která křičí u bezpečného chování, se naučí ignorovat.
 * Tehdejší zúžení („jen když Dockerfile píše skipped") ale měřilo PRAVOPIS
 * hlášky a propustilo extranet, který nepíše nic (viz hlavička).
 *
 * `SKIP_I18N_CHECK` se od overlaye liší STRUKTURNĚ, dvakrát:
 *   · má NEPRÁZDNÝ default (`=false`) — nepředaný arg je zamýšlené chování,
 *   · Dockerfile porovnává HODNOTU (`!= "true"`), netestuje prázdnotu.
 * Hlásí se proto jen ARG s PRÁZDNÝM defaultem, jehož prázdnotu testuje RUN,
 * který se podle ní větví do `exit N` nebo do hlášky o přeskočení. Pravidlo
 * i jeho sondy: `scripts/lib/dockerfile-branaci-argy.mjs` a test níž.
 *
 * Změřený dopad na celý strom (2026-09-13, 62 Dockerfilů, 87 stavějících
 * služeb): hlásí se jen Dockerfile.keycloak, deploy/surface-host/Dockerfile
 * a services/svc-web-artifact/Dockerfile — tedy právě tři overlay klony;
 * `SKIP_I18N_CHECK` ani žádný jiný opt-out ne. Chybějící předání našla u
 * `extranet` (vada z hlavičky) a u `realm-sync` v keycloak stacku.
 */
function branaciArgyDockerfilu(dockerfile: string): string[] {
  const cesta = join(ROOT, dockerfile);
  if (!existsSync(cesta)) return [];
  return branaciArgy(readFileSync(cesta, "utf8")).map((x: { arg: string }) => x.arg);
}

describe("ARG, na kterém se Dockerfile větví, musí compose předat (brána)", () => {
  const sluzby = stavejiciSluzby();

  test("univerzum není prázdné — jinak je tvrzení níž vakuové", () => {
    expect(
      sluzby.length,
      "v žádném docker-compose.coolify*.yml se nenašla služba se `build.dockerfile` — parser přestal sedět"
    ).toBeGreaterThan(0);
  });

  test("svc-web-artifact dostává argy designového overlaye — regrese, kvůli které brána vznikla", () => {
    const s = sluzby.filter((x) => x.dockerfile.includes("svc-web-artifact"));
    expect(s.length, "svc-web-artifact se v žádném compose nestaví — brána ztratila předmět").toBeGreaterThan(0);
    for (const x of s) {
      // ⚠️ `AISHA_WEB_DESIGN_SUBDIR` je v seznamu ZÁMĚRNĚ, i když ho obecná
      // heuristika nechytí: jeho prázdná hodnota nic nepřeskočí, jen znamená
      // „vezmi kořen repa". Jenže když ho instance v env NASTAVÍ a do buildu
      // nedoteče, vezme se kořen — šablona bude prázdná (žádný index.html)
      // a do runtime obrazu poletí zdrojáky jazyka. Tichý ŠPATNÝ TVAR místo
      // tichého vypnutí; odhaleno mutací, obecné pravidlo ho propustilo.
      for (const arg of [
        "AISHA_WEB_DESIGN_GIT_URL",
        "AISHA_WEB_DESIGN_SUBDIR",
        "AISHA_SEED_DOMAIN",
        "AISHA_WEB_DESIGN_CACHEBUST",
      ]) {
        expect(
          x.args,
          `${x.compose} → ${x.sluzba}: chybí build arg ${arg}. Dockerfile se na něm VĚTVÍ — ` +
            `prázdná hodnota znamená „skipped, committed placeholder", takže značka instance ` +
            `nikdy nedoteče do obrazu a build to ohlásí jako úspěch.`
        ).toContain(arg);
      }
    }
  });

  test("extranet dostává argy instančního overlaye — vada z 2026-09-13", () => {
    const s = sluzby.filter((x) => x.dockerfile === "deploy/surface-host/Dockerfile");
    expect(s.length, "surface-host se v žádném compose nestaví — brána ztratila předmět").toBeGreaterThan(0);
    // Seznam se ODVOZUJE z Dockerfilu, nepíše: přibude-li větvení, přibude i tady.
    const branaci = branaciArgyDockerfilu("deploy/surface-host/Dockerfile");
    expect(branaci, "pravidlo přestalo vidět overlay povrchu — měřidlo je slepé").toEqual(
      expect.arrayContaining(["SURFACE_OVERLAY_GIT_URL", "SURFACE_OVERLAY_PATH", "SURFACE_OVERLAY_CACHEBUST"]),
    );
    for (const x of s) {
      for (const arg of branaci) {
        expect(
          x.args,
          `${x.compose} → ${x.sluzba}: chybí build arg ${arg}. Naměřeno 2026-09-13: Coolify ` +
            `„Added 30 ARG declarations", a přesto \`if [ -n "" ]\` → build z /app/instances/<jméno> → ENOENT.`,
        ).toContain(arg);
      }
    }
  });

  test("negativní sondy: pravidlo hlásí vstup funkce, ne bezpečný opt-out", () => {
    const hlasi = (df: string) => branaciArgy(df).map((x: { arg: string }) => x.arg);
    // Opt-out se smysluplným defaultem a porovnáním hodnoty (Dockerfile.web) — NE.
    expect(
      hlasi(
        'FROM x\nARG SKIP_I18N_CHECK=false\nRUN if [ "$SKIP_I18N_CHECK" != "true" ]; then \\\n' +
          '      npm run i18n:check || exit 1; \\\n    else echo "skipped"; fi\n',
      ),
      "SKIP_I18N_CHECK je bezpečný opt-out — brána, která křičí u něj, se naučí ignorovat",
    ).toEqual([]);
    // Prázdný default + test prázdnoty + exit, bez slova „skipped" (tvar povrchu) — ANO.
    expect(
      hlasi('FROM x\nARG URL=\nARG CESTA=\nRUN if [ -n "$URL" ]; then \\\n    [ -n "$CESTA" ] || { echo chyba; exit 1; }; \\\n  fi\n'),
    ).toEqual(["URL", "CESTA"]);
    // Prázdný default + test prázdnoty + hláška o přeskočení (tvar svc-web-artifact) — ANO.
    expect(hlasi('FROM x\nARG URL\nRUN if [ -z "${URL}" ]; then echo "overlay skipped"; else git clone "$URL" /t; fi\n')).toEqual([
      "URL",
    ]);
    // Test prázdnoty bez důsledku (ani exit, ani přeskočení) — NE.
    expect(hlasi('FROM x\nARG PRIZNAK=\nRUN if [ -n "$PRIZNAK" ]; then echo zapnuto; fi\n')).toEqual([]);
    // Neprázdný default (KC_THEME_OVERLAY_PATH=keycloak/themes) — NE: nepředaný arg má smysl.
    expect(hlasi('FROM x\nARG CESTA=keycloak/themes\nRUN [ -n "$CESTA" ] || exit 1\n')).toEqual([]);
    // ARG z jiné stage (FROM rozsah resetuje) — NE.
    expect(hlasi('FROM x AS a\nARG URL=\nFROM y\nRUN [ -n "$URL" ] || exit 1\n')).toEqual([]);
    // Shellová proměnná, ne ARG (token ze secretu) — NE.
    expect(hlasi('FROM x\nRUN T="$(cat /run/secrets/t)"; [ -n "$T" ] || exit 1\n')).toEqual([]);
    // Komentář uvnitř pokračování instrukci neukončí (Docker ho zahazuje) — ANO.
    expect(hlasi('FROM x\nARG URL=\nRUN if [ -n "$URL" ]; then \\\n# poznámka\n    exit 1; \\\n  fi\n')).toEqual(["URL"]);
  });

  test("žádná stavějící služba nezapomíná bránací ARG svého Dockerfilu", () => {
    const chybi: string[] = [];
    for (const s of sluzby) {
      for (const arg of branaciArgyDockerfilu(s.dockerfile)) {
        if (!s.args.includes(arg)) chybi.push(`${s.compose} → ${s.sluzba}: ${arg}`);
      }
    }
    expect(
      chybi,
      "tyhle služby staví z Dockerfilu, který se na daném ARGu VĚTVÍ (prázdná hodnota\n" +
        "vypne funkci nebo položí build), ale compose ten ARG nepředává — takže je při\n" +
        "každém buildu prázdný.\n" +
        "Naměřeno 2026-08-10 na svc-web-artifact: designové repo bylo v env nastavené\n" +
        "a do obrazu se NIKDY nedostalo, protože build blok neměl `args:`."
    ).toEqual([]);
  });
});
