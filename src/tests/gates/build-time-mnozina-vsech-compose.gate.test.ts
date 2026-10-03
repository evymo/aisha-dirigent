/**
 * Brána: build-time množina KAŽDÉHO compose — pokrytí, bezpečnost, rohatka
 *
 * Doplňuje `tajemstvi-nepatri-do-buildu`, která hlídá PRAVIDLO. Tahle hlídá jeho
 * VÝSLEDEK na všech souborech naráz — protože pravidlo může být správné a přesto
 * na jednom souboru selhat, a toho si nikdo nevšimne.
 *
 * ČTYŘI INVARIANTY, každý zavírá jinou cestu, jak to zase rozbít:
 *
 *  1. POKRYTÍ — každý compose se OPRAVDU změřil. Soubor, který odvození vrátí
 *     prázdný, není „nula tajemství", ale NEZMĚŘENO; bez téhle kontroly by se
 *     rozbité odvození tvářilo jako úspěch.
 *
 *  2. FAIL-CLOSED JE UVNITŘ — každé `${VAR:?}` musí v odvozené množině být.
 *     Compose na něm padá při parsování, takže vynechat ho neznamená menší
 *     expozici, ale ROZBITÝ DEPLOY. Tohle je ta strana, kde chyba stojí nasazení.
 *
 *  3. BUILDKIT SECRET NIKDY — klíč doručovaný přes `--mount=type=secret` se
 *     nesmí objevit v build-time množině. Jinak ho Coolify pošle i jako
 *     `--build-arg` a zapeče do `docker history` — přesně tím byla oprava #920
 *     tři hodiny po mergi bez účinku.
 *
 *  4. ROHATKA — počet tajemství v build-time množinách smí jen KLESAT.
 *     ⛔ NAMĚŘENO 2026-08-16: 83 → 71 → 67 → 61. Zbytek je tam kvůli `${SECRET:?}`
 *     uvnitř `environment:`; ta pojistka si hodnotu sama vynutí do buildu.
 *     Náhrada (read-back doručení v coolify-sync-envs.sh) už existuje, takže
 *     číslo má kam klesat — a rohatka drží, aby mezitím nerostlo.
 *
 *  5. ORÁKULUM JE ZAPOJENÉ — zúžení má DRUHOU stranu: vypadne-li z množiny
 *     klíč, který parser potřebuje, nasazení umře na "required variable X is
 *     missing a value". Rozhoduje o tom parser, ne úsudek, a doktor se ho musí
 *     ptát PŘED nasazením. Brána hlídá, že se ptá — a kde je docker, zkusí to
 *     sama.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

const ROOT = process.cwd();
const LIB = path.join(ROOT, "scripts/lib/coolify-buildtime-envs.sh");
const lib = readFileSync(LIB, "utf8");
/** Řádky bez komentářů — zmínka v poznámce není zapojení. */
const kod = (text: string) => text.split("\n").filter((r) => !/^\s*#/.test(r)).join("\n");

/**
 * ⛔ NAMĚŘENO 2026-08-16. Smí jen klesat — nikdy zvednout „aby to prošlo".
 * 2026-08-26: 61 → 60 po odstranění `docker-compose.coolify-shared.yml`
 * (MinIO se přestěhoval do jádra, jmenované účty neměly konzumenta).
 *
 * 2026-09-03: jedno číslo pro celý strom → baseline PER SOUBOR. Měřilo to
 * správnou věc, ale předpokládalo NEMĚNNOU množinu compose souborů: fork, který
 * přidá vlastní službu, nutně přidá i tajemství — a jediná cesta dál bylo zvednout
 * globální strop, čímž by se uvolnila i expozice všech ostatních souborů. Naměřeno
 * na forku: strom měřil 62 kvůli docker-compose.coolify-<fork>.yml
 * (dvě služby forku), o kterém upstreamová šedesátka nevěděla.
 * Per soubor se to přizná adresně a rohatka nad zbytkem stromu drží beze změny.
 */
const BASELINE_SOUBOR = path.join(ROOT, "src/tests/gates/build-time-tajemstvi.baseline.json");
const BASELINE_TAJEMSTVI: { $comment?: string; soubory: Record<string, number> } = JSON.parse(
  readFileSync(BASELINE_SOUBOR, "utf8"),
);
/**
 * Regenerace baseline konvencí repa (`AISHA_UPDATE_BASELINE=1`, viz
 * neznamy-prepinac-neni-vychozi-chovani): baseline je GENEROVANÝ otisk měření,
 * ne ručně psaný seznam — a do 2026-09-12 tu generátor nebyl, hlášky radily
 * čísla dopsat rukou. Ruční zápis je přesně ta cesta, kudy se rohatka tiše
 * zvedne. Regenerace rohatku NEZMĚKČUJE: přiznaný soubor smí jen klesnout
 * nebo zmizet, nový soubor se přidá (vědomý akt viditelný v diffu); pokus
 * o zvednutí existujícího čísla regenerace odmítne — to je regrese, ne
 * nový stav. Beze změny stromu je regenerace identická s uloženým souborem.
 */
const REGENERACE_PRIKAZ =
  "AISHA_UPDATE_BASELINE=1 npx vitest run --config vitest.gates.config.ts " +
  "src/tests/gates/build-time-mnozina-vsech-compose.gate.test.ts";
export function regenerujBaseline(
  namereno: Map<string, string[]>,
  baseline: Record<string, number>,
  komentar: string | undefined,
): { obsah: string; zvednute: string[] } {
  const zvednute = [...namereno.entries()]
    .filter(([soubor, taj]) => soubor in baseline && taj.length > baseline[soubor])
    .map(([soubor, taj]) => `${soubor}: ${taj.length} > ${baseline[soubor]}`);
  const soubory: Record<string, number> = {};
  for (const soubor of [...namereno.keys()].sort()) soubory[soubor] = namereno.get(soubor)!.length;
  const obsah = JSON.stringify({ ...(komentar ? { $comment: komentar } : {}), soubory }, null, 2) + "\n";
  return { obsah, zvednute };
}

const TAJEMSTVI = /(TOKEN|SECRET|PASSWORD|PASSWD|_PWD|APIKEY|API_KEY|_KEY$|_KEY_|PRIVATE|CREDENTIAL|SALT)/i;
const NENI_TAJEMSTVI = /(ANON_KEY|PUBLISHABLE|PUBLIC_KEY|_KEY_ID$|KEYCLOAK_REALM|_KEYS_DIR|KEY_ALGORITHM)/i;
const jeTajemstvi = (k: string) => TAJEMSTVI.test(k) && !NENI_TAJEMSTVI.test(k);

const composeSoubory = readdirSync(ROOT)
  .filter((f) => /^docker-compose\.coolify.*\.ya?ml$/.test(f))
  .sort();

/** Zavolá sdílenou bash funkci — jeden domov pravidla, i pro bránu. */
function odvozeneKlice(soubor: string): string[] {
  const r = spawnSync(
    "bash",
    ["-c", `. "${LIB}"; coolify_parse_required_keys "${soubor}" "[]"`],
    { cwd: ROOT, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
  );
  // Useknutý výstup zabitého procesu NENÍ měření — dnešní lekce, natvrdo.
  if (r.error || r.signal || r.status === null) {
    throw new Error(
      `odvození pro ${soubor} nedoběhlo: signal=${r.signal ?? "—"} ` +
        `error=${r.error ? (r.error as Error).message : "—"} status=${r.status}`,
    );
  }
  return (r.stdout ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
}

/**
 * Druhý zdroj build-time množiny: `ARG` v Dockerfilech, které ten compose
 * STAVÍ. V compose ta jména nejsou — Coolify je dodává tím, že klíč označí za
 * build-time (vkládá `ARG <KEY>` za každý `FROM`). Brána, která by měřila jen
 * compose, by měřila PODMNOŽINU a tvářila se přitom jako celek.
 */
function dockerArgKlice(soubor: string): string[] {
  const r = spawnSync(
    "bash",
    ["-c", `. "${LIB}"; coolify_dockerfile_arg_keys "${soubor}"`],
    { cwd: ROOT, encoding: "utf8", timeout: 60_000 },
  );
  if (r.error || r.signal || r.status === null) throw new Error(`ARG klíče pro ${soubor} nedoběhly`);
  return (r.stdout ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
}

function buildkitSecrety(soubor: string): string[] {
  const r = spawnSync(
    "bash",
    ["-c", `. "${LIB}"; coolify_buildkit_secret_keys "${soubor}"`],
    { cwd: ROOT, encoding: "utf8", timeout: 60_000 },
  );
  if (r.error || r.signal || r.status === null) throw new Error(`secrets pro ${soubor} nedoběhly`);
  return (r.stdout ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
}

/** Jména z `${VAR:?}` — compose na nich při parsování PADÁ. */
function failClosed(soubor: string): string[] {
  const text = readFileSync(path.join(ROOT, soubor), "utf8");
  return [...new Set([...text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*):\?/g)].map((m) => m[1]))];
}

const merene = composeSoubory.map((f) => {
  const zCompose = odvozeneKlice(f);
  const zDockerfilu = dockerArgKlice(f);
  return {
    soubor: f,
    odvozene: zCompose,
    dockerArgs: zDockerfilu,
    /** Co doopravdy poputuje do buildu — OBA odvozené zdroje, ne jen compose. */
    doBuildu: [...new Set([...zCompose, ...zDockerfilu])],
    secrets: buildkitSecrety(f),
    failClosed: failClosed(f),
  };
});

describe("brána: build-time množina všech compose", () => {
  it("měří se KAŽDÝ compose — prázdno je NEZMĚŘENO, ne nula", () => {
    expect(composeSoubory.length, "žádný compose se nenašel — brána by měřila prázdno").toBeGreaterThan(20);
    const nezmereno = merene.filter((m) => m.odvozene.length === 0).map((m) => m.soubor);
    expect(
      nezmereno,
      "u těchhle souborů odvození nevrátilo NIC. To není nula tajemství, ale rozbité\n" +
        "měření — a rozbité měření vypadá k nerozeznání od čistého výsledku:\n  " +
        nezmereno.join("\n  "),
    ).toEqual([]);
  });

  it("každé `${VAR:?}` je v odvozené množině — jinak se rozbije DEPLOY", () => {
    const chybi: string[] = [];
    for (const m of merene) {
      for (const k of m.failClosed) {
        if (!m.odvozene.includes(k)) chybi.push(`${m.soubor}: ${k}`);
      }
    }
    expect(
      chybi,
      "Compose na `${VAR:?}` při parsování PADÁ. Vynechat takový klíč z build-time\n" +
        "množiny neznamená menší expozici, ale required variable X is missing a value\n" +
        "při prvním deploji:\n  " + chybi.join("\n  "),
    ).toEqual([]);
  });

  it("klíč doručovaný jako BuildKit secret NENÍ v build-time množině", () => {
    const zapecene: string[] = [];
    for (const m of merene) {
      for (const k of m.secrets) {
        if (m.doBuildu.includes(k)) zapecene.push(`${m.soubor}: ${k}`);
      }
    }
    expect(
      zapecene,
      "Tenhle klíč bere Dockerfile přes `--mount=type=secret` PRÁVĚ PROTO, aby\n" +
        "neskončil v metadatech obrazu. Je-li zároveň build-time, Coolify ho pošle\n" +
        "i jako `--build-arg` a zapeče ho — oprava je tím bez účinku:\n  " +
        zapecene.join("\n  "),
    ).toEqual([]);
  });

  it("rohatka: tajemství v build-time množinách smí jen KLESAT", () => {
    // Měří se OBA odvozené zdroje. Do 2026-08-16 se měřil jen compose — a to
    // je podmnožina: Dockerfile může `ARG` čekat, aniž ho compose zmiňuje.
    const namereno = new Map<string, string[]>();
    for (const m of merene) {
      const taj = m.doBuildu.filter(jeTajemstvi);
      if (taj.length > 0) namereno.set(m.soubor, taj);
    }
    const baseline = BASELINE_TAJEMSTVI.soubory;

    if (process.env.AISHA_UPDATE_BASELINE === "1") {
      const { obsah, zvednute } = regenerujBaseline(namereno, baseline, BASELINE_TAJEMSTVI.$comment);
      expect(
        zvednute,
        "Regenerace by rohatku ZVEDLA — to není nový stav, ale regrese: nová hodnota\n" +
          "se dostala do buildu a zapekla by se do `docker history`. Nejdřív oprav\n" +
          "compose, pak regeneruj:\n  " + zvednute.join("\n  "),
      ).toEqual([]);
      writeFileSync(BASELINE_SOUBOR, obsah);
      return;
    }

    // 1) NOVÝ soubor s tajemstvím musí být přiznaný. Tohle je ta brána, kterou
    //    globální strop neuměl: dřív stačilo zvednout jedno číslo a nikdo se
    //    nedozvěděl, KTERÝ soubor expozici přinesl.
    const nepriznane = [...namereno.entries()]
      .filter(([soubor]) => !(soubor in baseline))
      .map(([soubor, taj]) => `  ${soubor}: ${taj.length} (${taj.join(", ")})`);
    expect(
      nepriznane,
      "Tenhle compose posílá tajemství do buildu a v baseline není — zapeče se\n" +
        "do `docker history`. Je-li to vědomé, přiznej ho regenerací baseline\n" +
        `(\`${REGENERACE_PRIKAZ}\`) — zápis viditelný v diffu, ne tichý růst;\n` +
        "baseline se nepíše rukou.\n" +
        nepriznane.join("\n"),
    ).toEqual([]);

    // 2) Přiznaný soubor nesmí RŮST.
    const rostlo = [...namereno.entries()]
      .filter(([soubor, taj]) => soubor in baseline && taj.length > baseline[soubor])
      .map(([soubor, taj]) => `  ${soubor}: ${taj.length} > ${baseline[soubor]} (${taj.join(", ")})`);
    expect(
      rostlo,
      "Rostlo to — nová hodnota se dostala do buildu a zapeče se do `docker history`.\n" +
        "Rohatku NEZVEDAT: je to dluh, který se splácí, ne strop, který se posouvá.\n" +
        rostlo.join("\n"),
    ).toEqual([]);

    // 3) Klesne-li to, rohatka se má utáhnout — jinak by povolila návrat zpět.
    //    Sem spadne i soubor, který z repa zmizel: záznam bez měření je stejná
    //    díra jako měření bez záznamu (0 < baseline).
    const kleslo = Object.entries(baseline)
      .map(([soubor, strop]) => ({ soubor, strop, ted: namereno.get(soubor)?.length ?? 0 }))
      .filter((x) => x.ted < x.strop)
      .map((x) => `  ${x.soubor}: ${x.ted} < ${x.strop} — utáhni na ${x.ted}` +
        (x.ted === 0 ? " (nebo záznam smaž, zmizel-li soubor)" : ""));
    expect(
      kleslo,
      "Kleslo to — utáhni baseline na naměřené hodnoty regenerací\n" +
        `(\`${REGENERACE_PRIKAZ}\`), jinak brána dovolí regresi zpátky na starou;\n` +
        "baseline se nepíše rukou:\n" + kleslo.join("\n"),
    ).toEqual([]);
  });

  it("negativní sonda: regenerace baseline utahuje a přidává, zvednout odmítne, a je deterministická", () => {
    const namereno = new Map<string, string[]>([
      ["b.yml", ["TOKEN_A"]], // v baseline 2 → klesá na 1
      ["a.yml", ["KEY_X", "KEY_Y"]], // nový soubor → přidá se
    ]);
    const { obsah, zvednute } = regenerujBaseline(namereno, { "b.yml": 2, "zmizel.yml": 3 }, "poznámka");
    expect(zvednute).toEqual([]);
    expect(JSON.parse(obsah)).toEqual({ $comment: "poznámka", soubory: { "a.yml": 2, "b.yml": 1 } });
    expect(obsah.endsWith("}\n")).toBe(true);
    expect(Object.keys(JSON.parse(obsah).soubory)).toEqual(["a.yml", "b.yml"]); // seřazeno → stabilní diff
    // Zvednutí existujícího čísla není nový stav, ale regrese — regenerace ho jmenuje.
    expect(regenerujBaseline(new Map([["b.yml", ["T1", "T2", "T3"]]]), { "b.yml": 2 }, undefined).zvednute).toEqual(["b.yml: 3 > 2"]);
    // Bez komentáře se `$comment` nevymýšlí.
    expect(Object.keys(JSON.parse(regenerujBaseline(new Map(), {}, undefined).obsah))).toEqual(["soubory"]);
  });

  it("`$$` se rozlišuje — escapovaný odkaz se neinterpoluje, tedy ani nepatří do buildu", () => {
    // ⛔ NAMĚŘENO 2026-08-16: pravidlo `$$` ZÁMĚRNĚ nerozlišovalo, s odůvodněním
    // „vynechat potřebný klíč stojí nasazení". U `$$` ta úvaha neplatí: compose
    // ho vydá jako literální `$` a hodnotu vůbec nehledá. Vynechat ho tedy
    // NEMŮŽE nic rozbít — zatímco zahrnout ho stálo `NB_SETUP_KEY` (6×),
    // `PKI_CLIENT_KEY_B64`, `NETBIRD_INTERNAL_KEY_B64` a
    // `OPENXPKI_OPERATOR_PASSWORD_HASH` v `docker history`. Pravidlo trestalo
    // compose napsaný přesně podle §3c COOLIFY_COMPOSE_RULES.
    const fn = lib.slice(lib.indexOf("coolify_parse_required_keys"));
    expect(fn, "chybí neutralizace `$$` — escapované odkazy by se počítaly").toMatch(
      /gsub\(\/\\\$\\\$\//,
    );

    // A měřitelně: klíč, který je v souboru JEN v escapované podobě, v množině být nesmí.
    const prohresky: string[] = [];
    for (const m of merene) {
      const text = readFileSync(path.join(ROOT, m.soubor), "utf8");
      for (const k of m.odvozene) {
        // Operátor interpolace je `:`, `?`, `-`, `+` nebo konec — `${X?…}` (povinná,
        // prázdno smí) je holý odkaz stejně jako `${X:?…}` (2026-09-15, port dveří).
        const holy = new RegExp(`(^|[^$])\\$\\{${k}[:?+}-]`, "m");
        const escapovany = new RegExp(`\\$\\$\\{${k}[:?+}-]`);
        if (!holy.test(text) && escapovany.test(text)) prohresky.push(`${m.soubor}: ${k}`);
      }
    }
    expect(
      prohresky,
      "Tyhle klíče jsou v souboru POUZE jako `$${…}` — compose je neinterpoluje,\n" +
        "čte je až skript uvnitř kontejneru z prostředí. V build-time množině nemají\n" +
        "co dělat:\n  " + prohresky.join("\n  "),
    ).toEqual([]);
  });

  it("`environment: &kotva` je pořád `environment:`", () => {
    // ⛔ NAMĚŘENO 2026-08-16: vzor hlídal jen holé `environment:` na konci
    // řádku. Kotvený blok v docker-compose.coolify.yml (`environment: &svc-env`)
    // tím spadl do větve „mimo environment" a POSTGRES_PASSWORD, REDIS_PASSWORD
    // i INTERNAL_API_KEY šly do buildu — jen proto, že ten blok má jméno.
    const fn = lib.slice(lib.indexOf("coolify_parse_required_keys"));
    expect(fn, "vzor pro `environment:` musí připouštět YAML kotvu").toMatch(
      /environment:\[ \]\*\(&\[A-Za-z0-9_\.-\]\+\)\?/,
    );

    // Měřitelně: v souboru, který kotvený blok má, nesmí být klíč, jehož JEDINÝ
    // výskyt je uvnitř něj.
    const jadro = merene.find((m) => m.soubor === "docker-compose.coolify.yml");
    expect(jadro, "docker-compose.coolify.yml se nenašel").toBeTruthy();
    const text = readFileSync(path.join(ROOT, "docker-compose.coolify.yml"), "utf8");
    expect(text, "předpoklad brány: soubor nese kotvený environment blok").toMatch(
      /environment:\s*&/,
    );
    for (const k of ["POSTGRES_PASSWORD", "INTERNAL_API_KEY"]) {
      expect(
        jadro!.odvozene,
        `${k} má v tomhle souboru všechny výskyty uvnitř \`environment:\` bloků ` +
          "(z nichž jeden je kotvený) — prázdno tam parse toleruje, takže do buildu nepatří",
      ).not.toContain(k);
    }
  });

  it("`ARG` z Dockerfilu je DRUHÝ zdroj — compose není celá pravda o buildu", () => {
    // ⛔ NAMĚŘENO 2026-08-16 živě, PŘED zápisem: zúžení podle samotného compose
    // by aplikaci `aisha-core` sebralo `GATEWAY_DOMAIN_PUBLIC`. V compose ten
    // klíč není — čeká ho `ARG GATEWAY_DOMAIN_PUBLIC=` v `Dockerfile.web`,
    // který ten stack staví, a Coolify ho dodává PRÁVĚ build-time příznakem.
    // Build by neselhal: ARG by dostal prázdnou výchozí hodnotu a zapekl by
    // prázdnou adresu. Tichá vada, kterou by nic nenahlásilo.
    expect(kod(readFileSync(LIB, "utf8")), "odvození z Dockerfile ARG musí být ZAPOJENÉ").toMatch(
      /coolify_dockerfile_arg_keys/,
    );
    const rozhodnuti = kod(lib).slice(kod(lib).indexOf("local parse_required"));
    expect(
      rozhodnuti.slice(0, 900),
      "`coolify_dockerfile_arg_keys` se musí SJEDNOTIT s odvozením z compose — " +
        "napsat funkci a nepoužít ji je totéž jako ji nemít",
    ).toMatch(/dockerargs/);

    // A měřitelně: aspoň jeden compose musí mít ARG klíč, který v něm sám není.
    const navic = merene
      .map((m) => ({ s: m.soubor, k: m.dockerArgs.filter((x) => !m.odvozene.includes(x)) }))
      .filter((x) => x.k.length > 0);
    expect(
      navic.length,
      "žádný Dockerfile nepřidal klíč mimo compose — buď se rozbilo hledání " +
        "`dockerfile:` v compose, nebo čtení ARG. Prázdno tu NENÍ důkaz, že " +
        "druhý zdroj není potřeba.",
    ).toBeGreaterThan(0);
  });

  it("orákulum je zapojené do doktora — a kde je docker, projde", () => {
    // Zúžení má dvě strany. Bezpečnostní stranu měří rohatka výš; TUHLE stranu —
    // „nevypadl klíč, který parser potřebuje?" — umí rozhodnout jen parser sám.
    // Musí se ptát PŘED nasazením, tedy z doktora; brána hlídá to zapojení,
    // protože nezavolaná kontrola je totéž jako žádná.
    const ORAKULUM = path.join(ROOT, "scripts/compose-buildtime-oracle.sh");
    expect(existsSync(ORAKULUM), "orákulum scripts/compose-buildtime-oracle.sh chybí").toBe(true);
    const doctor = readFileSync(path.join(ROOT, "scripts/cold-start-doctor.sh"), "utf8");
    expect(
      doctor.split("\n").filter((r) => !/^\s*#/.test(r)).join("\n"),
      "doktor orákulum nevolá — zmínka v komentáři zapojení není",
    ).toMatch(/compose-buildtime-oracle\.sh/);

    // Kde docker je, ptáme se rovnou. Kde není, je to NEZMĚŘENO (exit 2) —
    // a to se NESMÍ tvářit jako úspěch, proto se rozlišuje od exit 1.
    const doma = spawnSync("bash", ["-c", "docker compose version"], { cwd: ROOT, encoding: "utf8" });
    if (doma.status !== 0) {
      console.warn(
        "⚠ NEZMĚŘENO: docker CLI tu není, orákulum neběželo. " +
          "Zapojení do doktora ověřeno, dostatečnost množiny NE.",
      );
      return;
    }
    const r = spawnSync("bash", [ORAKULUM], {
      cwd: ROOT, encoding: "utf8", timeout: 300_000, maxBuffer: 16 * 1024 * 1024,
    });
    if (r.error || r.signal || r.status === null) {
      throw new Error(`orákulum nedoběhlo: signal=${r.signal ?? "—"} status=${r.status}`);
    }
    if (r.status === 2) {
      console.warn("⚠ NEZMĚŘENO: orákulum hlásí chybějící nástroj.");
      return;
    }
    const souhrn = (r.stdout ?? "").split("\n").filter((l) => l.startsWith("orákulum:")).pop() ?? "";
    expect(
      r.status,
      "Odvozená množina NESTAČÍ na parsování — v nasazení by z toho bylo\n" +
        "'required variable X is missing a value'. " + souhrn + "\n" +
        (r.stdout ?? "").split("\n").filter((l) => l.startsWith("✗") || /^ {4}/.test(l)).join("\n"),
    ).toBe(0);
  });
});
