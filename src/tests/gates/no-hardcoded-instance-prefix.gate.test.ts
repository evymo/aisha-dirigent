/**
 * Gate: jméno kontejnerové služby nesmí nést natvrdo cizí instanční prefix.
 *
 * PROČ (2026-07-29)
 * ----------------
 * Na RIQ instanci stojí v compose `aisha-postgrest`, `aisha-keycloak`,
 * `aisha-gateway`. To je prefix JINÉ instance zapečený do kódu stacku — přesně
 * to, co sem nepatří: generické patří nahoru, instanční je DATA.
 *
 * Změřeno: 26 síťových aliasů natvrdo, z toho 7 s cizím prefixem, 0
 * parametrizovaných. A 107 `container_name` se stejným prefixem, které ale
 * NIC nereferencuje (`depends_on`, `network_mode`, `extra_hosts` ani
 * healthchecky) a Coolify je stejně přepisuje na `<služba>-<uuid>-<n>`.
 *
 * Nosné jsou tedy ALIASY — ty rozhodují, na co se dá napojit napříč stacky.
 * Proto tahle brána hlídá je, ne dekorativní container_name.
 *
 * DŮSLEDEK, kvůli kterému to vzniklo: jednu službu pojmenovávají TŘI různá
 * jména — compose service name, `container_name` a runtime jméno od Coolify —
 * a k tomu alias s cizím prefixem. Derivace pak nemá z čeho stavět plnou
 * adresu, a 34 proměnných se nedá vydat vůbec (viz scripts/derived-url-report.mjs).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");

function composeFiles(): string[] {
  return readdirSync(ROOT).filter((f) => /^docker-compose\.coolify.*\.ya?ml$/.test(f));
}

/** Síťové aliasy — jména, na která se dá napojit napříč stacky. */
function aliasesWithFile(): Array<{ alias: string; file: string }> {
  const out: Array<{ alias: string; file: string }> = [];
  for (const file of composeFiles()) {
    const text = readFileSync(resolve(ROOT, file), "utf8");
    for (const m of text.matchAll(/aliases:\s*\n((?:\s+-\s+[^\n]+\n)+)/g)) {
      for (const line of m[1].trim().split("\n")) {
        out.push({ alias: line.trim().replace(/^-\s*/, "").replace(/^["']|["']$/g, ""), file });
      }
    }
    for (const m of text.matchAll(/aliases:\s*\[([^\]]+)\]/g)) {
      for (const raw of m[1].split(",")) {
        out.push({ alias: raw.trim().replace(/^["']|["']$/g, ""), file });
      }
    }
  }
  return out;
}

/**
 * Které prefixy jsou instanční — čte se z DEKLAROVANÝCH instancí.
 *
 * Dřív tu stál regex `/^(aisha|riq|evymo)-/`, tedy pravopis tří jmen opsaný do
 * testu. Takový výčet měří jen to, na co si někdo vzpomněl: čtvrtá instance by
 * si natvrdo psaný prefix zavedla a brána by mlčela.
 *
 * Repozitář přitom instance deklaruje — `coolify/manifests/<prefix>.manifest`
 * je jedna na instanci — a identitu té běžící drží APP_NAME_PREFIX. Univerzum
 * se tedy odvodí z vazby, ne z paměti, a rozšíří se samo.
 *
 * Ověřeno, že to nedělá falešné nálezy: `cosmos-node` ani `netbird-*` se
 * nechytají, protože kolizí by musel být celý prefix instance následovaný
 * pomlčkou — a takových aliasů je dnes 0 pro cosmos, netbird i riq.
 */
function knownInstancePrefixes(): Set<string> {
  const dir = resolve(ROOT, "coolify/manifests");
  const prefixes = new Set<string>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".manifest") || f.startsWith("_")) continue; // _template není instance
    prefixes.add(f.replace(/\.manifest$/, ""));
  }
  const running = (process.env.APP_NAME_PREFIX || "").trim();
  if (running) prefixes.add(running);
  return prefixes;
}

/** Natvrdo psaný instanční prefix. Parametrizovaný tvar (`${…}`) je v pořádku. */
function isHardcodedPrefixed(alias: string, prefixes: Set<string>): boolean {
  if (alias.includes("${")) return false;
  return [...prefixes].some((p) => alias.startsWith(`${p}-`));
}

describe("instanční prefix v jménech služeb", () => {
  it("univerzum se seeduje ze skutečnosti a není prázdné", () => {
    expect(composeFiles().length).toBeGreaterThan(10);
    expect(aliasesWithFile().length).toBeGreaterThan(10);
  });

  it("univerzum prefixů se čte z deklarovaných instancí, ne z pravopisu v testu", () => {
    const p = knownInstancePrefixes();
    expect(p.size, "žádná instance nedeklarována — brána by nenašla nic").toBeGreaterThan(1);
    // Mutační kontrola měřidla: kdyby regex `${…}` propouštěl, tenhle tvar by
    // se počítal jako natvrdo psaný a brána by hlásila nález.
    expect(isHardcodedPrefixed("${SERVICE_ALIAS_PREFIX:?x}-db", p)).toBe(false);
    expect(isHardcodedPrefixed(`${[...p][0]}-db`, p)).toBe(true);
  });

  it("žádný síťový alias nenese natvrdo instanční prefix", () => {
    const prefixes = knownInstancePrefixes();
    const bad = [...new Set(
      aliasesWithFile()
        .filter(({ alias }) => isHardcodedPrefixed(alias, prefixes))
        .map(({ alias, file }) => `${alias} (${file})`),
    )].sort();

    // Bez výjimek. Odstraňuje se PARAMETRIZACÍ aliasu (`${SERVICE_ALIAS_PREFIX}`
    // z derivace), ne přejmenováním na jiný natvrdo psaný prefix.
    expect(
      bad,
      `Alias s natvrdo zapečeným instančním prefixem:\n  ${bad.join("\n  ")}`,
    ).toEqual([]);
  });
});
