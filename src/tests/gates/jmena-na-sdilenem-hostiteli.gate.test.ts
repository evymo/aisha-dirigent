/**
 * Jména na SDÍLENÉM HOSTITELI musí nést identitu instance — třídní brána
 *
 * ⛔ NAMĚŘENÝ INCIDENT. Jeden Coolify obsluhuje 164 aplikací šesti a víc
 * nájemníků. `container_name:` je jméno v jmenném prostoru CELÉHO DÉMONA,
 * ne stacku — dvě instance s `container_name: aisha-db` se o to jméno perou.
 * Kdo nabootuje druhý, dostane „Conflict. The container name is already in
 * use". A u síťových aliasů se to projevilo hůř než pádem: DNS na sdílené
 * síti `coolify` střídalo nájemníky, takže PKI mluvilo s cizí databází
 * a nikdy nenabootovalo.
 *
 * Invariant, který to vylučuje:
 *
 *     každé jméno viditelné démonovi obsahuje identitu instance
 *
 * Brána ho tvrdí STRUKTURÁLNĚ — hledá `${` v hodnotě, ne konkrétní prefix.
 * Nesmí pinovat adresu (jméno proměnné ani jméno instance): dvakrát dnes se
 * ukázalo, že brána pinující adresu spadne na neškodném přesunu a přitom
 * NEZACHYTÍ skutečnou vadu jinde.
 *
 * ROZSAH: jen soubory, které se nasazují na SDÍLENÉ stroje. Lokální stack
 * (`docker-compose.local*.yml`) běží na vlastním počítači vývojáře a má
 * vlastní jmenný prostor (`scripts/lib/local-stack-name.mjs`).
 *
 * VÝJIMKA `coolify`: sdílená ingress síť je sdílená ZÁMĚRNĚ — je to společný
 * vstupní bod, ne prostředek instance. Kdyby ji každý prefixoval, Traefik by
 * neviděl nikoho.
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const ROOT = process.cwd();

/** Compose soubory nasazované na SDÍLENÉ hostitele — odvozeno, ne vypsáno. */
function sdileneCompose(): string[] {
  const koren = readdirSync(ROOT).filter(
    (f) => /^docker-compose\.coolify.*\.ya?ml$/.test(f),
  );
  let deploy: string[] = [];
  try {
    deploy = readdirSync(join(ROOT, "deploy"))
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => `deploy/${f}`);
  } catch {
    /* adresář nemusí existovat */
  }
  return [...koren, ...deploy].sort();
}

/** Sdílená ingress síť — jediné jméno, které sdílené BÝT MÁ. */
const SDILENE_ZAMERNE = new Set(["coolify"]);

type Nalez = { soubor: string; kde: string; jmeno: string };

function literalniJmena(): Nalez[] {
  const nalezy: Nalez[] = [];
  for (const f of sdileneCompose()) {
    const text = readFileSync(join(ROOT, f), "utf-8");

    // container_name — jmenný prostor celého démona
    for (const m of text.matchAll(/^\s*container_name:\s*(\S.*?)\s*$/gm)) {
      const v = m[1].trim();
      if (!v.includes("${")) nalezy.push({ soubor: f, kde: "container_name", jmeno: v });
    }

    // explicitní `name:` u volumes/networks — taky jmenný prostor démona
    let doc: unknown;
    try {
      doc = parse(text);
    } catch {
      continue; // validitu YAML hlídá jiná brána
    }
    const d = doc as Record<string, Record<string, { name?: string }>> | null;
    for (const sekce of ["volumes", "networks"] as const) {
      for (const [klic, def] of Object.entries(d?.[sekce] ?? {})) {
        const jmeno = def?.name;
        if (typeof jmeno !== "string") continue;
        if (jmeno.includes("${")) continue;
        if (SDILENE_ZAMERNE.has(jmeno)) continue;
        nalezy.push({ soubor: f, kde: `${sekce}.${klic}.name`, jmeno });
      }
    }
  }
  return nalezy;
}

/**
 * Jak se proměnná ve JMÉNU odvozuje z identity instance — čteno ze zdrojů, ne opsáno:
 * generate-secrets (`emit('X', preservedValue('X', `${deployPrefix}…`))`) a kontrakt
 * env-doktora (`["X", "template", "${APP_NAME_PREFIX}…"]`). Proměnnou, kterou žádný
 * zdroj z identity neodvozuje, render ponechá jako KONSTANTU — dvě instance ji pak
 * sdílí a brána to ukáže (místo aby ji „nějaké ${…}“ omluvilo).
 */
function odvozeniZIdentity(): Map<string, string> {
  const m = new Map<string, string>([["APP_NAME_PREFIX", "«P»"]]);
  const gs = readFileSync(join(ROOT, "scripts/generate-secrets.mjs"), "utf-8");
  for (const x of gs.matchAll(/emit\('([A-Z0-9_]+)',\s*preservedValue\('\1',\s*`\$\{deployPrefix\}([^`]*)`\)\)/g)) {
    m.set(x[1], `«P»${x[2]}`);
  }
  const ed = readFileSync(join(ROOT, "scripts/aisha-env-doctor.mjs"), "utf-8");
  for (const x of ed.matchAll(/\["([A-Z0-9_]+)",\s*"template",\s*"\$\{APP_NAME_PREFIX\}([^"]*)"\]/g)) {
    m.set(x[1], `«P»${x[2]}`);
  }
  // Identita VLASTNÍKA vrstvy accel (ACCEL_OWNER_PREFIX — deklarace instance bez
  // náhrady, revize Guru k A2-1): rozlišuje jména na démonu stejně jako prefix
  // instance, viz test „dvě různé identity“ níž, který ji nahrazuje týmž tvarem.
  // Žádný zdroj ji z identity NEODVOZUJE (nesmí: svazek vah a firewall hostitele
  // patří vlastníkovi vrstvy, ne instanci), proto se doplňuje výslovně — bez toho
  // by vrstva vypadala jako jméno sdílené dvěma forky (sloučení A2-2 × umisteni-gpu).
  m.set("ACCEL_OWNER_PREFIX", "«P»-vrstva");
  return m;
}

type Render = { demon: Set<string>; site: Map<string, Set<string>>; souboru: Set<string> };

/**
 * Vyrenderuje sdílené compose pro jednu identitu: jména v jmenném prostoru DÉMONA
 * (container_name, explicitní `name:` svazků a sítí, externí síť bez jména = klíč)
 * a aliasy po VYRENDEROVANÉM jménu sítě. Alias koliduje jen na síti, kterou dvě
 * instance opravdu sdílí — proto se aliasy klíčují jménem sítě, ne klíčem v souboru.
 */
function vyrenderuj(identita: string, odvozeni: Map<string, string>): Render {
  const dosad = (v: string) =>
    v.replace(/\$\{([A-Z0-9_]+)(?:[:]?[-?][^}]*)?\}/g, (_, jm: string) =>
      odvozeni.has(jm) ? odvozeni.get(jm)!.replace("«P»", identita) : `«${jm}»`);
  const r: Render = { demon: new Set(), site: new Map(), souboru: new Set() };
  for (const f of sdileneCompose()) {
    let d: Record<string, Record<string, Record<string, unknown>>> | null;
    try {
      d = parse(readFileSync(join(ROOT, f), "utf-8"));
    } catch {
      continue;
    }
    r.souboru.add(f);
    const jmenoSite = new Map<string, string>();
    for (const [klic, def] of Object.entries(d?.networks ?? {})) {
      const n = (def as { name?: string; external?: boolean } | null) ?? {};
      const jmeno = typeof n.name === "string" ? dosad(n.name) : n.external ? klic : null;
      if (jmeno) { jmenoSite.set(klic, jmeno); r.demon.add(`síť ${jmeno}`); }
    }
    for (const def of Object.values(d?.volumes ?? {})) {
      const n = (def as { name?: string } | null)?.name;
      if (typeof n === "string") r.demon.add(`svazek ${dosad(n)}`);
    }
    for (const sluzba of Object.values(d?.services ?? {})) {
      const sv = sluzba as { container_name?: string; networks?: unknown };
      if (typeof sv?.container_name === "string") r.demon.add(`kontejner ${dosad(sv.container_name)}`);
      if (!sv?.networks || Array.isArray(sv.networks)) continue;
      for (const [klic, cfg] of Object.entries(sv.networks as Record<string, { aliases?: string[] } | null>)) {
        const sit = jmenoSite.get(klic);
        if (!sit) continue; // síť projektu (bez jména) je per aplikace — alias tam nikomu cizímu nekoliduje
        const s = r.site.get(sit) ?? new Set<string>();
        for (const al of cfg?.aliases ?? []) s.add(dosad(String(al)));
        r.site.set(sit, s);
      }
    }
  }
  return r;
}

describe("jména na sdíleném hostiteli nesou identitu instance", () => {
  test("sonda má co měřit — compose soubory existují a jména v nich jsou", () => {
    const soubory = sdileneCompose();
    expect(soubory.length, "žádný sdílený compose — brána by tvrdila prázdno").toBeGreaterThan(10);
    const vsechna = soubory.flatMap((f) => [
      ...readFileSync(join(ROOT, f), "utf-8").matchAll(/^\s*container_name:/gm),
    ]);
    expect(vsechna.length, "žádné container_name — brána by tvrdila prázdno").toBeGreaterThan(50);
  });

  test("žádné literální jméno v jmenném prostoru démona", () => {
    const nalezy = literalniJmena();
    expect(
      nalezy.map((n) => `${n.soubor} → ${n.kde} = ${n.jmeno}`),
      "Tahle jména vidí docker démon GLOBÁLNĚ, takže je dvě instance na jednom " +
        "stroji sdílejí. Vlož identitu instance: `${APP_NAME_PREFIX:?…}-<účel>`.",
    ).toEqual([]);
  });

  test("dvě různé identity nesdílejí ANI JEDNO jméno", () => {
    // Vlastní důkaz invariantu: vyrenderuj tytéž soubory pro dvě identity
    // a spočítej průnik. Tohle chytí i vadu, kterou test výš minout může —
    // třeba prefix, který se do jména dostane, ale nerozliší (konstanta).
    const render = (prefix: string) => {
      const jmena = new Set<string>();
      for (const f of sdileneCompose()) {
        const text = readFileSync(join(ROOT, f), "utf-8");
        for (const m of text.matchAll(/^\s*container_name:\s*(\S.*?)\s*$/gm)) {
          // Identita instance — a identita akcelerační vrstvy (ACCEL_OWNER_PREFIX, deklarace
          // vlastníka vrstvy; revize Guru k A2-1): obě rozlišují jména na démonu. Druhou
          // render nahrazuje taky, jinak by vrstva vypadala jako sdílené jméno.
          jmena.add(
            m[1]
              .trim()
              .replace(/\$\{APP_NAME_PREFIX:\?[^}]*\}/g, prefix)
              .replace(/\$\{ACCEL_OWNER_PREFIX(?::\?[^}]*)?\}/g, `${prefix}-vrstva`),
          );
        }
      }
      return jmena;
    };
    const a = render("instancea");
    const b = render("instanceb");
    expect(a.size, "render nevydal žádná jména").toBeGreaterThan(50);
    const prunik = [...a].filter((x) => b.has(x));
    expect(
      prunik,
      `${prunik.length} jmen by dvě instance na jednom hostiteli sdílely`,
    ).toEqual([]);
  });

  test("dva forky na jednom hostiteli (sdílený GPU stroj): démon, sítě i aliasy na společné síti disjunktní", () => {
    // Kontrakt d8 U7 a 0c (a)–(d): na GPU stroji poběží stacky víc forků vedle sebe,
    // opt-in model včetně (univerzum = VŠECHNY sdílené compose, žádná lane ho nevyřadí).
    // Měří se render dvou identit, ne přítomnost `${`: konstanta za `${…}` by prošla.
    const odvozeni = odvozeniZIdentity();
    expect(odvozeni.size, "ze zdrojů se neodvodila žádná proměnná kromě prefixu — měřidlo osiřelo").toBeGreaterThan(3);
    const a = vyrenderuj("forka", odvozeni);
    const b = vyrenderuj("forkb", odvozeni);
    expect(a.souboru.has("docker-compose.coolify-model.yml"), "stack modelu chybí v univerzu").toBe(true);
    expect([...a.demon].some((j) => j.startsWith("kontejner forka-svc-model")), "kontejner modelu se nevyrenderoval s identitou").toBe(true);

    const spolecne = [...a.demon].filter((j) => b.demon.has(j));
    const nevedome = spolecne.filter((j) => !SDILENE_ZAMERNE.has(j.replace(/^síť /, "")));
    expect(nevedome.sort(), "tahle jména by dva forky na jednom démonu sdílely").toEqual([]);

    // Sítě, které obě instance OPRAVDU sdílí (dnes jen ingress `coolify`): aliasy
    // na nich musí být disjunktní, jinak DNS střídá nájemníky (36821f71b).
    const sdileneSite = [...a.site.keys()].filter((n) => b.site.has(n));
    expect(sdileneSite.every((n) => SDILENE_ZAMERNE.has(n)), `sdílená síť mimo výjimku: ${sdileneSite.join(", ")}`).toBe(true);
    const kolize = sdileneSite.flatMap((n) => [...a.site.get(n)!].filter((al) => b.site.get(n)!.has(al)).map((al) => `${n}: ${al}`));
    expect(kolize.sort(), "aliasy na síti sdílené mezi forky").toEqual([]);

    // Kotva: táž identita dvakrát = kolize všude. Bez ní „disjunktní“ nedokazuje nic.
    const a2 = vyrenderuj("forka", odvozeni);
    expect([...a2.demon].filter((j) => a.demon.has(j)).length).toBe(a.demon.size);
  });

  test("sdílená ingress síť ZŮSTÁVÁ sdílená (výjimka je vědomá, ne opomenutí)", () => {
    // Kdyby ji někdo „opravil" prefixem, Traefik přestane vidět kohokoli.
    const sIngress = sdileneCompose().filter((f) => {
      const d = (() => {
        try {
          return parse(readFileSync(join(ROOT, f), "utf-8")) as Record<
            string,
            Record<string, { name?: string }>
          >;
        } catch {
          return null;
        }
      })();
      return Object.values(d?.networks ?? {}).some((n) => n?.name === "coolify");
    });
    expect(
      sIngress.length,
      "žádný compose už nedeklaruje sdílenou ingress síť `coolify` — " +
        "buď se přejmenovala (a Traefik nikoho nevidí), nebo zmizela",
    ).toBeGreaterThan(5);
  });
});
