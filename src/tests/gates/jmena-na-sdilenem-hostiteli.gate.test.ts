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
          jmena.add(m[1].trim().replace(/\$\{APP_NAME_PREFIX:\?[^}]*\}/g, prefix));
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
