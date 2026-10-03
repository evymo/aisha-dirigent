/**
 * Brána: do buildu jde jen to, co compose při parsování potřebuje
 *
 * INVARIANT: `is_buildtime` se nesmí rozdávat plošně. Build arg se zapisuje do
 * metadat obrazu — `docker history` ho vydá komukoli, kdo na obraz dosáhne,
 * a napořád.
 *
 * ⛔ NAMĚŘENO 2026-08-15/16 živě přes Coolify API napříč 33 aplikacemi:
 *
 *     do buildu jde 913 hodnot navíc, z toho 244 tajemství
 *     nejhorší: aisha-registry — 158 tajemství v aplikaci, která je JEN PROXY
 *
 * PŘÍČINA NENÍ NEDBALOST: `is_buildtime` řídí DVĚ věci najednou —
 *   (1) hodnota se dostane do `build-time.env` pro INTERPOLACI COMPOSE,
 *   (2) Coolify vloží `ARG <KEY>` za každý `FROM`, čímž ji zapeče do obrazu.
 * Chceme (1), ne (2). Proto v normalizaci stálo `else true`: raději vše, než
 * aby deploy umřel na „required variable X is missing a value".
 *
 * TŘI VĚCI SE HLÍDAJÍ, protože každá může vadu vrátit jinudy:
 *   1. plošné `else true` je pryč a nahradilo ho ODVOZENÍ,
 *   2. odvození je TRANZITIVNÍ — `REGISTRY_PROXY` v compose není, žije uvnitř
 *      hodnoty `IMAGE_*`; bez uzávěru by deploy spadl,
 *   3. ruční seznam zůstává jako PODLAHA — je to kronika incidentů, ne ozdoba.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

const ROOT = process.cwd();
const LIB = path.join(ROOT, "scripts/lib/coolify-buildtime-envs.sh");
const DOCTOR = path.join(ROOT, "scripts/cold-start-doctor.sh");
const lib = readFileSync(LIB, "utf8");
const doctor = readFileSync(DOCTOR, "utf8");

/** Řádky bez komentářů — zmínka v poznámce není zapojení. */
const kod = (text: string) =>
  text
    .split("\n")
    .filter((r) => !/^\s*#/.test(r))
    .join("\n");

describe("brána: tajemství nepatří do buildu", () => {
  it("plošné `else true` je pryč — build-time se ODVOZUJE", () => {
    // Podpis staré větve: v jq se pro ne-web aplikace vracelo natvrdo `true`.
    expect(
      kod(lib),
      "plošné `else true` vrací KAŽDÝ klíč do buildu, tedy i tajemství — " +
        "to je přesně ta vada, kterou tahle brána zavírá",
    ).not.toMatch(/then\s*\(\s*\$env\.key\s*\|\s*test\(\$buildtime_regex\)\)\s*\n\s*else\s+true/);
    expect(kod(lib), "odvození musí být zapojené, ne jen napsané").toMatch(/parse_required/);
  });

  it("odvození je TRANZITIVNÍ přes hodnoty", () => {
    // `REGISTRY_PROXY` se v žádném compose nevyskytuje — žije uvnitř hodnoty
    // `IMAGE_NETBIRD=${REGISTRY_PROXY}netbirdio/netbird:…`. Jedno kolo skenu ho
    // nenajde a deploy pak umře na prázdném `image:`.
    const fn = lib.slice(lib.indexOf("coolify_parse_required_keys"));
    expect(fn, "bez fixního bodu se najde jen první úroveň odkazů").toMatch(/uzavri|closure|fixn/i);
    expect(fn, "uzávěr musí číst HODNOTY, ne jen jména").toMatch(/\$hodnoty|\.value/);
  });

  it("ruční seznam zůstává PODLAHOU, ne náhradou", () => {
    // Ten seznam je kronika incidentů: každá položka je deploy, který umřel na
    // „required variable X is missing a value". Odvození ze souboru nemusí
    // vidět klíč, který si vyžádá override — proto sjednocení, ne nahrazení.
    expect(lib, "regex s ručním seznamem musí zůstat").toMatch(/coolify_buildtime_key_regex/);
    expect(
      kod(lib),
      "odvozené i seznam se musí SPOJIT (or), jinak by zúžení shodilo deploy",
    ).toMatch(/IN\(\$parse_required\[\]\).*or.*test\(\$buildtime_regex\)/s);
  });

  it("neodvozené se hlásí NAHLAS — tichý návrat k plné expozici je horší než vada", () => {
    // Nepodaří-li se odvodit (chybí compose, nečitelné API), chová se to jako
    // dřív. To je bezpečné, ale k NEROZEZNÁNÍ od úspěchu — proto varování.
    expect(kod(lib)).toMatch(/nepodařilo se odvodit/);
  });

  it("BuildKit secret NIKDY není build-time — jinak je #920 bez účinku", () => {
    // ⛔ NAMĚŘENO 2026-08-16: #920 přesunul FORGEJO_TOKEN a SENTRY_AUTH_TOKEN
    // na `--mount=type=secret`, ale env metadata zůstala nedotčená:
    //     FORGEJO_TOKEN      core, keycloak → build-time (větev `else true`)
    //     SENTRY_AUTH_TOKEN  core           → build-time (větev `else true`)
    //     SENTRY_AUTH_TOKEN  edge           → build-time (ruční seznam!)
    // Coolify jim tedy DÁL vkládal `ARG` za každý `FROM` a předával je jako
    // `--build-arg`. Dockerfily se změnily, cesta doručení ne — oprava byla
    // bez účinku na každé aplikaci, která s těmi tokeny staví.
    expect(lib, "chybí odvození klíčů doručovaných jako BuildKit secret").toMatch(
      /coolify_buildkit_secret_keys/,
    );
    // Zákaz musí být PRVNÍ větev — jinak ho ruční seznam nebo `else true` přebije.
    const rozhodnuti = kod(lib).slice(kod(lib).indexOf("| (if "));
    expect(
      rozhodnuti.slice(0, 400),
      "zákaz pro BuildKit secrets musí přebít VŠECHNO ostatní, tedy stát první",
    ).toMatch(/IN\(\$buildkit_secrets\[\]\)[\s\S]*?then false/);

    // A odvozuje se ze zdroje pravdy — z compose, ne z výčtu jmen.
    const fn = lib.slice(lib.indexOf("coolify_buildkit_secret_keys"));
    expect(fn, "seznam secret klíčů se čte z compose `secrets:`, nevypisuje").toMatch(
      /secrets:|environment:/,
    );
  });

  it("doktor NEJEN měří, ale i DOPORUČUJE — číslo bez dalšího kroku je výčitka", () => {
    // Fáze X uměla říct „do buildu jde 856 hodnot navíc, z toho 237 tajemství".
    // To je pravda a je k nezaplacení — ale operátorovi to neřekne, co s tím.
    // Zvlášť nepozná POŘADÍ, které je tu závazné: read-back → pojistka u
    // spotřeby → teprve passthrough. Obrátit ho znamená účet bez použitelného
    // hesla, a rohatka to ohlásí jako zlepšení.
    expect(
      kod(doctor),
      "doktor musí volat generátor plánu — zmínka v komentáři není zapojení",
    ).toMatch(/buildtime-remediation-plan\.mjs/);
    expect(
      doctor,
      "doporučení musí nést i pořadí kroků, ne jen počty",
    ).toMatch(/TEPRVE PAK passthrough|pojistka u spotřeby/i);
  });

  it("doktor hlásí DVĚ NAŠE aplikace téhož jména", () => {
    // ⛔ OPRAVENO 2026-08-16, tatáž hodina. Původní znění téhle brány zamykalo
    // ŠPATNOU diagnózu: tvrdilo, že sync jednu z dvojice nikdy neosloví. Měření
    // to vyvrátilo — sync se ptá podle PROJEKTU a obsloužil všech 32 NAŠICH
    // aplikací správně. Ta 33. byla `aisha-registry` z cizího projektu `a1sh4`;
    // do našich čísel ji přitáhl doktor tím, že si flotilu vybíral podle prefixu
    // jména. Identitu na sdíleném Coolify nese projekt, ne jméno — hlídá to
    // `nase-aplikace-maji-jednu-odpoved.gate.test.ts`.
    //
    // Co ZŮSTÁVÁ v platnosti: `local-ingest` má opravdu dvě aplikace
    // v NAŠEM projektu (#165), a ty se perou o tytéž aliasy i jména kontejnerů
    // na sdíleném hostiteli. To je FAIL, ne poznámka.
    expect(kod(doctor), "chybí detekce duplicitních jmen v našem projektu").toMatch(
      /coolify_duplicate_app_names/,
    );
    expect(
      doctor,
      "duplicitní jméno uvnitř našeho projektu musí být FAIL",
    ).toMatch(/fail "\[\$_dn\] DVĚ NAŠE aplikace/);
  });

  it("plán nápravy TŘÍDÍ podle toho, co jde udělat teď — ne jen vypisuje", () => {
    const PLAN = path.join(ROOT, "scripts/buildtime-remediation-plan.mjs");
    expect(existsSync(PLAN), "generátor plánu chybí").toBe(true);
    const plan = readFileSync(PLAN, "utf8");
    for (const trida of ["PRIPRAVENO", "CHYBI_POJISTKA", "CIZI_SPOTREBITEL"]) {
      expect(plan, `chybí třída ${trida} — bez ní by 58 položek vypadalo jako 58 stejných úkonů`).toContain(trida);
    }
    // „Připraveno" NESMÍ znamenat jen „má :?" — musí to znamenat, že pojistka
    // u spotřeby existuje. Jinak by plán doporučoval otevřít tichou díru.
    expect(
      plan,
      "PŘIPRAVENO se musí opírat o existující pojistku (hlidana), ne o pouhý výskyt ${VAR:?}",
    ).toMatch(/every\(\(m\) => m\.hlidana\)/);
    // A klasifikace musí být ODVOZENÁ z compose, ne vypsaná.
    expect(plan, "třídy se musí odvozovat ze souboru, ne ze seznamu jmen").toMatch(
      /startovaciSkript|hlidana\(/,
    );
  });

  it("doktor tu expozici MĚŘÍ — jinak zůstane neviditelná", () => {
    // Vada se stala neviditelnou tím, že se na ni nikdo neptal: hodnota se
    // doručí, deploy je zelený, obraz běží. Číslo musí být vidět mezi běhy.
    expect(doctor, "chybí fáze, která expozici měří").toMatch(/should_run_phase X/);
    expect(doctor, "doktor musí umět říct i NEZMĚŘENO, ne mlčet").toMatch(/NEZMĚŘENA/);
    expect(
      doctor,
      "měří se přes sdílenou funkci, ne vlastní kopií pravidla",
    ).toMatch(/coolify_parse_required_keys/);
  });
});
