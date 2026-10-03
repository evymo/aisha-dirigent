/**
 * Gate: the single-purpose mesh DNS resolver has a DURABLE, deterministic
 * address — so NETBIRD_DNS_IP self-sets, propagates on every deploy, and
 * survives a machine/container restart with no re-propagation.
 *
 * WHY THIS EXISTS (2026-07-22, rev 2)
 * ----------------------------------
 * The first cut discovered the resolver's live coolify-network IP at cold-start
 * and pushed it to consumers. That IP *churns* every restart (Coolify's dynamic
 * IPAM), so after a docker restart the whole mesh went dark until a manual
 * re-propagation — and a plain redeploy of one app (bypassing cold-start) came
 * up with the `${NETBIRD_DNS_IP:-127.0.0.11}` trap, which breaks even public DNS.
 *
 * The durable design removes the discovery entirely:
 *   1. the resolver (mesh-router) pins a STABLE ipv4_address on an instance-owned
 *      network (mesh-dns) whose address space we control — no coolify-IPAM churn,
 *   2. NETBIRD_DNS_IP is a DETERMINISTIC constant (generate-secrets derives it
 *      from the mesh-dns resolver IP), so coolify-sync-envs delivers it on every
 *      deploy and it never drifts,
 *   3. consumers attach to mesh-dns and their dns: fallback is the resolver IP,
 *      never the 127.0.0.11 trap.
 *
 * SELF-PROVISION (2026-07-24). mesh-dns was `external: true` in all 23 stacks — a
 * promise that create-netseg.sh pre-created it per host. That out-of-band step
 * never ran after #796 introduced the network, so every deploy died on "network
 * aisha-mesh-dns declared as external, but could not be found". The network is now
 * SELF-CREATING: every stack declares it non-external with the same name + subnet,
 * so the first stack on a host creates it and the rest attach (compose warns "not
 * created for project" and reuses — verified). No host step, no Coolify special.
 * The shared subnet keeps the resolver's .250 pin valid regardless of deploy order.
 *
 * This gate pins those invariants as PROPERTIES (derivation + pin + membership +
 * retry), not the spelling of any one line, so a refactor that reintroduces the
 * discover/churn or the trap fails loudly.
 */

import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { naSiti, reHost } from "./lib/vnitrni-adresa";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

const GEN = read("scripts/generate-secrets.mjs");
const COLD = read("scripts/aisha-cold-start.sh");
const PREBUILT = read("docker-compose.coolify-prebuilt.yml");

describe("mesh-DNS — NETBIRD_DNS_IP is a deterministic constant, not a discovered/churning IP", () => {
  test("generate-secrets DERIVES NETBIRD_DNS_IP from the mesh-dns resolver IP (not preserved/127.0.0.11)", () => {
    // The emit line must reference the resolver constant, and must NOT fall back
    // to the 127.0.0.11 trap or preserve a stale value (either reintroduces churn).
    const emitLine = GEN.split("\n").find((l) => /emit\(\s*['"]NETBIRD_DNS_IP['"]/.test(l)) || "";
    expect(emitLine, "generate-secrets must emit NETBIRD_DNS_IP").not.toBe("");
    expect(emitLine, "NETBIRD_DNS_IP must derive from the mesh-dns resolver IP").toMatch(/meshDnsResolverIp/);
    expect(
      /127\.0\.0\.11/.test(emitLine),
      "NETBIRD_DNS_IP must NOT default to the 127.0.0.11 trap",
    ).toBe(false);
    expect(
      /preservedValue\(\s*['"]NETBIRD_DNS_IP/.test(emitLine),
      "NETBIRD_DNS_IP must be hard-derived, not preservedValue (preserving is the churn bug)",
    ).toBe(false);
  });

  test("generate-secrets emits the mesh-dns network constants (network/subnet/resolver IP)", () => {
    for (const key of ["MESH_DNS_NETWORK", "MESH_DNS_SUBNET", "MESH_DNS_RESOLVER_IP"]) {
      expect(new RegExp(`emit\\(\\s*['"]${key}['"]`).test(GEN), `generate-secrets must emit ${key}`).toBe(true);
    }
    // Resolver IP is DERIVED from the mesh-dns subnet, never an unrelated literal.
    // Probe by MEANING, not by spelling: the derivation moved from an inline
    // `_meshDnsSubnet.replace(…)` into the named `resolverFor()` helper in
    // scripts/lib/derive-subnets.mjs (2026-08-11) and this assertion — pinned to
    // the old spelling — failed on a change that preserved the invariant exactly.
    // Either form is fine; an unexplained literal address is not.
    expect(
      /resolverFor\(|meshDnsSubnet\.replace\(|_sub\.meshDnsResolver/.test(GEN),
      "resolver IP must be derived from the mesh-dns subnet (resolverFor / _sub.meshDnsResolver)",
    ).toBe(true);
    expect(
      /emit\('MESH_DNS_RESOLVER_IP',\s*['"]\d+\.\d+\./.test(GEN),
      "resolver IP must not be emitted as a hardcoded address",
    ).toBe(false);
  });
});

describe("mesh-DNS — the resolver lives on an instance-owned network with a pinned IP", () => {
  test("cold-start mesh-dns síť NEPŘEDVYTVÁŘÍ (vlastní ji compose)", () => {
    // OTOČENO 2026-08-10. Předchozí znění tenhle blok VYŽADOVALO. Nefungoval
    // (`docker` tu mluví s lokálním démonem, ne s cílovým hostem — na varra síť
    // nikdy nevznikla) a po přechodu na compose-created by přímo škodil: síť bez
    // labelů `com.docker.compose.*` shodí každý stack, který ji považuje za svou.
    expect(
      COLD.includes("docker network create --subnet"),
      "cold-start předvytváří mesh-dns síť. Síť z CLI nemá compose labely, takže " +
        "stacky, které ji deklarují jako svou, umřou na `incorrect label ... set to \"\"`. " +
        "Zakládá si ji compose (networks.mesh-dns v docker-compose.coolify-*.yml).",
    ).toBe(false);

    // Jméno i subnet zůstávají INSTANČNÍ proměnné — cold-start je musí dodat do
    // prostředí, i když síť nevytváří.
    expect(COLD, "MESH_DNS_SUBNET musí zůstat v kontraktu prostředí").toMatch(/MESH_DNS_SUBNET/);
  });

  test("mesh-router PINS the resolver IP on the mesh-dns network (deterministic, from the env constant)", () => {
    // ipv4_address must be present and sourced from MESH_DNS_RESOLVER_IP — a
    // deterministic pin, so the resolver's address never moves across restarts.
    expect(PREBUILT, "mesh-router must pin ipv4_address on mesh-dns").toMatch(
      /mesh-dns:\s*\n(?:\s{8,}[^\n]*\n)*?\s*ipv4_address:\s*\$\{MESH_DNS_RESOLVER_IP/,
    );
    // The network must always be NAMED from the constant — that is what makes the
    // .250 pin land in an address space we control, in BOTH valid shapes.
    expect(PREBUILT, "mesh-dns network must be named from MESH_DNS_NETWORK").toMatch(
      /^\s{2}mesh-dns:\n(?:\s*#[^\n]*\n|\s*external:\s*true\n|\s*\n)*\s*name:\s*\$\{MESH_DNS_NETWORK/m,
    );

    // …and the SUBNET must be pinned to MESH_DNS_SUBNET — but WHERE depends on the
    // shape, and asserting only the self-provisioning place is what made this gate
    // reject the migration it documents two comments below:
    //   self-provisioning → `ipam.config[].subnet` right here in the compose
    //   external: true    → compose MAY NOT carry ipam; the subnet lives on the
    //                       network the cold start creates (`docker network create
    //                       --subnet "$MESH_DNS_SUBNET"`), which is the same constant.
    // Assert the PROPERTY — the subnet is pinned to the constant somewhere that
    // governs this network — not the one spelling.
    const meshBlock = PREBUILT.match(/^\s{2}mesh-dns:\n(?:\s{4}[^\n]*\n|\s*\n)*/m)?.[0] ?? "";
    const isExternal = /^\s*external:\s*true/m.test(
      meshBlock.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n"),
    );
    if (isExternal) {
      // ZMĚNĚNO 2026-08-11: subnet už nezakládá cold-start (mluvil s lokálním
      // démonem, na cílový host nedosáhl), ale WARMUP aplikace běžící NA HOSTU.
      // Pin .250 dostává svůj prostor odtamtud — a subnet musí přijít z TÉŽE
      // proměnné, jinak by pin skončil mimo síť.
      const warmup = readFileSync(join(ROOT, "docker-compose.coolify-netinit.yml"), "utf-8");
      expect(
        warmup,
        "external mesh-dns: warmup ji musí zakládat se subnetem z MESH_DNS_SUBNET (odtud má pin .250 svůj prostor)",
      ).toMatch(/MESH_DNS_SUBNET/);
      expect(
        warmup,
        "warmup musí síť opravdu vytvářet, ne jen znát její jméno",
      ).toMatch(/docker network create/);
    } else {
      expect(
        PREBUILT,
        "self-provisioned mesh-dns must carry the subnet from MESH_DNS_SUBNET (so the .250 pin is valid)",
      ).toMatch(/subnet:\s*\$\{MESH_DNS_SUBNET/);
    }
    // NOT "must not be external". Ownership moved to the INSTANCE (caf7e93c,
    // 2026-07-28): cold-start creates the network idempotently, so a stack may
    // legitimately declare it external. What must hold either way is that the
    // declaration is one of the two VALID shapes — the assertions above cover
    // the self-provisioning one; external is the other. A stack that is neither
    // is caught by the class test below.
  });

  /**
   * SMĚR OTOČEN 2026-08-10 — a otočilo ho měření, ne názor.
   *
   * Do té doby tenhle test hlídal ráčnu OPAČNĚ: síť měl vytvářet cold-start a
   * stacky se k ní hlásit jako `external: true`, takže počet „self-provisioning"
   * stacků směl jen klesat (baseline 21). Zdůvodnění znělo: síť z `docker network
   * create` nemá compose labely, takže compose, který ji považuje za svou, se na
   * ni odmítne připojit.
   *
   * To zdůvodnění PLATÍ — jen z něj plyne přesný opak. Naměřeno na živém hostu:
   *   síť vytvořil            | compose ne-external      | compose external
   *   jiný compose projekt    | varuje, FUNGUJE          | funguje
   *   `docker network create` | PADÁ (incorrect label)   | funguje
   *   neexistuje              | vytvoří ji               | PADÁ
   * Poslední řádek je ten, který dřív nikdo neproměřil: `external` je slib, že
   * síť už existuje — a cold-start ji vytvářet NEMOHL, protože mluví s LOKÁLNÍM
   * démonem, ne s cílovým hostem. Na giah/talos přežívala jen jako sirotek po
   * smazaném projektu; na varra NEEXISTOVALA a local-ingest spadl na
   * "network aisha-mesh-dns declared as external, but could not be found".
   *
   * Obava z „jednoho subnetu pro všechny instance" taky neplatí: jméno i subnet
   * jsou instanční proměnné (`${MESH_DNS_NETWORK}` / `${MESH_DNS_SUBNET}`), takže
   * dvě instance na jednom hostu dostanou různé sítě.
   *
   * Rozhodnutí je tím uzavřené a platí pro VŠECHNY stacky naráz — ráčna už nemá
   * co chránit, takže invariant je absolutní.
   */
  test("mesh-dns je EXTERNAL všude — zakládá ji warmup, ne stack", () => {
    // SMĚR OTOČEN PODRUHÉ, 2026-08-11 — a zase to otočilo měření, ne názor.
    //
    // Verze 1 (do 08-10): external všude, síť měl předvytvořit cold-start.
    //   Nefungovalo: cold-start mluví s LOKÁLNÍM démonem, na varra síť nevznikla
    //   a deploy padl na "declared as external, but could not be found".
    // Verze 2 (08-10): síť si zakládá compose (ne-external).
    //   Taky špatně: vlastník sítě ji při teardownu MAŽE, a když na ní visí
    //   kontejner jiného projektu, spadne nasazení — přesně tak umřel
    //   aisha-clamav ("network ... has active endpoints").
    // Verze 3 (dnes): external všude + WARMUP aplikace s docker.sock, která
    //   běží NA HOSTU, sítě založí přes CLI a skončí. Nikdo je nevlastní, takže
    //   je nikdo nemaže; a vzniknou na každém stroji, ne jen tam, kde náhodou
    //   přežily. Cold-start warmup po rolloutu smaže, takže socket nezůstává.
    //
    // Obě předchozí verze byly půl pravdy. Chybějící kus byl pokaždé jiný řádek
    // téže tabulky, kterou nikdo nedoměřil do konce.
    const files = readdirSync(ROOT).filter(
      (f) => f.startsWith("docker-compose.coolify-") && f.endsWith(".yml"),
    );

    const vlastni: string[] = [];
    const external: string[] = [];
    for (const f of files) {
      if (f === "docker-compose.coolify-netinit.yml") continue;   // warmup sítě nedeklaruje
      const body = read(f);
      if (!/\n {2}mesh-dns:\s*\n/.test(body)) continue;
      if (/mesh-dns:\s*\n(?:\s*#[^\n]*\n)*\s*external:\s*true/.test(body)) external.push(f);
      else vlastni.push(f);
    }

    expect(external.length, "brána nenašla ŽÁDNOU deklaraci mesh-dns — buď zmizely, nebo přestala měřit")
      .toBeGreaterThan(15);

    expect(
      vlastni,
      `mesh-dns je tu VLASTNĚNÁ compose. Vlastnictví nese i mazání: při teardownu ` +
        `se ji compose pokusí smazat a nasazení spadne, jakmile na ní visí kontejner ` +
        `jiného projektu. Musí být external — zakládá ji warmup ` +
        `(docker-compose.coolify-netinit.yml):\n${vlastni.map((f) => `  ${f}`).join("\n")}`,
    ).toEqual([]);
  });

  test("warmup existuje, montuje socket a zakládá obě sítě instance", () => {
    const w = join(ROOT, "docker-compose.coolify-netinit.yml");
    expect(existsSync(w), "chybí warmup — externí sítě instance nemá kdo založit").toBe(true);
    const src = readFileSync(w, "utf-8");
    expect(src, "warmup potřebuje docker.sock, jinak síť na hostiteli nevytvoří").toMatch(/docker\.sock/);
    expect(src, "warmup musí sítě opravdu zakládat").toMatch(/docker network create/);
    expect(src, "warmup zakládá sdílenou síť instance").toMatch(/APP_NAME_PREFIX[^\n]*-shared-net/);
    expect(src, "warmup zakládá mesh-DNS síť").toMatch(/MESH_DNS_NETWORK/);
    expect(src, "mesh-DNS potřebuje subnet — mesh-router si na ní pinuje IP").toMatch(/MESH_DNS_SUBNET/);
    // Warmup sám NESMÍ mít externí síť: compose je ověřuje PŘED spuštěním
    // kontejneru, takže by se nespustil a nic by nezaložil (změřeno 2026-08-11).
    expect(src, "warmup nesmí deklarovat externí síť — nespustil by se").not.toMatch(/external:\s*true/);
  });
});

describe("mesh-DNS — resilience: the resolver self-heals enrollment", () => {
  test("mesh-router retries netbird enrollment instead of giving up on the first failure", () => {
    // A cold boot can bring the netbird management plane up AFTER mesh-router; a
    // single-shot enroll then dies and the mesh stays dark. The entrypoint must
    // loop, and must NOT fall through to a terminal `exec sleep infinity` on the
    // FIRST netbird exit.
    expect(PREBUILT, "enrollment must be wrapped in a retry loop").toMatch(/while true; do[\s\S]*netbird up[\s\S]*done/);
    expect(PREBUILT, "a retry/backoff must follow a netbird exit").toMatch(/netbird exited[^\n]*retry/i);
  });
});

describe("mesh-DNS — Phase F no longer discovers or re-propagates (that was the churn)", () => {
  const start = COLD.indexOf("Phase F:");
  const end = COLD.indexOf('step "6.');
  const block = start > -1 && end > start ? COLD.slice(start, end) : "";

  test("Phase F exists and only POPULATES the zone", () => {
    expect(start, "Phase F must exist").toBeGreaterThan(-1);
    expect(block, "Phase F still provisions netbird records").toMatch(/netbird-dns-provision\.mjs/);
  });

  test("Phase F does NOT discover the resolver IP or upsert/redeploy consumers", () => {
    // The value is deterministic now — no live discovery, no env upsert of
    // NETBIRD_DNS_IP, no consumer redeploy loop inside Phase F.
    expect(/_dns_upsert\s+NETBIRD_DNS_IP/.test(block), "no NETBIRD_DNS_IP upsert in Phase F").toBe(false);
    expect(
      /docker inspect[\s\S]{0,120}coolify[\s\S]{0,40}IPAddress/.test(block),
      "no live discovery of the resolver's coolify IP",
    ).toBe(false);
    expect(/REDEPLOY=1[^\n]*coolify-sync-envs/.test(block), "no consumer redeploy inside Phase F").toBe(false);
  });
});

describe("mesh-DNS — no consumer keeps the 127.0.0.11 trap", () => {
  test("no docker-compose.coolify-*.yml uses the ${NETBIRD_DNS_IP:-127.0.0.11} fallback", () => {
    const files = readdirSync(ROOT).filter((f) => /^docker-compose\.coolify-.*\.yml$/.test(f));
    expect(files.length, "consumer composes must be found").toBeGreaterThan(0);
    const offenders = files.filter((f) => /NETBIRD_DNS_IP:-127\.0\.0\.11/.test(read(f)));
    expect(offenders, "the 127.0.0.11 fallback trap must be gone everywhere").toEqual([]);
  });
});
