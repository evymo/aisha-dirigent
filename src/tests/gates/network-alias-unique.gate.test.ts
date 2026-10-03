/**
 * Gate: jeden network alias smí deklarovat JEN JEDEN compose.
 *
 * PROČ (2026-07-29)
 * ----------------
 * `svc-blockchain` byl definovaný ve dvou compose — v cosmos a v
 * domain-services — ze stejného Dockerfile, a OBA nesly alias `svc-blockchain`.
 * Docker v takovém případě odpovídá střídavě.
 *
 * Změřeno na živé instalaci: čtyři DNS dotazy ze svc-ai-chat vrátily
 * 172.18.0.63, pak třikrát 172.18.0.29 — dva různé buildy (11555f9a vs
 * c28d5755) pod jedním jménem.
 *
 * A ta druhá kopie měla JEDINOU proměnnou (PORT: 3013): žádnou databázi,
 * autentizaci ani spojení na cosmos-node. Zhruba polovina volání tedy mířila
 * na kontejner, který nemohl nic obsloužit — navenek „občas to nejde",
 * bez jakékoli souvislosti s příčinou a bez jediné chyby v logu toho, kdo volal.
 *
 * Alias je JMÉNO SLUŽBY na sdílené síti. Dvě služby na jednom jméně není stav,
 * který by šlo doladit konfigurací; je to nedeterminismus, a ten se dá vyloučit
 * staticky.
 *
 * CO SE NEPOČÍTÁ ZA KOLIZI
 * -----------------------
 * Týž alias vícekrát v TÉMŽE souboru (blue/green varianty jedné služby sdílejí
 * jméno záměrně) — kolize je až mezi RŮZNÝMI compose.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");

/** Univerzum ze SKUTEČNOSTI (soubory na disku), ne z ručního výčtu. */
function composeFiles(): string[] {
  return readdirSync(ROOT).filter((f) => /^docker-compose\.coolify.*\.ya?ml$/.test(f));
}

function aliasesOf(file: string): Set<string> {
  const text = readFileSync(resolve(ROOT, file), "utf8");
  const out = new Set<string>();
  for (const m of text.matchAll(/aliases:\s*\n((?:\s+-\s+[^\n]+\n)+)/g)) {
    for (const line of m[1].trim().split("\n")) {
      const a = line.trim().replace(/^-\s*/, "").replace(/^["']|["']$/g, "");
      if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(a)) out.add(a);
    }
  }
  for (const m of text.matchAll(/aliases:\s*\[([^\]]+)\]/g)) {
    for (const raw of m[1].split(",")) {
      const a = raw.trim().replace(/^["']|["']$/g, "");
      if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(a)) out.add(a);
    }
  }
  return out;
}

/** Katalog: která služba podle deklarace bydlí ve kterém compose. */
function catalogHomes(): Map<string, string> {
  const { services } = JSON.parse(
    readFileSync(resolve(ROOT, "config/services.json"), "utf8"),
  ) as { services: Record<string, { compose?: string }> };
  const homes = new Map<string, string>();
  for (const [id, svc] of Object.entries(services)) if (svc.compose) homes.set(id, svc.compose);
  return homes;
}

describe("network aliasy", () => {
  it("univerzum se seeduje ze skutečnosti a není prázdné", () => {
    const files = composeFiles();
    expect(files.length).toBeGreaterThan(10);
    const total = files.reduce((n, f) => n + aliasesOf(f).size, 0);
    expect(total).toBeGreaterThan(10);
    expect(catalogHomes().size, "katalog nedeklaruje compose — brána ztratila vazbu")
      .toBeGreaterThan(20);
  });

  it("žádný alias nedeklarují dva různé compose", () => {
    const owner = new Map<string, string>();
    const collisions: string[] = [];
    for (const file of composeFiles()) {
      for (const alias of aliasesOf(file)) {
        const prev = owner.get(alias);
        if (prev && prev !== file) {
          collisions.push(`'${alias}' deklarují ${prev} i ${file}`);
        } else {
          owner.set(alias, file);
        }
      }
    }
    expect(
      collisions,
      `Dva compose na jednom jméně — DNS bude odpovídat střídavě:\n  ${collisions.join("\n  ")}`,
    ).toEqual([]);
  });

  /**
   * Kolize se dřív odmávla jménem v testu. Jenže KDE má služba bydlet, repozitář
   * už deklaruje — `config/services.json` má u každé služby `compose`. Ptát se
   * na to seznamu v bráně znamenalo mít tutéž informaci dvakrát, a ta ruční
   * kopie je právě to, co se rozejde.
   *
   * Brána proto čte VAZBU: alias, který se jmenuje jako katalogová služba, smí
   * deklarovat jen ten compose, který katalog označuje za její domov. Přesun
   * služby jinam je pak jedna změna v katalogu, ne dvě na dvou místech.
   */
  it("alias katalogové služby deklaruje jen její deklarovaný domov", () => {
    const homes = catalogHomes();
    const drift: string[] = [];
    for (const file of composeFiles()) {
      for (const alias of aliasesOf(file)) {
        const home = homes.get(alias);
        if (home && home !== file) {
          drift.push(`'${alias}' deklaruje ${file}, ale katalog jako domov uvádí ${home}`);
        }
      }
    }
    expect(
      drift,
      `Compose obsazuje jméno služby, která podle katalogu bydlí jinde:\n  ${drift.join("\n  ")}`,
    ).toEqual([]);
  });
});
