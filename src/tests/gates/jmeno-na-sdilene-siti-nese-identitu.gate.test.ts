/**
 * Brána: jméno na SDÍLENÉ síti nese identitu instance
 *
 * Sousední brána `vnitrni-adresa-nese-identitu` hlídá literál `aisha-x` v
 * `environment:` a výslovně si vyhradila, že širší vadu — holé jméno SLUŽBY,
 * které je na sdílené síti globálním nárokem — neřeší, protože patří
 * k přejmenování služeb. Tenhle soubor je ta druhá půlka. Nezdvojuje ji:
 * tamta se ptá na LITERÁL identity, tahle na PÁR deklarace ↔ odkaz.
 *
 * ⛔ NAMĚŘENO 2026-08-16 živě (varra, docker network `coolify`):
 *
 *     db-w5vgq…      aliasy: [db, aisha-db]
 *     db-qosco…      aliasy: [db]            ← DVA nájemníci, jedno jméno
 *     redis ×2 · web ×2 · n8n-redis ×3 · registry-cache ×2 · svc-agent-runner ×2
 *
 * Coolify připojuje aplikace na SDÍLENOU síť `coolify` a Docker tam každé
 * službě přidá jako alias její KLÍČ V COMPOSE. Klíč identitu instance nenese,
 * takže stejné jméno nárokuje víc nájemníků najednou. Vestavěný DNS mezi
 * stejnojmennými ROUND-ROBINUJE — `postgresql://…@db:5432/…` z naší gateway
 * (která na té síti je) tedy může skončit u cizí databáze.
 *
 * PŘIDAT ALIAS NESTAČÍ. Holý klíč tam Docker dá vždycky a odebrat se nedá.
 * Jediná obrana je holé jméno NEPOUŽÍT.
 *
 * INVARIANT (dvě půlky, drží pár):
 *   1. žádný odkaz v hostitelské pozici nemíří na holý klíč služby,
 *   2. každé jméno `<prefix>-x` v hostitelské pozici má deklarovaný alias.
 *
 * Bez (2) by šlo (1) „splnit" přejmenováním odkazu na jméno, které nikdo
 * nezodpoví. Přesně tu vadu jsem 2026-08-16 vyrobil tím, že jsem přepsal
 * odkazy DŘÍV, než jsem deklaroval aliasy — 27 odkazů mířilo do prázdna a
 * kontrola „alias JE" to nechytila, protože hledala jméno kdekoli v souboru a
 * trefovala `container_name`, který Coolify zahazuje.
 *
 * PROČ SE PTÁME ORÁKULA A NE TEXTU: kotvy, `<<:` sloučení, inline `{}` i
 * `aliases: [...]` mění význam zápisu. Řádkový sken si to modeluje sám a dřív
 * nebo později odpoví na jinou otázku, než jakou dostal. Rozhoduje parser.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { PREDCASNI_CTENARI, predcasniCtenari } from "./lib/predcasny-ctenar";

const ROOT = process.cwd();
const ORAKULUM = path.join(ROOT, "scripts/compose-alias-oracle.sh");
const DOCTOR = path.join(ROOT, "scripts/cold-start-doctor.sh");

/** Řádky bez komentářů — zmínka v poznámce není zapojení. */
const kod = (text: string) =>
  text.split("\n").filter((r) => !/^\s*#/.test(r)).join("\n");

describe("brána: jméno na sdílené síti nese identitu instance", () => {
  it("orákulum existuje a je zapojené do doktora", () => {
    expect(existsSync(ORAKULUM), "scripts/compose-alias-oracle.sh chybí").toBe(true);
    expect(
      kod(readFileSync(DOCTOR, "utf8")),
      "doktor orákulum nevolá — nezavolaná kontrola je totéž jako žádná",
    ).toMatch(/compose-alias-oracle\.sh/);
  });

  it("obě orákula renderují TÝŽ dokument — sdíleným domovem", () => {
    // Kdyby si každé stavělo atrapy po svém, rozešly by se jim renderované
    // soubory a rozdíl by nikdo nezachytil: obě by hlásila zeleň nad jinou
    // skutečností. Proto jeden domov pro renderování.
    const DOMOV = path.join(ROOT, "scripts/lib/compose-render.sh");
    expect(existsSync(DOMOV), "scripts/lib/compose-render.sh chybí").toBe(true);
    for (const rel of ["scripts/compose-alias-oracle.sh", "scripts/compose-buildtime-oracle.sh"]) {
      expect(
        kod(readFileSync(path.join(ROOT, rel), "utf8")),
        `${rel} nepoužívá sdílené renderování — dvě měřidla nad jiným dokumentem`,
      ).toMatch(/compose-render\.sh/);
    }
    // Atrapa identity se NESMÍ překrývat s tvarem generických atrap: jinak by
    // každá hodnota vypadala jako prefixované jméno (naměřeno: 236 falešných).
    const domov = readFileSync(DOMOV, "utf8");
    const identita = domov.match(/COMPOSE_RENDER_PREFIX="\$\{COMPOSE_RENDER_PREFIX:-([a-z0-9-]+)\}"/);
    expect(identita, "atrapa identity se v domově nenašla").not.toBeNull();
    expect(
      domov,
      "generická atrapa má tvar `orakulum-<klíč>` — identita nesmí být `orakulum`",
    ).not.toMatch(/COMPOSE_RENDER_PREFIX:-orakulum\}/);
  });

  it("render je pro OTÁZKY, ne pro výrobu zdroje", () => {
    // Render je z atrap. `mesh-router` má `ipv4_address: ${MESH_DNS_RESOLVER_IP:?…}`
    // a v renderu je z toho `192.0.2.2`. Kdyby migrace generovala YAML zpátky
    // z renderu, zapsala by do repa atrapu — syntakticky v pořádku, takže by to
    // parser ani brány nechytily; projevilo by se to až špatnou adresou
    // resolveru v mesh.
    const prebuilt = readFileSync(path.join(ROOT, "docker-compose.coolify-prebuilt.yml"), "utf8");
    expect(
      prebuilt,
      "mesh-router přišel o pin adresy resolveru — atrapa z renderu přepsala zdroj",
    ).toMatch(/ipv4_address:\s*\$\{MESH_DNS_RESOLVER_IP/);
    for (const rel of [
      "docker-compose.coolify.yml",
      "docker-compose.coolify-prebuilt.yml",
      "docker-compose.coolify-domain-services.yml",
    ]) {
      const txt = readFileSync(path.join(ROOT, rel), "utf8");
      expect(txt, `${rel} obsahuje atrapu z renderu (192.0.2.x)`).not.toMatch(/192\.0\.2\.\d/);
      expect(txt, `${rel} obsahuje atrapu z renderu (orakulum-…)`).not.toMatch(/orakulum-[a-z]/);
    }
  });

  it("prefix je fail-loud — identita se nesmí uhodnout", () => {
    // ⛔ Kořen squattingu (#163): fork bez deklarované identity dosadil default
    // „aisha" a zabral jména platformy. `:?` z toho udělá hlasitý pád místo
    // tichého záboru. Odkaz s `:-` by tu vadu vrátil.
    const soubory = spawnSync("bash", ["-c", "ls docker-compose.coolify*.yml"], {
      cwd: ROOT, encoding: "utf8",
    }).stdout.trim().split("\n");
    const mekke: string[] = [];
    for (const f of soubory) {
      readFileSync(path.join(ROOT, f), "utf8").split("\n").forEach((r, i) => {
        if (/^\s*#/.test(r)) return;
        if (/\$\{APP_NAME_PREFIX:?-/.test(r) || /\$\{APP_NAME_PREFIX\}/.test(r)) {
          mekke.push(`${f}:${i + 1}`);
        }
      });
    }
    expect(
      mekke.length,
      "APP_NAME_PREFIX bez `:?` — identita by se dosadila výchozí hodnotou nebo prázdnem\n  " +
        mekke.join("\n  "),
    ).toBe(0);
  });

  it("orákulum běží a OBĚ vlastnosti platí", () => {
    const doma = spawnSync("bash", ["-c", "docker compose version && command -v jq"], {
      cwd: ROOT, encoding: "utf8",
    });
    if (doma.status !== 0) {
      // NEZMĚŘENO se NESMÍ tvářit jako úspěch — proto hlasitá poznámka.
      console.warn(
        "⚠ NEZMĚŘENO: docker/jq tu nejsou, orákulum jmen neběželo. " +
          "Zapojení ověřeno, vlastnost NE.",
      );
      return;
    }
    const r = spawnSync("bash", [ORAKULUM, "--json"], {
      cwd: ROOT, encoding: "utf8", timeout: 300_000, maxBuffer: 16 * 1024 * 1024,
    });
    if (r.error || r.signal || r.status === null) {
      console.warn(`⚠ NEZMĚŘENO: orákulum nedoběhlo (${r.error?.message ?? r.signal}).`);
      return;
    }
    if (r.status === 2) {
      console.warn(`⚠ NEZMĚŘENO: ${r.stderr?.trim()}`);
      return;
    }
    const vysledek = JSON.parse(r.stdout);

    // ⛔ DIAGNOSTIKA JEDE S KAŽDÝM BĚHEM (dohoda 2026-09-20). Když tahle brána
    // spadne na běhounu, není kam se podívat: běhouny jsou sdílená CI, ručně se
    // na nich nic nespouští, a API na logy je slepé. Čísla, ze kterých se pád
    // přečte NAPOPRVÉ, proto musí být ve výstupu samotné brány — jinak je příště
    // zase tři relace hledají nezávisle, každá z jiné strany.
    console.log(
      "orákulum (diagnostika): " +
        JSON.stringify({
          koren: vysledek.koren, koren_zdroj: vysledek.koren_zdroj,
          souboru_mereno: vysledek.souboru_mereno,
          jmen_deklarovanych: vysledek.jmen_deklarovanych, jmen_otisk: vysledek.jmen_otisk,
          odkazu_zkoumanych: vysledek.odkazu_zkoumanych,
          // Kandidáti jsou DRUHÁ strana porovnání. Shodný `jmen_otisk`
          // i `kandidatu_otisk` ⇒ verdikt MUSÍ vyjít stejně; když přesto
          // nevyjde, je vada v porovnání, ne ve vstupech.
          kandidatu: vysledek.kandidatu, kandidatu_otisk: vysledek.kandidatu_otisk,
          nezmereno_soubory: vysledek.nezmereno_soubory,
          osirele_jmena: vysledek.osirele_jmena, hole_jmena: vysledek.hole_jmena,
          // Bez provenience se u nálezu hádá ze vstupů. S ní je v logu rovnou
          // vidět, který soubor jméno přinesl — nebo že ho nepřinesl nikdo.
          osirele_provenience: vysledek.osirele_provenience,
        }),
    );

    // ⛔ NAMĚŘENO 2026-09-02: TÝŽ commit dal `fail, pass, pass`. Brána nebyla
    // flaky náhodou — počítala verdikt z NEÚPLNÉ unie. Když se soubor
    // nevyrenderoval, zmizely s ním jeho `aliases:`, ale odkazy na ně
    // zůstaly a spočítaly se jako nález; brána pak ukázala na cizí soubor.
    //
    // Selhání MĚŘENÍ se proto oddělilo od nálezu v repu a hlásí se první.
    // Orákulum v takovém případě vydá obě čísla jako `null` — kdyby vydalo 0,
    // tvářilo by se to jako čisté; kdyby vydalo N, jako vada v cizím souboru.
    expect(
      vysledek.nezmereno_vada,
      "NEZMĚŘENO, ne nález: render selhal u souboru, který overlay NENÍ.\n" +
        "Unie deklarovaných jmen je tím neúplná, takže odkazy nelze posoudit.\n" +
        "Je to porucha MĚŘENÍ (docker/prostředí), ne vada v repu.\n" +
        r.stderr,
    ).toBe(0);
    // Overlay unii nezmenšuje (nedeklaruje žádnou službu), takže se toleruje —
    // ale musí být VIDĚT, aby z něj nebyl tichý výmaz celé rodiny jmen.
    expect(
      typeof vysledek.nezmereno_overlay,
      "orákulum neodlišuje overlay od vady — starý tvar výstupu?",
    ).toBe("number");
    // Až teď smí být čísla posuzována. `null` by u `.toBe(0)` neprošlo, ale
    // hlásilo by vadu v repu — proto se tvrdí i TYP, ať je vidět pravý důvod.
    expect(typeof vysledek.hole_odkazy, "verdikt není číslo — unie neúplná").toBe("number");
    expect(typeof vysledek.osirele_odkazy, "verdikt není číslo — unie neúplná").toBe("number");
    expect(
      vysledek.hole_odkazy,
      "Odkaz na holé jméno služby. Na sdílené síti `coolify` to jméno nárokuje\n" +
        "i cizí nájemník a DNS mezi stejnojmennými round-robinuje.\n" +
        r.stderr,
    ).toBe(0);
    expect(
      vysledek.osirele_odkazy,
      "Odkaz na prefixované jméno, které žádné `aliases:` nedeklaruje —\n" +
        "takové jméno neresolvuje nikdo. Prefix bez deklarace je horší než\n" +
        "holé jméno: to aspoň někam vedlo.\n" +
        `jména: ${(vysledek.osirele_jmena ?? []).join(", ")}\n` +
        `neměřené soubory: ${(vysledek.nezmereno_soubory ?? []).join(", ")}\n` +
        r.stderr,
    ).toBe(0);
    // Nula měřených souborů by obě podmínky splnila triviálně.
    expect(Array.isArray(vysledek.osirele_jmena), "orákulum nevydává jména nálezů — brána by v CI neřekla, NA CO ukazuje").toBe(true);
    expect(
      vysledek.souboru_mereno,
      "orákulum neměřilo žádný soubor — nula není zelený štít",
    ).toBeGreaterThan(25);
  });
  // ⛔ NAMĚŘENO 2026-09-19: brána padala dál, jen pod zátěží, pokaždé s JINÝM
  // „osiřelým" jménem (svc-livekit, cosmos-node, gateway, db, n8n…). Render byl
  // přitom celý — soubor s aliasem vyšel shodně s čistým během (32 999 B, alias
  // v něm). Vadné bylo ČLENSTVÍ: `printf "$aliasy" | grep -qxF "$n"` pod
  // `pipefail`. grep najde jméno v prvním bloku zápisu a skončí, další zápis
  // printf dostane SIGPIPE (141) a pipefail z NALEZENÉHO jména udělá osiřelé.
  // Reprodukce pod zátěží 35–90 (6 souběžných orákul × 5 kol): 10 falešných
  // nálezů z 30; s herestringem 0. Jiná třída než jq výš — ta by vydala null.
  it("orákulum nemá rouru do čtenáře, který končí předčasně — pod pipefail z nalezeného udělá osiřelé", () => {
    const zdroj = readFileSync(ORAKULUM, "utf8");
    expect(zdroj, "orákulum už neběží pod pipefail? pak pravidlo přehodnoť").toMatch(/^set -[a-z]*o pipefail/m);
    // Slepení rour přes řádky a vzory předčasných čtenářů mají jeden domov
    // (lib/predcasny-ctenar.ts) — sdílí ho i ráčna nad celým scripts/.
    const nalezy = predcasniCtenari(zdroj).map((n) => n.radek);
    expect(nalezy, "roura do předčasně končícího čtenáře pod pipefail — použij herestring (`grep -q … <<< \"$x\"`)").toEqual([]);
  });

  it("detektor výš chytá i tvary, které řádková heuristika míjela", () => {
    // Tytéž vzory nad syntetickými řádky — jinak by „prázdný nález" mohl znamenat
    // jen slepý detektor. Tvary z review 2026-09-19.
    const vzory = PREDCASNI_CTENARI.map((p) => p.vzor);
    const tvary = [
      'printf "$x" | grep -q y', 'printf "$x" | grep -qxF y', 'printf "$x" | grep --quiet y',
      'printf "$x" | grep -E -q y', 'printf "$x" | grep y -q', 'printf "$x" | grep -m1 y',
      'printf "$x" | head -1', "printf \"$x\" | sed -n '1p;q'", "printf \"$x\" | awk '/y/{print; exit}'",
    ];
    for (const t of tvary) expect(vzory.some((v) => v.test(t)), t).toBe(true);
    expect(vzory.some((v) => v.test('grep -qxF "$n" <<< "$aliasy"')), "herestring není roura").toBe(false);
  });

  // Premisa pravidla výš, změřená TADY, ne převzatá: zapisovatel, který píše ještě
  // ve chvíli, kdy grep -q skončí, zemře a pipefail vrátí NENULU i pro NALEZENÉ
  // jméno. Obvykle 141 (SIGPIPE); se zděděně ignorovaným SIGPIPE (některé wrappery
  // a CI) je to 1 z EPIPE — falešné „osiřelé" vznikne tak jako tak, proto se
  // tvrdí jen „ne 0". `yes` píše donekonečna → deterministické i pod zátěží.
  it("premisa: roura do grep -q pod pipefail vrací nenulu i pro nalezené, herestring 0", () => {
    const roura = spawnSync("bash", ["-c", "set -o pipefail; yes | grep -qx y; echo $?"], { encoding: "utf8" });
    const here = spawnSync("bash", ["-c", 'set -o pipefail; x=$(printf "y\\nn\\n"); grep -qx y <<< "$x"; echo $?'], { encoding: "utf8" });
    expect(roura.stdout.trim(), "roura: grep jméno NAŠEL, přesto pipefail hlásí selhání").not.toBe("0");
    expect(here.stdout.trim(), "herestring: nalezené je nalezené").toBe("0");
  });

  // ⛔ NAMĚŘENO 2026-09-18: brána padala v CI 3× ze 4 („osiřelé" 2, pak 1), lokálně
  // nad TÝMŽ commitem 6× z 6 nula. Orákulum sbíralo aliasy smyčkou přes jq bez
  // kontroly výsledku: když jq u jednoho souboru selhal, jeho jména z unie tiše
  // zmizela a odkazy na ně se spočítaly jako NÁLEZ. Tady se to reprodukuje
  // deterministicky: dva syntetické compose soubory a jq, který u deklarujícího
  // souboru selže. Selhání vytěžení musí být NEZMĚŘENO, ne nález v repu.
  it("selhání jq při vytěžení aliasů je NEZMĚŘENO, ne falešný „osiřelý\" odkaz", () => {
    const doma = spawnSync("bash", ["-c", "docker compose version && command -v jq"], { cwd: ROOT, encoding: "utf8" });
    if (doma.status !== 0) {
      console.warn("⚠ NEZMĚŘENO: docker/jq tu nejsou, reprodukce vytěžení neběžela.");
      return;
    }
    const pravyJq = doma.stdout.trim().split("\n").pop() ?? "jq";
    const tmp = mkdtempSync(path.join(tmpdir(), "orakulum-jq-"));
    try {
      const sit = "networks:\n  internal:\n    external: true\n    name: ${APP_NAME_PREFIX:?identita}-shared-net\n";
      writeFileSync(path.join(tmp, "docker-compose.coolify.yml"),
        "services:\n  gateway:\n    image: alpine:3.20\n    networks:\n      internal:\n        aliases:\n" +
        "          - ${APP_NAME_PREFIX:?identita}-gateway\n" + sit);
      writeFileSync(path.join(tmp, "docker-compose.coolify-klient.yml"),
        "services:\n  klient:\n    image: alpine:3.20\n    environment:\n" +
        "      - API_URL=http://${APP_NAME_PREFIX:?identita}-gateway:3001\n    networks:\n      - internal\n" + sit);
      const bin = path.join(tmp, "bin");
      spawnSync("mkdir", ["-p", bin]);
      // jq, který selže PRÁVĚ při vytěžení aliasů z deklarujícího souboru.
      writeFileSync(path.join(bin, "jq"),
        `#!/bin/sh\ncase "$*" in *aliases*docker-compose.coolify.yml.json*) exit 5;; esac\nexec "${pravyJq}" "$@"\n`);
      chmodSync(path.join(bin, "jq"), 0o755);

      // ⛔ FIXTURA SE MUSÍ OPRAVDU ČÍST (naměřeno 2026-09-20). Do téhle opravy tu
      // stálo jen `cwd: tmp` — jenže orákulum si kořen odvozovalo z VLASTNÍ cesty
      // a `cd`lo do repozitáře, takže se fixtura NIKDY nečetla a „kontrolní běh
      // bez poruchy" měřil živý strom souběžně s ostatními branami. Verdikt pak
      // záležel na tom, co je zrovna v repu a v jakém prostředí se běží: táž
      // hlava (685fae7ac) dala v CI osiřelý odkaz a lokálně 4× nulu.
      const bez = spawnSync("bash", [ORAKULUM, "--json", "--root", tmp], { cwd: tmp, encoding: "utf8", timeout: 120_000 });
      const cisty = JSON.parse(bez.stdout);
      expect(cisty.osirele_odkazy, `kontrolní běh bez poruchy musí být čistý: ${bez.stderr}`).toBe(0);

      // A TVRZENÍ, ŽE SE MĚŘILA FIXTURA — jinak se vada vrátí tiše. Nestačí počet
      // souborů: nad prázdnou množinou by prošlo cokoli, proto i počty jmen a odkazů.
      expect(cisty.koren_zdroj, "orákulum si kořen odvodilo samo — fixtura se neměřila").toBe("predany");
      expect(cisty.koren, "měřil se jiný adresář než fixtura").toBe(tmp);
      expect(cisty.souboru_mereno, `měřila se fixtura? (repozitář má desítky souborů)\n${bez.stderr}`).toBe(2);
      expect(cisty.jmen_deklarovanych, "verdikt nad PRÁZDNOU množinou jmen není důkaz").toBeGreaterThan(0);
      expect(cisty.odkazu_zkoumanych, "verdikt nad PRÁZDNOU množinou odkazů není důkaz").toBeGreaterThan(0);

      const r = spawnSync("bash", [ORAKULUM, "--json", "--root", tmp], {
        cwd: tmp, encoding: "utf8", timeout: 120_000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      });
      const v = JSON.parse(r.stdout);
      expect(v.nezmereno_vada, `porucha vytěžení se musí hlásit jako NEZMĚŘENO\n${r.stderr}`).toBeGreaterThanOrEqual(1);
      expect(v.osirele_odkazy, "neúplná unie se NESMÍ počítat jako nález (null = nezměřeno)").toBeNull();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // ⛔ NEGATIVNÍ SONDA. Bez ní by „zelená" znamenala jen, že nic nespadlo:
  // dokud brána měřila živý strom místo fixtury, prošly by OBĚ varianty stejně
  // a nikdo by nepoznal, že měřidlo neměří. Fixtura se záměrnou vadou proto musí
  // dát ČERVENOU a ukázat na to jméno.
  it("NEGATIVNÍ SONDA: odkaz na nedeklarované jméno ve fixtuře musí dát nález", () => {
    const doma = spawnSync("bash", ["-c", "docker compose version && command -v jq"], { cwd: ROOT, encoding: "utf8" });
    if (doma.status !== 0) {
      console.warn("⚠ NEZMĚŘENO: docker/jq tu nejsou, negativní sonda neběžela.");
      return;
    }
    const tmp = mkdtempSync(path.join(tmpdir(), "orakulum-sonda-"));
    try {
      const sit = "networks:\n  internal:\n    external: true\n    name: ${APP_NAME_PREFIX:?identita}-shared-net\n";
      writeFileSync(path.join(tmp, "docker-compose.coolify.yml"),
        "services:\n  gateway:\n    image: alpine:3.20\n    networks:\n      internal:\n        aliases:\n" +
        "          - ${APP_NAME_PREFIX:?identita}-gateway\n" + sit);
      writeFileSync(path.join(tmp, "docker-compose.coolify-klient.yml"),
        "services:\n  klient:\n    image: alpine:3.20\n    environment:\n" +
        "      - API_URL=http://${APP_NAME_PREFIX:?identita}-gateway:3001\n" +
        "      - JINE=http://${APP_NAME_PREFIX:?identita}-nikdo-nedeklaruje:80\n" +
        "    networks:\n      - internal\n" + sit);

      const r = spawnSync("bash", [ORAKULUM, "--json", "--root", tmp], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
      const v = JSON.parse(r.stdout);
      expect(v.koren_zdroj, "sonda musí měřit fixturu, ne repozitář").toBe("predany");
      expect(v.souboru_mereno, "sonda musí měřit fixturu, ne repozitář").toBe(2);
      expect(v.osirele_odkazy, `odkaz na nedeklarované jméno musí být nález\n${r.stderr}`).toBe(1);
      expect(v.osirele_jmena, "nález musí pojmenovat, NA CO ukazuje").toContain("zkouskainstance-nikdo-nedeklaruje");
      // ⛔ POJMENOVAT NÁLEZ NESTAČÍ (naměřeno 2026-09-21): pět běhů CI ukázalo
      // pět RŮZNÝCH jmen a tři relace z toho hádaly příčinu ze vstupů, protože
      // orákulum neřeklo, KDO tu deklaraci měl přinést. Nález proto musí nést
      // provenienci a ta musí umět říct i „nepřinesl ji NIKDO".
      expect(v.osirele_provenience, "nález musí nést provenienci").toHaveLength(1);
      expect(
        v.osirele_provenience[0],
        "provenience musí pojmenovat odkazující soubor i to, že deklaraci nikdo nepřinesl",
      ).toMatch(/docker-compose\.coolify-klient\.yml.*NIKDO/);
      expect(v.kandidatu, "kandidáti = druhá strana porovnání, musí být změřená").toBeGreaterThan(0);
      expect(v.kandidatu_otisk, "otisk kandidátů musí vzniknout").not.toBe("neznamy");
      expect(r.status, "orákulum musí u nálezu skončit nenulově").toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

});
