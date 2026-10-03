/**
 * Služba s doménou MUSÍ být na ingress síti (CLASS gate)
 *
 * TŘÍDA VADY: usuzovat na dosažitelnost z NESPRÁVNÉHO pramene. Traefik routy
 * nevznikají jen z `traefik.http.routers.*` labelů v compose — Coolify je
 * DOGENERUJE z domény nastavené u služby (`docker_compose_domains`). Kdo měří
 * jen compose labely, dostane odpověď, která vypadá jako důkaz „žádný ingress",
 * a přitom odpovídá na jinou otázku.
 *
 * NAMĚŘENO 2026-08-10 při odpojování služeb od globální sítě `coolify`:
 * čtyři služby NEMAJÍ v compose jediný `traefik.http.routers.*`, a přesto jim
 * Coolify doménu přiděluje —
 *     web         → aisha.guru, web.aisha.guru, corp.aisha.guru
 *     gateway     → api.mesh.<tld>
 *     netbird-proxy → netbird.aisha.guru
 *     pki-auth    → pki.mesh.<tld>
 * Odpojení kterékoli z nich od `coolify` je tichá ztráta ingressu: kontejner
 * běží a hlásí healthy, Traefik na něj nedosáhne a vrátí 404. Zelená CI to
 * nepozná — projeví se to až na veřejném povrchu.
 *
 * INVARIANT: má-li služba přidělenou doménu (scripts/coolify-domain-doctor.mjs),
 * MUSÍ být ve svém compose připojená na síť `coolify`.
 *
 * Brána je ODVOZENÁ, ne udržovaný seznam:
 *   config/services.json          → stack → compose soubor
 *   scripts/coolify-domain-doctor.mjs → aplikace → služby s doménou
 * Přidání domény tedy automaticky přidá i požadavek na síť.
 *
 * Spousti se pres: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const ROOT = process.cwd();
const DOMAIN_DOCTOR = join(ROOT, "scripts/coolify-domain-doctor.mjs");
const SERVICES_JSON = join(ROOT, "config/services.json");

/**
 * Doména na rezervované TLD `.invalid` (RFC 2606) NENÍ ingress — je to záměrná
 * neroutovatelná výplň. `coolify-domain-doctor.mjs` ji sám filtruje z PATCHe
 * (`isSentinelDomain`), takže Coolify pro ni router nikdy nevytvoří. Brána musí
 * použít TÉŽ definici, jinak by vyžadovala síť pro službu bez ingressu.
 */
export const jeSentinel = (domain: string): boolean => /\.invalid(?::\d+)?(?:\/.*)?/i.test(domain);

/** aplikace (`aisha-<id>`) → jména compose služeb, kterým se přiděluje SKUTEČNÁ doména. */
export function parseDomainOwners(src: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current: string | null = null;
  // Jeden sekvenční průchod: `app:` přepne kontext, `name:` přidá službu.
  for (const m of src.matchAll(/\bapp:\s*"([^"]+)"|\bname:\s*"([^"]+)"/g)) {
    if (m[1]) {
      current = m[1];
      if (!out.has(current)) out.set(current, []);
      continue;
    }
    if (!m[2] || !current) continue;
    // Hodnota `domain:` téhož objektu — stačí dohlédnout za jméno, položky jsou krátké.
    const okoli = src.slice(m.index ?? 0, (m.index ?? 0) + 300);
    const dm = okoli.match(/\bdomain:\s*([^\n]*)/);
    if (dm && jeSentinel(dm[1])) continue; // neroutovatelná výplň — žádný ingress
    out.get(current)!.push(m[2]);
  }
  return out;
}

/** Jen ta část compose, kterou tahle brána čte. */
type ComposeDoc = {
  services?: Record<string, { networks?: string[] | Record<string, unknown> } | undefined>;
};

/** stack id → compose soubor (z config/services.json). */
function composeByStackId(): Map<string, string> {
  const j = JSON.parse(readFileSync(SERVICES_JSON, "utf-8")) as {
    services?: Record<string, { compose?: string } | undefined>;
  };
  const map = new Map<string, string>();
  for (const [id, def] of Object.entries(j.services ?? {})) {
    if (def?.compose) map.set(id, String(def.compose));
  }
  return map;
}

/** Compose soubory, které danou službu DEFINUJÍ. */
function composeFilesDefining(svc: string): string[] {
  return readdirSync(ROOT)
    .filter((f) => /^docker-compose.*\.ya?ml$/.test(f))
    .filter((f) => {
      try {
        return Boolean((parse(readFileSync(join(ROOT, f), "utf-8")) as ComposeDoc)?.services?.[svc]);
      } catch {
        return false;
      }
    })
    .sort();
}

/** Sítě, na které je služba připojená (klíče, ne rozřešená jména). */
function serviceNetworkKeys(doc: ComposeDoc, svc: string): string[] | null {
  const def = doc?.services?.[svc];
  if (!def || typeof def !== "object") return null;
  const n = def.networks;
  if (Array.isArray(n)) return n.map(String);
  if (n && typeof n === "object") return Object.keys(n);
  return []; // bez `networks:` — dědí default, tedy NENÍ na coolify explicitně
}

describe("služba s doménou je na ingress síti", () => {
  test("oba prameny existují (brána má co měřit)", () => {
    expect(existsSync(DOMAIN_DOCTOR)).toBe(true);
    expect(existsSync(SERVICES_JSON)).toBe(true);
  });

  const owners = parseDomainOwners(readFileSync(DOMAIN_DOCTOR, "utf-8"));
  const byId = composeByStackId();

  test("prameny nejsou prázdné (jinak by brána mlčela z nedostatku dat)", () => {
    expect(owners.size).toBeGreaterThan(5);
    expect(byId.size).toBeGreaterThan(20);
  });

  test("každá služba s doménou je připojená na síť coolify", () => {
    const problemy: string[] = [];
    const nespárováno: string[] = [];

    for (const [app, services] of owners) {
      const id = app.replace(/^aisha-/, "");
      const mapped = byId.get(id);

      for (const svc of services) {
        // Soubor se hledá ve DVOU krocích, oba odvozené:
        //  1. mapování stacku z config/services.json, pokud tu službu definuje,
        //  2. jinak compose, který službu toho jména definuje (jednoznačně).
        // Aplikace mimo services.json (např. aisha-observability-stack) tak
        // NEZŮSTANE neměřená jen proto, že chybí v jednom rejstříku.
        const candidates = composeFilesDefining(svc);
        const file =
          mapped && candidates.includes(mapped) ? mapped : candidates.length === 1 ? candidates[0] : null;

        if (!file) {
          if (candidates.length === 0) continue; // služba v repu není — volitelná lane
          nespárováno.push(
            `${app} / "${svc}": nejednoznačné — definuje ji ${candidates.length} compose (${candidates.join(", ")}), ` +
              `a config/services.json mapuje "${id}" na ${mapped ?? "nic"}`,
          );
          continue;
        }

        const doc = parse(readFileSync(join(ROOT, file), "utf-8")) as ComposeDoc;
        const keys = serviceNetworkKeys(doc, svc);
        if (keys === null) continue; // služba ve stacku není (volitelná lane) — neřeší tahle brána
        if (!keys.includes("coolify")) {
          problemy.push(
            `${file}: služba "${svc}" má přidělenou doménu (coolify-domain-doctor.mjs, app ${app}), ` +
              `ale NENÍ na síti "coolify" — je na [${keys.join(", ") || "žádné"}]. ` +
              `Traefik na ni nedosáhne ⇒ 404 na veřejném povrchu, zatímco kontejner hlásí healthy.`,
          );
        }
      }
    }

    if (nespárováno.length) {
      // Nespárovaná aplikace znamená, že brána TU SLUŽBU NEMĚŘILA. To je díra
      // v pokrytí, ne úspěch — hlásí se stejně hlasitě jako nález.
      throw new Error(
        `Brána nedokázala spárovat aplikaci s compose souborem (${nespárováno.length}×) — ` +
          `neměřeno, tedy neověřeno:\n  ${nespárováno.join("\n  ")}`,
      );
    }
    expect(problemy).toEqual([]);
  });

  // ── Negativní testy: brána musí nález POZNAT ────────────────────────────────
  test("parser přiřadí službu ke správné aplikaci", () => {
    const m = parseDomainOwners(`
      { app: "aisha-registry", domains: [{ name: "registry-cache", domain: x }] },
      { app: "aisha-core", domains: [{ name: "gateway", domain: y }, { name: "web", domain: z }] },
    `);
    expect(m.get("aisha-registry")).toEqual(["registry-cache"]);
    expect(m.get("aisha-core")).toEqual(["gateway", "web"]);
  });

  test("služba bez klíče coolify je nález", () => {
    const doc = parse("services:\n  gateway:\n    networks:\n      internal: {}\n") as ComposeDoc;
    expect(serviceNetworkKeys(doc, "gateway")).toEqual(["internal"]);
    expect(serviceNetworkKeys(doc, "gateway")!.includes("coolify")).toBe(false);
  });

  test("služba s klíčem coolify nálezem není", () => {
    const doc = parse("services:\n  gateway:\n    networks:\n      - internal\n      - coolify\n") as ComposeDoc;
    expect(serviceNetworkKeys(doc, "gateway")!.includes("coolify")).toBe(true);
  });

  test("chybějící služba se nehlásí jako porušení (volitelná lane)", () => {
    const doc = parse("services:\n  jina:\n    image: x\n") as ComposeDoc;
    expect(serviceNetworkKeys(doc, "gateway")).toBeNull();
  });

  test("sentinel .invalid se nepočítá jako doména", () => {
    expect(jeSentinel("http://mesh-router-aisha-disabled.invalid:80")).toBe(true);
    expect(jeSentinel("https://aisha.guru")).toBe(false);
    const m = parseDomainOwners(`
      { app: "aisha-edge", domains: [
        { name: "web", domain: \`https://\${env.WEB_DOMAIN}\` },
        { name: "mesh-router", domain: \`http://mesh-router-x-disabled.invalid:80\` },
      ] },
    `);
    expect(m.get("aisha-edge")).toEqual(["web"]);
  });
});
