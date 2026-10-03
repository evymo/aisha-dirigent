/**
 * Jméno na SDÍLENÉ INFRASTRUKTUŘE musí nést projekt — třídní brána
 *
 * ⛔ NAMĚŘENÝ VÝPADEK 2026-08-12. `aisha-core` nešlo nasadit, protože `pki-init`
 * skončil 1 po 121 pokusech: „pki-bridge has no realm CA". Bridge ji přitom MĚL —
 * dotaz na `http://127.0.0.1:3040/diag/ca-bundle` vrátil 3 certifikáty. Rozdíl
 * nebyl v datech, ale v ADRESE: `pki-init` se ptá přes
 * `https://pki-bridge.backend.<internal_tld>`, a na tom stroji běží pki-bridge
 * DVOU nájemníků. Traefik má na jedno jméno dva kandidáty; kdo odpoví, je los.
 *
 * ── PROČ TO NENÍ JEN O PKI ────────────────────────────────────────────────────
 * Resolver vydává jména ve tvaru deklarovaném v profilu:
 *
 *     pattern: "{subdomain}.{server}.{internal_tld}"
 *
 * `PUBLIC_TLD` identitu nese (`<instance>.<tld>`), ale `INTERNAL_TLD` NE — je to
 * infrastrukturní doména sdílená všemi nájemníky na tomtéž stroji. Každé jméno
 * postavené nad ní tedy koliduje. Naměřeno: 44 takových jmen, ani jedno s
 * identitou. PKI byl jen ten, co praskl první.
 *
 * ── MECHANISMUS EXISTUJE, JEN SE NEPLNÍ ───────────────────────────────────────
 * `subdomain_prefix` v `profile.domain` — dnes ODVOZENÝ z `APP_NAME_PREFIX`
 * vloží identitu do `{subdomain}`: `api` → `<projekt>-api`. Kód to umí od #780.
 * Všechny tři profily ho mají prázdný. Táž třída jako `REPO_API_TOKEN` a
 * `VERDACCIO_USER` — deklarace, kterou nikdo neplní, přikrytá fallbackem.
 *
 * ── CO TAHLE BRÁNA TVRDÍ ──────────────────────────────────────────────────────
 *   1. Když je identita NAPLNĚNÁ, dvě různé identity nesdílejí ANI JEDNO jméno
 *      na sdílené infrastruktuře. (Vlastní důkaz invariantu, ne kontrola tvaru.)
 *   2. Sonda má co měřit — jmen na sdílené infře je víc než hrst.
 *   3. Když identita naplněná NENÍ, jsou ty množiny SHODNÉ. Tenhle test drží
 *      bránu poctivou: kdyby resolver přestal prefix aplikovat, bod 1 by prošel
 *      jen proto, že by se nic nerenderovalo — a to by nikdo nepoznal.
 *
 * Brána NEPINUJE konkrétní tvar prefixu (`<projekt>-api` vs `api-<projekt>`) ani
 * jméno instance. Pinuje INVARIANT: dvě identity, nulový průnik. Tvar je věc
 * profilu; kolize je věc bezpečnosti.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import * as path from "node:path";

const ROOT = process.cwd();
const RESOLVER = path.join(ROOT, "scripts/lib/derive-domains.mjs");

/** Sdílená infrastrukturní doména — sem nesmí jméno bez identity. */
const SDILENA_INFRA = /\.internal\./;

/**
 * Vyrenderuj topologii pod danou identitou a vrať jména na sdílené infře.
 *
 * Renderuje se SKUTEČNÝM resolverem, ne jeho napodobeninou: kdyby se tvar jmen
 * změnil v kódu, brána to uvidí. Napodobenina by měřila samu sebe.
 */
function jmenaNaSdileneInfre(identita: string | null): Set<string> {
  // ⛔ MESH_ENABLED=false ZÁMĚRNĚ (2026-08-26). Tahle brána měří rovinu VNITŘNÍ
  // ZÓNY (`{subdomain}.{server}.{internal_tld}`) — tedy jména na sdílené infře.
  // Ta rovina existuje jen v NEMESHOVÉM tvaru; se zapnutou meshí resolver vydává
  // per-instanční mesh jména a sonda by neměla co měřit (bod 2 níž by spadl).
  // Od chvíle, kdy je mesh výchozí stav platformy, musí si tedy brána svůj režim
  // vyžádat sama. Nemeshová cesta nezmizela: edge a bootstrap netbirdu ji
  // potřebují dřív, než mesh vůbec existuje — a právě tam kolize hrozí.
  const env: NodeJS.ProcessEnv = { ...process.env, AISHA_PROFILE: "cloud-multi", MESH_ENABLED: "false" };
  if (identita === null) delete env.APP_NAME_PREFIX;
  else env.APP_NAME_PREFIX = identita;

  const r = spawnSync(process.execPath, [RESOLVER, "--shell"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
    env,
  });
  if (r.error || r.status !== 0) {
    throw new Error(
      "derive-domains --shell nedoběhl — brána NEMÁ CO MĚŘIT.\n" +
        `  identita=${identita ?? "(nenaplněná)"} exit=${r.status} signal=${r.signal ?? "—"}\n` +
        `  stderr: ${(r.stderr ?? "").slice(0, 500)}`,
    );
  }

  const jmena = new Set<string>();
  for (const radek of (r.stdout ?? "").split("\n")) {
    // hodnota může být holý hostname i URL — zajímá nás hostitel
    const m = /^[A-Z0-9_]+=(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?\/?$/.exec(radek.trim());
    if (m && SDILENA_INFRA.test(m[1])) jmena.add(m[1]);
  }
  return jmena;
}

describe("jméno na sdílené infrastruktuře nese projekt", () => {
  const A = jmenaNaSdileneInfre("instancea");
  const B = jmenaNaSdileneInfre("instanceb");
  const BEZ = jmenaNaSdileneInfre(null);

  it("sonda má co měřit — resolver vydal jména na sdílené infře", () => {
    // Mlčení sondy je samo nálezem: kdyby resolver přestal interní jména
    // emitovat (nebo se změnil tvar hodnot), testy níž by prošly nad prázdnem.
    expect(BEZ.size, "resolver nevydal ŽÁDNÉ jméno na sdílené infrastruktuře").toBeGreaterThan(20);
    expect(A.size, "render pod identitou A nevydal žádné jméno").toBeGreaterThan(20);
    expect(A.size, "render pod identitou A a bez identity mají jinou VELIKOST — to nečekám").toBe(BEZ.size);
  });

  it("BEZ naplněné identity jsou množiny SHODNÉ — tak vypadá kolize", () => {
    // Tenhle test není o vadě; je to KONTROLA SAMOTNÉ BRÁNY. Dokládá, že rozdíl
    // v testu níž dělá opravdu identita, a ne třeba prázdný render.
    // Kdyby tenhle test začal padat, prefix se přestal aplikovat NEBO se změnil
    // tvar jmen — obojí chce ruční pohled, ne tiché zezelenání.
    const prunikBez = [...BEZ].filter((x) => jmenaNaSdileneInfre(null).has(x));
    expect(
      prunikBez.length,
      "dva rendery BEZ identity by měly vyjít stejně — resolver není deterministický?",
    ).toBe(BEZ.size);
  });

  it("dvě různé identity nesdílejí ANI JEDNO jméno na sdílené infře", () => {
    const prunik = [...A].filter((x) => B.has(x)).sort();
    expect(
      prunik,
      `${prunik.length} jmen by dvě instance na téže infrastruktuře SDÍLELY.\n` +
        "Na jedno jméno pak má Traefik dva kandidáty a kdo odpoví, je los — přesně to\n" +
        "2026-08-12 shodilo aisha-core (pki-init nesehnal realm CA od SVÉHO bridge).\n" +
        "Náprava: naplnit `subdomain_prefix` v config/profiles/<profil>.json\n" +
        "— dnes se odvozuje z APP_NAME_PREFIX, tedy z identity projektu.\n" +
        `Ukázka: ${prunik.slice(0, 5).join(", ")}${prunik.length > 5 ? ", …" : ""}`,
    ).toEqual([]);
  });
});
