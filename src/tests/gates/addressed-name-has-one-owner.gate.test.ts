/**
 * Gate: jméno, které se adresuje z JINÉHO stacku, smí mít jen JEDNOHO vlastníka.
 *
 * PROČ (2026-07-29)
 * ----------------
 * `network-alias-unique` hlídá deklarované aliasy. Jenže alias není jediné
 * jméno, které kontejner na síti dostane — docker přidává jako alias i COMPOSE
 * SERVICE NAME, a to na každou připojenou síť. `internal` je přitom u 27 z 31
 * compose `external: true, name: coolify`, tedy JEDNA síť celého clusteru.
 *
 * Důsledek: dva compose se stejným klíčem služby si to jméno rozdělí a DNS
 * odpovídá střídavě — přesně ta vada, kterou alias-brána měla vyloučit, jen o
 * patro níž. Odebrání duplicitního aliasu ji NEODSTRANÍ.
 *
 * Změřeno: kolidujících service names je šest, ale adresuje se zvenku jediné —
 * `svc-blockchain` (gateway → `http://svc-blockchain:3013`). Ostatní
 * (`pki-init` v 15 compose, `netbird-agent` v pěti, `redis`, `web`,
 * `svc-plugin-system`) nikdo cizí nevolá, takže jejich kolize je latentní.
 *
 * Brána proto netrestá kolizi samu o sobě, ale kolizi JMÉNA, KTERÉ NĚKDO VOLÁ.
 * To je vlastnost, která má následek — a nevynucuje přejmenovat 21 init
 * kontejnerů, které se nikdy neadresují.
 *
 * UNIVERZUM: compose deklarované v manifestech
 * -------------------------------------------
 * Ne každý `docker-compose.coolify*.yml` je stack. `docker-compose.coolify.netseg.yml`
 * je OVERLAY nad core, takže sdílí klíč `svc-plugin-system` se souborem, který
 * překrývá — a filename glob z toho udělal falešnou kolizi. Které compose jsou
 * stacky, deklarují `coolify/manifests/*.manifest`; čte se tedy vazba.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(__dirname, "../../..");

/** Compose, které jsou STACKY — deklarované v některém manifestu. */
function stackComposes(): string[] {
  const dir = resolve(ROOT, "coolify/manifests");
  const declared = new Set<string>();
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".manifest"))) {
    for (const line of readFileSync(resolve(dir, f), "utf8").split("\n")) {
      const m = line.match(/^app:\s*[a-z0-9_-]+:[a-z0-9_-]+:(\S+\.ya?ml)/i);
      if (m && existsSync(resolve(ROOT, m[1]))) declared.add(m[1]);
    }
  }
  return [...declared].sort();
}

/** Klíče pod `services:` — docker je vystavuje jako alias na každé síti. */
function serviceKeys(file: string): Set<string> {
  const keys = new Set<string>();
  let inServices = false;
  for (const line of readFileSync(resolve(ROOT, file), "utf8").split("\n")) {
    if (/^services:\s*$/.test(line)) { inServices = true; continue; }
    if (inServices && /^[a-zA-Z]/.test(line)) break;
    const m = inServices && line.match(/^ {2}([a-z0-9][a-z0-9._-]*):\s*$/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === "dist" || e.startsWith(".")) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.(ts|mjs|js)$/.test(e) && !/\.(test|spec)\./.test(e)) acc.push(full);
  }
  return acc;
}

/**
 * Jména adresovaná jako HOSTITEL — ze zdrojáku i z compose.
 *
 * Hledá se `http(s)://<jméno>`, `@<jméno>:port` (connection stringy) a
 * `"<jméno>":port`. Holý výskyt slova se nepočítá: `'web'` ve svc-web-artifact
 * je název seedu, ne hostitel, a počítat ho by bránu zaplnilo šumem.
 */
function addressedNames(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (name: string, where: string) => {
    if (!out.has(name)) out.set(name, new Set());
    out.get(name)!.add(where);
  };
  const scan = (text: string, where: string) => {
    for (const m of text.matchAll(/(?:https?:\/\/|@)([a-z0-9][a-z0-9._-]*)(?::\d+)/gi)) {
      add(m[1], where);
    }
  };
  for (const f of sourceFiles(resolve(ROOT, "services"))) {
    scan(readFileSync(f, "utf8"), f.replace(`${ROOT}/`, ""));
  }
  for (const f of stackComposes()) scan(readFileSync(resolve(ROOT, f), "utf8"), f);
  return out;
}

describe("adresovaná jména", () => {
  it("univerzum se seeduje z deklarovaných stacků a není prázdné", () => {
    const stacks = stackComposes();
    expect(stacks.length, "žádný stack z manifestů — brána ztratila vstup").toBeGreaterThan(10);
    // netseg je OVERLAY nad core, ne stack; kdyby se sem dostal, vyrobí falešnou kolizi
    expect(stacks).not.toContain("docker-compose.coolify.netseg.yml");
    expect(addressedNames().size, "nikdo nikoho neadresuje — sonda přestala měřit")
      .toBeGreaterThan(5);
  });

  it("žádné adresované jméno nedeklarují dva stacky", () => {
    const owner = new Map<string, string[]>();
    for (const file of stackComposes()) {
      for (const key of serviceKeys(file)) {
        if (!owner.has(key)) owner.set(key, []);
        owner.get(key)!.push(file);
      }
    }
    const addressed = addressedNames();
    const bad: string[] = [];
    for (const [name, files] of owner) {
      if (files.length < 2) continue;
      const callers = addressed.get(name);
      if (!callers) continue; // kolize bez volajícího — latentní, netrestá se
      bad.push(
        `'${name}' deklarují ${files.join(" i ")}; adresuje se z ${[...callers].slice(0, 3).join(", ")}`,
      );
    }
    expect(
      bad.sort(),
      `Jméno, které někdo volá, vlastní dva stacky — DNS odpoví střídavě:\n  ${bad.join("\n  ")}`,
    ).toEqual([]);
  });
});
