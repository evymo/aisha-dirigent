/**
 * Instance Subdomain Namespace Gate
 *
 * OWNS: the instance namespace applied to every derived hostname.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 * When an instance declares a namespace, EVERY hostname the resolver emits
 * carries it. Not most. Not the ones someone remembered to check.
 *
 * ── WHY (measured 2026-07-19) ─────────────────────────────────────────────
 * Two independent defects made the namespace unusable in practice:
 *
 * 1. NO ENV OVERRIDE. `subdomain_prefix` was the only field under
 *    profile.domain with no operator-env equivalent — PUBLIC_TLD,
 *    INTERNAL_TLD, MESH_TLD and both OAUTH2_* keys all had one. So an
 *    instance could namespace itself ONLY by editing a profile JSON that
 *    ships in the platform repo, i.e. by diverging from the platform to do
 *    the one thing every fork must do. This deployment consequently still
 *    emitted `auth.backend.<internal_tld>` — a name with no instance in it,
 *    which a second aisha fork on the same TLD would generate identically.
 *    (It already bit: the cold start hit `DOMAIN CONFLICT: another Coolify
 *    app already claims this host` on the registry hostname.)
 *
 * 2. NO SEPARATOR. The prefix was concatenated bare, so
 *    config/profiles/tenant.json declaring `subdomain_prefix: "tenant"` emitted
 *    `tenantauth` / `tenantapi` / `tenantn8n` while that same file's `_notes`
 *    documented the contract as `tenant-<svc>`. The value and the code
 *    disagreed and nothing noticed, because the only fork running a prefix
 *    in production had baked the separator into the value ("<fork>-").
 *
 * Both are pinned below as PROPERTIES, not spellings: the coverage test
 * derives the full emitted set and asserts every host is namespaced, so a
 * service added later cannot quietly escape.
 *
 * Spousti se pres: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const DERIVE = join(ROOT, "scripts/lib/derive-domains.mjs");

/** Reference TLDs so the gate never depends on the caller's deployment env. */
const REF = {
  PUBLIC_TLD: "public.example",
  INTERNAL_TLD: "internal.example",
  MESH_TLD: "mesh.example",
};

/** Env inputs derive-domains reads — stripped so ambient values cannot steer this gate. */
// Imported, not copied: a local list drifts. See derive-domains.mjs.
import { RESOLVER_ENV_INPUTS } from "../../../scripts/lib/derive-domains.mjs";

/**
 * Mesh přepíná CELOU vnitřní zónu: s `--mesh=on` se z
 * `<svc>.<slot>.<internal_tld>` stane `<svc>.<mesh_tld>` (naměřeno 2026-08-12:
 * 119 z 204 hodnot). Brána, která rendruje jen jeden stav, tedy neměří druhou
 * polovinu jmen — a mesh je přitom ta polovina, kde kolize nájemníků žije,
 * protože mesh zóna nemá slot, který by jména aspoň částečně rozvedl.
 */
const MESH_STAVY = ["off", "on"] as const;
type MeshStav = (typeof MESH_STAVY)[number];

function derive(
  profile: string,
  overrides: Record<string, string> = {},
  mesh: MeshStav = "off",
): Map<string, string> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of RESOLVER_ENV_INPUTS) delete env[key];

  const out = execFileSync("node", [DERIVE, `--profile=${profile}`, `--mesh=${mesh}`, "--shell"], {
    cwd: ROOT,
    encoding: "utf-8",
    env: { ...env, ...REF, ...overrides },
  });

  const map = new Map<string, string>();
  for (const line of out.split("\n")) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

/** Emitted *_DOMAIN* values that are real hostnames under one of the reference TLDs. */
function emittedHosts(vars: Map<string, string>): { key: string; host: string }[] {
  const tlds = [REF.PUBLIC_TLD, REF.INTERNAL_TLD, REF.MESH_TLD];
  const out: { key: string; host: string }[] = [];
  for (const [key, value] of vars) {
    if (!/_DOMAIN(_[A-Z]+)?$/.test(key)) continue;
    if (!value) continue;
    // Sentinels (*.invalid) are deliberately unroutable, not instance-scoped.
    if (value.endsWith(".invalid")) continue;
    if (!tlds.some((t) => value === t || value.endsWith(`.${t}`))) continue;
    out.push({ key, host: value });
  }
  return out;
}

/** The label a host starts with, i.e. everything before the first dot. */
function firstLabel(host: string): string {
  return host.split(".")[0];
}

/** A bare TLD (apex) has no subdomain label to namespace. */
function jeApex(host: string): boolean {
  return [REF.PUBLIC_TLD, REF.INTERNAL_TLD, REF.MESH_TLD].includes(host);
}

/**
 * SDÍLENÁ zóna — zóna HOSTITELE, kde týž tvar jména vyrobí každý nájemník.
 * Tady kolize skutečně nastala (pki-init sáhl 2026-08-12 na cizí pki-bridge)
 * a tady identita instance PATŘÍ.
 */
function sdilenaZona(hosts: { key: string; host: string }[]) {
  return hosts.filter(
    ({ host }) => host.endsWith(`.${REF.INTERNAL_TLD}`) || host.endsWith(`.${REF.MESH_TLD}`),
  );
}

/**
 * VLASTNÍ zóna instance — její doména. Identitu nese sám TLD, druhé razítko
 * v prvním labelu nic nerozlišuje.
 */
function vlastniZona(hosts: { key: string; host: string }[]) {
  return hosts.filter(({ host }) => host.endsWith(`.${REF.PUBLIC_TLD}`));
}

describe("Instance subdomain namespace — identita tam, kde ji zóna nenese", () => {
  test.each(MESH_STAVY)("identita je v KAŽDÉM jménu ve SDÍLENÉ zóně (mesh=%s)", (mesh) => {
    const namespaced = derive("cloud-multi", { APP_NAME_PREFIX: "acme" }, mesh);
    const hosts = sdilenaZona(emittedHosts(namespaced));

    expect(hosts.length, "resolver emitted no shared-zone hostnames — the harness is broken").toBeGreaterThan(5);

    const escaped = hosts.filter(({ host }) => !jeApex(host) && !firstLabel(host).startsWith("acme-"));

    expect(
      escaped.map((e) => `${e.key}=${e.host}`),
      `mesh=${mesh}: these hostnames escaped the instance namespace — a second fork on the ` +
        "same host would generate them identically and collide:",
    ).toEqual([]);
  });

  test.each(MESH_STAVY)("identita se NELEPÍ na vlastní veřejnou doménu (mesh=%s)", (mesh) => {
    // ⛔ NAMĚŘENO 2026-08-12: prefix se lepil i na veřejnou zónu, takže se
    // z `cache.<public_tld>` (pull-through cache, ze které stahuje KAŽDÝ obraz)
    // stalo `<projekt>-cache.<public_tld>`. Tam neposlouchá žádný router —
    // `/v2/` vrátilo 404 — a vlna 0 nestáhla ani první obraz. Zdvojení identity
    // tedy není jen kosmetika: rozbilo první krok nasazení.
    //
    // Veřejná zóna JE identita instance: `aisha.guru` patří právě jedné.
    const namespaced = derive("cloud-multi", { APP_NAME_PREFIX: "acme" }, mesh);
    const hosts = vlastniZona(emittedHosts(namespaced));

    expect(hosts.length, "resolver emitted no public hostnames — the harness is broken").toBeGreaterThan(3);

    const zdvojene = hosts.filter(({ host }) => firstLabel(host).startsWith("acme-"));
    expect(
      zdvojene.map((z) => `${z.key}=${z.host}`),
      "veřejná zóna už identitu nese TLDčkem — druhé razítko v prvním labelu nic " +
        "nerozlišuje a rozbíjí adresy, které někdo (registry, DNS, certifikát) už zná:",
    ).toEqual([]);

    // Regresní pin na tu konkrétní adresu, která nasazení zastavila.
    expect(namespaced.get("REGISTRY_DOMAIN"), "REGISTRY_DOMAIN").toBe(`cache.${REF.PUBLIC_TLD}`);
  });

  test("mesh=on skutečně rendruje mesh zónu (jinak by test výš měřil totéž dvakrát)", () => {
    // Mlčení sondy je samo nálezem: kdyby `--mesh=on` z jakéhokoli důvodu
    // nepřepnul zónu, běh „mesh=on" výš by prošel nad vnitřními jmény a tvrdil
    // pokrytí, které nemá.
    const meshOn = derive("cloud-multi", { APP_NAME_PREFIX: "acme" }, "on");
    const vMesh = [...meshOn.values()].filter((v) => v.includes(`.${REF.MESH_TLD}`));
    expect(vMesh.length, "žádná hodnota nenese mesh zónu — --mesh=on nic nepřepnul").toBeGreaterThan(10);
  });

  test("a prefix without a separator gets one (tenant -> tenant-auth, not tenantauth)", () => {
    const vars = derive("cloud-multi", { APP_NAME_PREFIX: "tenant" });
    const hosts = sdilenaZona(emittedHosts(vars)).filter((h) => !firstLabel(h.host).includes("."));
    const glued = hosts.filter(
      ({ host }) => firstLabel(host).startsWith("tenant") && !firstLabel(host).startsWith("tenant-"),
    );
    expect(
      glued.map((g) => `${g.key}=${g.host}`),
      "prefix concatenated without a separator — 'tenant' + 'auth' must be 'tenant-auth'",
    ).toEqual([]);
  });

  test("a prefix that already ends in a separator is left alone (live '<fork>-' form)", () => {
    const withDash = derive("cloud-multi", { APP_NAME_PREFIX: "testfork-" });
    const doubled = emittedHosts(withDash).filter(({ host }) => firstLabel(host).startsWith("testfork--"));
    expect(
      doubled.map((d) => `${d.key}=${d.host}`),
      "a trailing separator must not be doubled — this form is live in production",
    ).toEqual([]);
    // Identita se projeví na SDÍLENÉ zóně; veřejná zůstává vlastní doménou.
    expect(withDash.get("KEYCLOAK_DOMAIN"), "KEYCLOAK_DOMAIN (sdílená zóna)").toBe(
      `testfork-auth.backend.${REF.INTERNAL_TLD}`,
    );
    expect(withDash.get("KEYCLOAK_DOMAIN_PUBLIC"), "KEYCLOAK_DOMAIN_PUBLIC (vlastní zóna)").toBe(
      `auth.${REF.PUBLIC_TLD}`,
    );
  });

  test("no namespace declared ⇒ output is byte-identical to before (no surprise renames)", () => {
    const bare = derive("cloud-multi");
    const explicitlyEmpty = derive("cloud-multi", { APP_NAME_PREFIX: "" });
    expect([...explicitlyEmpty.entries()]).toEqual([...bare.entries()]);
    expect(bare.get("KEYCLOAK_DOMAIN_PUBLIC")).toBe(`auth.${REF.PUBLIC_TLD}`);
  });

  test("výslovný prefix v profilu platí i ve VLASTNÍ zóně; identita jen ve sdílené", () => {
    // Dvě různé věci se stejným tvarem, proto se nesmějí slít:
    //
    //   subdomain_prefix v profilu  = VÝSLOVNÁ volba forku. Platí všude včetně
    //     veřejné zóny — fork, který veřejnou zónu s někým sdílí, se jinak
    //     rozlišit nemůže. Živý tvar `<fork>-auth.<public_tld>` je v produkci.
    //   APP_NAME_PREFIX             = identita instance. Platí jen tam, kde ji
    //     zóna nenese: vnitřní + mesh. Veřejná zóna JE vlastní doména.
    //
    // Kdyby identita přebíjela i veřejnou zónu, přejmenovala by adresy, které
    // někdo zvenčí už zná — a přesně tím 2026-08-12 zhasl registry.
    //
    // The profile is SYNTHESISED here rather than taken from a real instance.
    // config/profiles/ ships templates only — an instance's profile lives in the
    // private overlay (43dcc148), and public-oss-boundary fails if one appears
    // in this repo. A gate that reads a named instance profile therefore either
    // fails in the public tree or forces the very leak the boundary forbids;
    // this one did the former. The fixture goes in a temp dir so it is invisible
    // to that scan.
    const dir = mkdtempSync(join(tmpdir(), "aisha-profile-"));
    try {
      const template = JSON.parse(
        readFileSync(join(ROOT, "config/profiles/cloud-multi.json"), "utf-8"),
      ) as { id?: string; domain?: Record<string, unknown> };
      template.id = "fixture";
      template.domain = { ...(template.domain ?? {}), subdomain_prefix: "fix" };
      mkdirSync(join(dir, "profiles"), { recursive: true });
      writeFileSync(join(dir, "profiles/fixture.json"), JSON.stringify(template, null, 2));

      const overlay = { AISHA_INSTANCE_CONFIG_DIR: dir };
      const fromProfile = derive("fixture", overlay);
      const overridden = derive("fixture", { ...overlay, APP_NAME_PREFIX: "other" });

      expect(
        fromProfile.get("KEYCLOAK_DOMAIN_PUBLIC") ?? "",
        "výslovný prefix z profilu platí i ve veřejné zóně",
      ).toBe(`fix-auth.${REF.PUBLIC_TLD}`);
      expect(
        fromProfile.get("KEYCLOAK_DOMAIN") ?? "",
        "…a ve sdílené také",
      ).toBe(`fix-auth.backend.${REF.INTERNAL_TLD}`);

      expect(
        overridden.get("KEYCLOAK_DOMAIN") ?? "",
        "identita instance přebíjí literál v profilu — ale jen ve SDÍLENÉ zóně",
      ).toBe(`other-auth.backend.${REF.INTERNAL_TLD}`);
      expect(
        overridden.get("KEYCLOAK_DOMAIN_PUBLIC") ?? "",
        "ve VLASTNÍ zóně identita nic nepřepisuje — vyhrává výslovná volba forku",
      ).toBe(`fix-auth.${REF.PUBLIC_TLD}`);

      // The separator is part of the contract: `fix-auth`, never `fixauth`.
      expect(firstLabel(fromProfile.get("API_DOMAIN_PUBLIC") ?? "")).toBe("fix-api");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("jmenný prostor se ODVOZUJE z identity projektu, nemá vlastní proměnnou", () => {
    // Tenhle test dřív žádal `process.env.AISHA_SUBDOMAIN_PREFIX`. Důvod byl
    // správný — instance se nesmí muset jmenovat editací souboru, který patří
    // platformě. Řešení bylo o krok vedle: zavedlo DRUHÉ JMÉNO pro identitu,
    // kterou instance už nese jako APP_NAME_PREFIX (kontejnery, volumes, sítě).
    //
    // Dvě jména pro touž věc se rozejdou. Tahle se rozešla tak, že jedno bylo
    // naplněné a druhé ne — a hostnames tím pádem identitu ignorovaly. Praskl
    // na tom 2026-08-12 pki-init: `pki-bridge.backend.<internal_tld>` je na
    // sdíleném stroji jméno DVOU nájemníků.
    //
    // Pravidlo téhle brány platí dál (viz testy výš: KAŽDÝ hostname ve sdílené
    // zóně nese jmenný prostor). Mění se jen jeho zdroj: odvození z identity.
    const src = readFileSync(join(ROOT, "scripts/lib/derive-domains.mjs"), "utf-8");

    expect(
      src,
      "jmenný prostor se má odvozovat z APP_NAME_PREFIX (identita projektu), ne z vlastní proměnné",
    ).toMatch(/shared_zone_prefix\s*=\s*identita/);

    // Identita a výslovná volba forku musí zůstat DVĚ pole. Kdyby se identita
    // zase ukládala do `subdomain_prefix`, propsala by se i do veřejné zóny —
    // tedy přesně ten zásah, který 2026-08-12 zhasl registry.
    expect(
      /profile\.domain\.subdomain_prefix\s*=\s*identita/.test(src),
      "identita se nesmí ukládat do subdomain_prefix — to je výslovná volba forku a platí i veřejně",
    ).toBe(false);

    expect(
      /process\.env\.AISHA_SUBDOMAIN_PREFIX/.test(src),
      "AISHA_SUBDOMAIN_PREFIX byl zrušen jako druhé jméno pro identitu — nesmí se vrátit",
    ).toBe(false);
  });
});
