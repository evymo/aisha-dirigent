/**
 * @file External-network reachability gate
 *
 * WHY THIS EXISTS — a docker network is per-HOST, and `external: true` is a promise that
 * someone else already created it. Nothing in this repo creates `aisha_internal`, on any
 * server. Two stacks promised it anyway:
 *
 *   networks:
 *     internal:
 *       name: aisha_internal     # nobody ever created this
 *       external: true
 *
 * so every deploy of them died at
 *   Error: network aisha_internal declared as external, but could not be found
 *
 * aisha-monitoring had been failing on this for as long as the file existed — invisible,
 * because no deploy wave had touched it. pgadmin inherited the same block when it was
 * extracted from the core stack in #731: the block was copied from a stack that worked,
 * but the WRONG one, and it was never deployed, so nothing said so.
 *
 * THE RULE. Every `external: true` network must resolve to a network this repo can
 * account for. Three sources qualify:
 *   - `coolify` — created by Coolify itself on every server. 21 of 23 stacks alias it,
 *     deliberately: per-stack bridges exhaust Docker's default address pool (see the
 *     comment in docker-compose.coolify.yml).
 *   - a network another compose file in this repo CREATES (declares without `external`).
 *   - a network a provisioning script in this repo CREATES via `docker network create`.
 * Anything else is a promise nobody keeps, and it fails at deploy time — on a server, at
 * the worst moment — rather than here.
 *
 * The third source is not a concession, it is the rule being correct. The first draft of
 * this gate only read compose files and therefore flagged docker-compose.coolify.netseg.yml
 * (the WP 3.4 network-segmentation overlay), whose aisha-{frontend,backend,data}-net ARE
 * created — by scripts/infra/create-netseg.sh, run per host before the overlay is applied.
 * That is a legitimate design: the overlay is applied with `-f`, is in no manifest, and its
 * networks are provisioned out-of-band on purpose. Allowlisting it would have cemented the
 * gate's own blind spot; reading the script fixes the rule instead.
 *
 * Structural: the allowed set is DERIVED — from the compose files (what do we create?), the
 * provisioning scripts (what do they create?), and the one network Coolify guarantees. Add a
 * stack or a script that creates a network and referencing it is permitted automatically.
 * No maintained list.
 *
 * Hard-fails. This class was found by reading a production deploy log, not by CI — the
 * whole point is that CI says it first next time.
 */

import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const INFRA_SCRIPTS = join(ROOT, "scripts", "infra");

/** Coolify creates this on every server it manages; it is the one safe external. */
const COOLIFY_MANAGED = new Set(["coolify"]);

/**
 * Networks provisioned out-of-band by a script rather than by a compose file.
 * Derived by reading the scripts, not by listing names here: a script that declares
 * `"<net-name>:<subnet>"` entries and calls `docker network create` is provisioning them.
 */
/**
 * Sítě, které zakládá WARMUP aplikace (docker-compose.coolify-netinit.yml).
 *
 * PŘIBYLO 2026-08-11. Do té doby uměla brána uznat jen dva plnitele slibu
 * `external: true` — jiný compose, který síť VYTVÁŘÍ, a skript v scripts/infra.
 * Oba jsou pro sítě instance nepoužitelné:
 *   - compose, který síť vlastní, ji při teardownu MAŽE, a když na ní visí
 *     kontejner jiného projektu, spadne nasazení (naměřeno na aisha-clamav);
 *   - skript v scripts/infra běží u operátora, ne na cílovém hostu, takže na
 *     vzdáleném stroji nevytvoří nic (naměřeno: na varra síť prostě nebyla).
 * Třetí plnitel je warmup: kontejner s docker.sock, který běží NA HOSTU, sítě
 * založí přes CLI a skončí. Síť tím nikdo nevlastní, takže ji ani nikdo nemaže.
 */
function warmupProvisionedVars(): Set<string> {
  const vars = new Set<string>();
  const f = join(ROOT, "docker-compose.coolify-netinit.yml");
  if (!existsSync(f)) return vars;
  const src = readFileSync(f, "utf-8");
  if (!/docker\.sock/.test(src) || !/docker network create/.test(src)) return vars;
  // Jména sítí přicházejí do warmupu proměnnými prostředí; posbírej, co dosazuje.
  for (const m of src.matchAll(/^\s+([A-Z_][A-Z0-9_]*):\s*\$\{([A-Z_][A-Z0-9_]*)[:}]/gm)) {
    vars.add(m[2]);           // proměnná, ze které se jméno bere
  }
  return vars;
}

function scriptProvisionedNetworks(): { names: Set<string>; vars: Set<string> } {
  const names = new Set<string>();
  // Sítě pojmenované PROMĚNNOU, kterou zakládající skript sám čte.
  //
  // PROČ (2026-08-05): jméno mesh-DNS sítě mělo tři domovy, které si
  // odporovaly — generate-secrets vydává INSTANČNÍ `${deployPrefix}-mesh-dns`
  // (víc instancí na hostu = různé sítě), cold-start zakládá z proměnné, ale
  // create-netseg.sh deklaroval literál `aisha-mesh-dns` a compose měl týž
  // literál ve fallbacku. Tahle brána pak držela zelenou přes literál, který
  // se v instanci nikdy nezaložil: slib byl formálně splněný a fakticky ne.
  //
  // Vlastnost, která to nese doopravdy: externí síť pojmenovaná `${VAR:?…}`
  // je slib splněný tehdy, když zakládající skript deklaruje síť z TÉŽE
  // proměnné. Jedno jméno, jeden domov (ta proměnná), dva čtenáři.
  const vars = new Set<string>();
  if (!existsSync(INFRA_SCRIPTS)) return { names, vars };
  for (const f of readdirSync(INFRA_SCRIPTS).filter((f) => f.endsWith(".sh"))) {
    const src = readFileSync(join(INFRA_SCRIPTS, f), "utf-8");
    // Only trust a script that actually creates networks.
    if (!/docker\s+network\s+create/.test(src)) continue;
    // "<name>:<subnet-or-var>" entries, e.g. "aisha-backend-net:${AISHA_NETSEG_BACKEND_SUBNET:-172.31.0.0/24}"
    for (const m of src.matchAll(/^\s*"([a-z0-9][a-z0-9_-]*):\$?\{?[^"]*"/gim)) names.add(m[1]);
    // "${VAR:?…}:<subnet>" entries — the network's ONE home is the variable.
    for (const m of src.matchAll(/^\s*"\$\{([A-Za-z_][A-Za-z0-9_]*)[:}][^"]*"/gim)) vars.add(m[1]);
  }
  return { names, vars };
}

type NetDecl = { file: string; key: string; name: string; external: boolean };

/** Parse the top-level `networks:` block. Deliberately small — compose network blocks are flat. */
function parseNetworks(file: string, src: string): NetDecl[] {
  const lines = src.split("\n");
  const start = lines.findIndex((l) => /^networks:\s*$/.test(l));
  if (start === -1) return [];

  const out: NetDecl[] = [];
  let key: string | null = null;
  let name: string | null = null;
  let external = false;

  const flush = () => {
    if (key) out.push({ file, key, name: name ?? key, external });
    key = null;
    name = null;
    external = false;
  };

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line) && line.trim() !== "") break; // left the block
    if (line.trim() === "" || line.trim().startsWith("#")) continue;

    const entry = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (entry) {
      flush();
      key = entry[1];
      continue;
    }
    const nameM = line.match(/^ {4}name:\s*(\S+)/);
    if (nameM) name = nameM[1];
    const extM = line.match(/^ {4}external:\s*(\S+)/);
    if (extM) external = extM[1] === "true";
  }
  flush();
  return out;
}

function composeFiles(): string[] {
  return readdirSync(ROOT).filter((f) => /^docker-compose\..*\.ya?ml$/.test(f) || f === "docker-compose.yml");
}

describe("compose — every external network must actually exist somewhere", () => {
  const decls = composeFiles().flatMap((f) => parseNetworks(f, readFileSync(join(ROOT, f), "utf-8")));

  test("compose files were found and parsed", () => {
    expect(decls.length).toBeGreaterThan(0);
  });

  test("no `external: true` network is a promise nobody keeps", () => {
    // Derived, not maintained: a network is referenceable if a compose file CREATES it
    // (declares it without external: true), a provisioning script creates it, or Coolify
    // guarantees it.
    const createdByCompose = new Set<string>(decls.filter((d) => !d.external).map((d) => d.name));
    const createdByScript = scriptProvisionedNetworks();
    const createdByWarmup = warmupProvisionedVars();
    const available = new Set<string>([...COOLIFY_MANAGED, ...createdByCompose, ...createdByScript.names]);

    // An external network may be named by an env var with a default —
    // `name: ${MESH_DNS_NETWORK:-aisha-mesh-dns}` — so an instance can rename it
    // (several instances on one host need distinct networks) while the DEFAULT is
    // the reference the repo actually provisions. Resolve `${VAR:-default}` to its
    // default for the existence check: a literal default that a provisioning
    // script creates keeps the promise; a bare `${VAR}` (no default) does not and
    // is still flagged.
    const resolveDefault = (n: string): string => {
      const m = n.match(/^\$\{[A-Za-z_][A-Za-z0-9_]*:-([^}]+)\}$/);
      return m ? m[1] : n;
    };
    // `name: ${VAR:?…}` — no default on purpose (a guessed name silently forks
    // the network). The promise is kept when a provisioning script creates the
    // network from the SAME variable — one name, one home, two readers.
    const varOf = (n: string): string | null => {
      const m = n.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)[:}]/);
      return m ? m[1] : null;
    };
    // Slib je splněný, když síť z TÉŽE proměnné zakládá skript v scripts/infra
    // NEBO warmup aplikace. Warmup je jediný plnitel, který funguje na VZDÁLENÉM
    // hostu — proto tu je; skript u operátora tam nedosáhne.
    const keptByVariable = (n: string): boolean => {
      const v = varOf(n);
      return v !== null && (createdByScript.vars.has(v) || createdByWarmup.has(v));
    };

    const offenders = decls
      .filter((d) => d.external && !available.has(resolveDefault(d.name)) && !keptByVariable(d.name))
      .map(
        (d) =>
          `${d.file}: networks.${d.key} declares external network "${d.name}", but nothing in this repo ` +
          `creates it — no compose file, no scripts/infra/*.sh, and Coolify does not manage it. ` +
          `A docker network is per-HOST, so this fails at deploy with ` +
          `'network ${d.name} declared as external, but could not be found'. ` +
          `Either alias the coolify network ({ external: true, name: coolify }) or add a ` +
          `provisioning script that creates it.`,
      )
      .sort();

    expect(offenders).toEqual([]);
  });

  test("síť s přišpendlenou IP deklaruje svůj subnet", () => {
    // NAMĚŘENO 2026-08-10. `mesh-router` si na síti `mesh-dns` pinuje
    // `ipv4_address: ${MESH_DNS_RESOLVER_IP}`. Dokud byla síť `external: true`,
    // subnet určoval ten, kdo ji náhodou založil — a na varra ji nezaložil
    // NIKDO, takže deploy padal na "declared as external, but could not be
    // found". Teď si síť zakládá compose, a tím pádem MUSÍ vědět, do jakého
    // rozsahu ten pin patří: bez `ipam` vybere Docker rozsah sám a pin je mimo.
    //
    // INVARIANT: pinuje-li kterákoli služba IP na síti, musí každý compose,
    // který tu síť VYTVÁŘÍ, deklarovat i `ipam.config.subnet`.
    const pinned = new Set<string>();
    for (const f of composeFiles()) {
      const src = readFileSync(join(ROOT, f), "utf-8");
      // `networks: { <klíč>: { ipv4_address: … } }` — klíč je nejbližší
      // předchozí řádek s odsazením o 2 menším než `ipv4_address`.
      const lines = src.split("\n");
      lines.forEach((l, i) => {
        if (!/^\s+ipv4_address:/.test(l)) return;
        const ind = l.search(/\S/);
        for (let j = i - 1; j >= 0; j--) {
          const m = lines[j].match(/^(\s+)([A-Za-z0-9_.-]+):\s*$/);
          if (m && m[1].length === ind - 2) { pinned.add(m[2]); break; }
        }
      });
    }

    expect(pinned.size, "brána nenašla ŽÁDNÝ pin — buď zmizel, nebo přestala měřit").toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const f of composeFiles()) {
      const src = readFileSync(join(ROOT, f), "utf-8");
      const decls = parseNetworks(f, src);
      for (const d of decls) {
        if (!pinned.has(d.key) || d.external) continue;   // external neřídíme my
        // Blok se vybírá ŘÁDKOVĚ, ne regexem: v multiline režimu matchne `$`
        // konec PRVNÍHO řádku, takže `(?=…|$)` vrátí prázdno a brána by
        // hlásila nález u všech (změřeno při psaní téhle brány).
        const ls = src.split("\n");
        const start = ls.findIndex((l) => l === `  ${d.key}:`);
        let konec = ls.length;
        for (let i = start + 1; start !== -1 && i < ls.length; i++) {
          if (/^ {2}\S/.test(ls[i]) || (/^\S/.test(ls[i]) && ls[i].trim() !== "")) { konec = i; break; }
        }
        const blok = start === -1 ? "" : ls.slice(start, konec).join("\n");
        if (!/subnet:/.test(blok)) {
          offenders.push(
            `${f}: síť "${d.key}" ji VYTVÁŘÍ, ale nedeklaruje ipam.config.subnet — ` +
              `některá služba si na ní pinuje ipv4_address a Docker jí přidělí náhodný rozsah, ` +
              `takže pin bude mimo síť a kontejner nenastartuje.`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("`internal` NIKDY není globální síť `coolify`", () => {
    // OTOČENO 2026-08-10. Předchozí znění vyžadovalo pravý opak — `internal`
    // musí být alias `coolify` — s odůvodněním, že per-stack bridge vyčerpají
    // adresní pool Dockeru. Ten důvod platí, ale závěr z něj neplynul: 28 compose
    // říkalo `internal` a myslelo tím SDÍLENOU SÍŤ CELÉHO HOSTITELE. Klíč sliboval
    // izolaci, hodnota ji rušila — a proto si toho při čtení služby nikdo nevšiml.
    //
    // Důsledek byl měřitelný: 116 služeb viselo na `coolify` (potřebovalo ji 21),
    // takže cizí nájemník na témž stroji viděl naše `db`, `redis`, `clamav`,
    // `keycloak`… a Docker DNS mezi stejnojmennými aliasy STŘÍDAL. Tak nikdy
    // nenabootovalo PKI: `pki-db` se trefovalo do databáze cizí instance.
    //
    // Pool se přitom nevyčerpá: všech 28 stacků deklaruje TOTOŽNÉ jméno
    // `${APP_NAME_PREFIX}-shared-net`, takže na hostu vznikne JEDNA síť navíc,
    // ne 28. Naměřeno na živém hostu 2026-08-10 (compose v2.38):
    //
    //   síť vytvořil            | compose ji má NE-external | má ji EXTERNAL
    //   ------------------------|---------------------------|----------------
    //   jiný compose projekt    | ⚠ varuje, FUNGUJE         | funguje
    //   `docker network create` | ✗ PADÁ (incorrect label)  | funguje
    //   neexistuje              | vytvoří ji                | ✗ padá
    //
    // Proto je instanční síť VYTVÁŘENÁ (ne-external): první stack ji založí,
    // ostatní se připojí. Žádné předvytváření, žádná závislost na pořadí vln —
    // a po `--wipe` se obnoví sama. Předvytvořit ji z cold-startu by bylo HORŠÍ:
    // síť z CLI nemá compose labely a každý ne-external konzument by na ní umřel.
    const offenders = decls
      .filter((d) => d.key === "internal" && d.name === "coolify")
      .map(
        (d) =>
          `${d.file}: networks.internal ukazuje na globální "coolify" — sdílenou síť CELÉHO hostitele. ` +
          `Jméno slibuje izolaci, hodnota ji ruší: cizí nájemník uvidí naše služby a Docker DNS bude ` +
          `mezi stejnojmennými aliasy střídat. Použij instanční síť: ` +
          `{ name: \${APP_NAME_PREFIX:?}-shared-net, driver: bridge }. Ingress (Traefik) se řeší ` +
          `SAMOSTATNÝM klíčem \`coolify\` jen u služeb, které mají doménu.`,
      )
      .sort();

    expect(offenders).toEqual([]);
  });
});
