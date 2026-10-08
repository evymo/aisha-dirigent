/**
 * Brána: bootstrap MODELOVÉHO meshe forku (varianta C) — chování proti stubu API.
 *
 * Kontrakt meshe 0c v4 + čtení rady cb ke kroku 3 (2026-10-05, aisha-team review — kontrakt accel)
 * + bezpečnostní revize commitu kroku 3 (2026-10-05):
 *   · P1 důvěrnost — kdo je ve skupině uzlu `model-gpu`, dostává prompty forku: smí tam být
 *     PRÁVĚ JEDEN peer s deklarovaným jménem (MODEL_MESH_GPU_PEER) a — po prvním zápisu —
 *     s PŘIPNUTÝM id (jméno si peer volí sám). Cizí peer = incident: odebrat a ZASTAVIT;
 *     dva deklarované = nerozhodnutelné → STOP.
 *   · P2 výměna uzlu — deklarovaný peer odpojený déle než limit se odebere (připnutí se
 *     zruší) a teprve pak vznikne nový klíč; čerstvě odpojený (restart) se nechá být.
 *   · O klíči rozhoduje STAV PEERU; nový klíč jen tehdy, když starý prokazatelně NEPLATÍ.
 *   · O8 — v meshi JEDINÁ politika most → uzel, TCP, jednosměrně; výsledek se ověřuje
 *     ZPĚTNÝM ČTENÍM (server, který změnu tiše nepřijme, = selhání, ne „hotovo“).
 *   · Pověření hlavního meshe se modelové rovině neposílají (jen Bearer bootstrap uživatele).
 * Testy pouštějí SKUTEČNÉ funkce skriptu (šev NETBIRD_BOOTSTRAP_LIB_ONLY) proti stubu
 * `netbird_api` se STAVEM (změny se promítají), takže tvrdí CHOVÁNÍ, ne pravopis řádků.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = process.cwd();
const BOOTSTRAP = join(ROOT, "scripts/netbird-bootstrap.sh");
const HAS_JQ = spawnSync("jq", ["--version"]).status === 0;

let workdir: string;
beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), "nb-model-"));
});
afterAll(() => rmSync(workdir, { recursive: true, force: true }));

type Peer = { id: string; name: string; connected: boolean; last_seen?: string; ip?: string; groups: Array<{ id: string }> };
type Opts = {
  peery?: Peer[];
  politiky?: unknown[];
  klice?: Array<{ id: string; state?: string; revoked?: boolean; auto_groups?: string[] }>;
  ulozeneId?: string;
  pin?: string;
  ignoruj?: Array<"policy-delete" | "key-delete">; // server změnu tiše nepřijme
  peersChyba?: boolean; // GET /api/peers vrátí chybový objekt (401) místo seznamu
  klicSiroky?: boolean; // server vytvoří jiný klíč, než se žádalo (reusable, jiná skupina)
  env?: string[]; // další řádky .env.coolify
};
type Vysledek = { rc: number | null; stderr: string; stdout: string; env: Record<string, string>; volani: string[] };

const GPU = "grp-gpu";
const MOST = "grp-most";
const UZEL = "testfork-model";
const DAVNO = "2026-01-01T00:00:00.123456Z";

function spust(prikaz: string, opts: Opts): Vysledek {
  const scen = mkdtempSync(join(workdir, "scen-"));
  const envFile = join(scen, "env.coolify");
  const lines = [
    "KEYCLOAK_DOMAIN=auth.invalid",
    "KEYCLOAK_REALM=test",
    "NETBIRD_API_URL=http://netbird.invalid",
    "NETBIRD_AUTH_SCHEME=Token",
    "NETBIRD_API_TOKEN=stub",
  ];
  if (opts.ulozeneId) lines.push("MODEL_MESH_SETUP_KEY=stary", `MODEL_MESH_SETUP_KEY_ID=${opts.ulozeneId}`);
  if (opts.pin) lines.push(`MODEL_MESH_GPU_PEER_ID=${opts.pin}`);
  if (opts.env) lines.push(...opts.env);
  writeFileSync(envFile, lines.join("\n") + "\n");
  const stav = join(scen, "stav.json");
  writeFileSync(
    stav,
    JSON.stringify({
      peers: opts.peery ?? [],
      policies: opts.politiky ?? [],
      groups: [{ id: GPU, name: "model-gpu" }, { id: MOST, name: "model-most" }],
      keys: opts.klice ?? (opts.ulozeneId ? [{ id: opts.ulozeneId, state: "valid", revoked: false }] : []),
    }),
  );
  const ign = new Set(opts.ignoruj ?? []);
  const postKlic = opts.klicSiroky
    ? `uprav '.keys += [{id: "novy-id", state: "valid", revoked: false, type: "reusable", usage_limit: 0, auto_groups: ["grp-jina"]}]'`
    : `uprav --argjson p "$data" --arg kid "$kid" '.keys += [$p + {id: $kid, state: "valid", revoked: false}]'`;
  const log = join(scen, "volani.log");
  const harness = join(scen, "h.sh");
  writeFileSync(
    harness,
    `#!/usr/bin/env bash
set -uo pipefail
export ENV_FILE="${envFile}"
export SKIP_KEYCLOAK_GATE=1 DRY_RUN=0 SYNC_COOLIFY=0 NETBIRD_BOOTSTRAP_LIB_ONLY=1
source "${BOOTSTRAP}"
S="${stav}"
uprav(){ jq -c "$@" "$S" > "$S.n" && mv "$S.n" "$S"; }
netbird_api() {
  local method="$1" path="$2" data="\${3:-}"
  printf '%s %s %s\\n' "$method" "$path" "$(printf '%s' "$data" | tr -d '\\n')" >> "${log}"
  case "$method $path" in
    "GET /api/peers") ${opts.peersChyba ? `printf '%s' '{"message":"token invalid","code":401}'` : `jq -c '.peers' "$S"`} ;;
    "DELETE /api/peers/"*) uprav --arg i "\${path##*/}" '.peers |= map(select(.id != $i))' ;;
    "GET /api/setup-keys") jq -c '.keys' "$S" ;;
    "GET /api/groups") jq -c '.groups' "$S" ;;
    "POST /api/setup-keys")
      kid="novy-id"; kkey="NOVY-KLIC"
      if [ "$(printf '%s' "$data" | jq -r '.auto_groups[0] // ""')" = "${MOST}" ]; then kid="novy-most-id"; kkey="NOVY-KLIC-MOST"; fi
      ${postKlic}; printf '{"id":"%s","key":"%s"}' "$kid" "$kkey" ;;
    "DELETE /api/setup-keys/"*) ${ign.has("key-delete") ? ":" : `uprav --arg i "\${path##*/}" '.keys |= map(select(.id != $i))'`} ;;
    "GET /api/policies") jq -c '.policies' "$S" ;;
    "DELETE /api/policies/"*) ${ign.has("policy-delete") ? ":" : `uprav --arg i "\${path##*/}" '.policies |= map(select(.id != $i))'`} ;;
    "POST /api/policies") uprav --argjson p "$data" '.policies += [$p + {id: "p-nova"}]' ;;
    "PUT /api/policies/"*) uprav --arg i "\${path##*/}" --argjson p "$data" '.policies |= map(if .id == $i then ($p + {id: $i}) else . end)' ;;
    *) printf '%s' '{}' ;;
  esac
}
${prikaz}
`,
    { mode: 0o755 },
  );
  const r = spawnSync("bash", [harness], { encoding: "utf-8", timeout: 30_000 });
  const env: Record<string, string> = {};
  for (const line of readFileSync(envFile, "utf-8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
  }
  const volani = existsSync(log) ? readFileSync(log, "utf-8").split("\n").filter(Boolean) : [];
  return { rc: r.status, stderr: r.stderr ?? "", stdout: r.stdout ?? "", env, volani };
}

const KLIC = `model_zajisti_klic_uzlu MODEL_MESH_SETUP_KEY ${UZEL} ${GPU} ${UZEL} 900 86400 MODEL_MESH_GPU_PEER_ID`;
const nas = (o: Partial<Peer> = {}): Peer => ({ id: "p1", name: UZEL, connected: true, groups: [{ id: GPU }], ...o });
const vydal = (v: Vysledek) => v.volani.filter((c) => c.startsWith("POST /api/setup-keys"));
const odebral = (v: Vysledek) => v.volani.filter((c) => c.startsWith("DELETE /api/peers/")).map((c) => c.split(" ")[1].split("/").pop());

describe.skipIf(!HAS_JQ)("modelový mesh: klíč uzlu podle stavu peeru (P1, P2, C1)", () => {
  test("žádný peer → jednorázový klíč jen pro skupinu uzlu, s id v env", () => {
    const v = spust(KLIC, {});
    expect(v.rc, v.stderr).toBe(0);
    expect(vydal(v)).toHaveLength(1);
    const payload = JSON.parse(vydal(v)[0].replace(/^POST \/api\/setup-keys /, ""));
    expect(payload).toMatchObject({ type: "one-off", usage_limit: 1, auto_groups: [GPU], ephemeral: false });
    expect(v.env.MODEL_MESH_SETUP_KEY).toBe("NOVY-KLIC");
    expect(v.env.MODEL_MESH_SETUP_KEY_ID).toBe("novy-id");
  });

  test("deklarovaný uzel připojený poprvé → připne se jeho id, ŽÁDNÝ nový klíč", () => {
    const v = spust(KLIC, { peery: [nas()], ulozeneId: "stary-id" });
    expect(v.rc, v.stderr).toBe(0);
    expect(vydal(v)).toHaveLength(0);
    expect(v.env.MODEL_MESH_GPU_PEER_ID).toBe("p1");
    expect(v.env.MODEL_MESH_SETUP_KEY_ID).toBe("stary-id");
  });

  test("identita: peer se SPRÁVNÝM jménem, ale jiným než připnutým id → cizí, odebrán, STOP (3)", () => {
    const v = spust(KLIC, { peery: [nas({ id: "p-podvrh" })], pin: "p1" });
    expect(v.rc).toBe(3);
    expect(odebral(v)).toEqual(["p-podvrh"]);
    expect(vydal(v)).toHaveLength(0);
  });

  test("P1: cizí peer ve skupině uzlu → odebrán a STOP (3), klíč se nevydá", () => {
    const v = spust(KLIC, { peery: [nas(), { id: "px", name: "cizi-uzel", connected: true, groups: [{ id: GPU }] }], pin: "p1" });
    expect(v.rc).toBe(3);
    expect(odebral(v)).toEqual(["px"]);
    expect(vydal(v)).toHaveLength(0);
  });

  test("P1: dva peery s deklarovaným jménem (bez připnutí) → STOP (3), nic se neodebírá ani nevydává", () => {
    const v = spust(KLIC, { peery: [nas(), nas({ id: "p2" })] });
    expect(v.rc).toBe(3);
    expect(odebral(v)).toEqual([]);
    expect(vydal(v)).toHaveLength(0);
  });

  test("P2: připnutý uzel odpojený dávno (výměna) → odebrán, připnutí zrušeno, PAK nový klíč, starý odvolán", () => {
    const v = spust(KLIC, { peery: [nas({ connected: false, last_seen: DAVNO })], ulozeneId: "stary-id", pin: "p1" });
    expect(v.rc, v.stderr).toBe(0);
    expect(odebral(v)).toEqual(["p1"]);
    const poradi = v.volani.map((c) => c.split(" ").slice(0, 2).join(" "));
    expect(poradi.indexOf("DELETE /api/peers/p1")).toBeLessThan(poradi.indexOf("POST /api/setup-keys"));
    expect(v.volani).toContain("DELETE /api/setup-keys/stary-id ");
    expect(v.env.MODEL_MESH_SETUP_KEY_ID).toBe("novy-id");
    expect(v.env.MODEL_MESH_GPU_PEER_ID).toBe("");
  });

  test("fail-open: starý klíč po odvolání POŘÁD platí → nový se NEvydá a selže", () => {
    const v = spust(KLIC, { ulozeneId: "stary-id", ignoruj: ["key-delete"] });
    expect(v.rc).not.toBe(0);
    expect(v.stderr).toMatch(/pořád PLATNÝ/);
    expect(vydal(v)).toHaveLength(0);
  });

  test("P2: deklarovaný uzel odpojený právě teď (restart) → nic", () => {
    const v = spust(KLIC, { peery: [nas({ connected: false, last_seen: new Date().toISOString() })], pin: "p1" });
    expect(v.rc, v.stderr).toBe(0);
    expect(odebral(v)).toEqual([]);
    expect(vydal(v)).toHaveLength(0);
  });

  test("fail-open: chybová odpověď API (401) místo seznamu peerů → selže, klíč se NEvydá", () => {
    const v = spust(KLIC, { peersChyba: true });
    expect(v.rc).not.toBe(0);
    expect(v.stderr).toMatch(/nevrátil seznam/);
    expect(vydal(v)).toHaveLength(0);
  });

  test("fail-open: server vytvoří širší klíč, než se žádalo → odvolán, NEuložen, selže", () => {
    const v = spust(KLIC, { klicSiroky: true });
    expect(v.rc).not.toBe(0);
    expect(v.stderr).toMatch(/po zpětném čtení NESEDÍ/);
    expect(v.volani).toContain("DELETE /api/setup-keys/novy-id ");
    expect(v.env.MODEL_MESH_SETUP_KEY_ID).toBeUndefined();
  });

  test("uzel je v meshi → zbylý platný klíč jeho skupiny se odvolá (nepoužitý one-off by pustil dalšího)", () => {
    const v = spust(KLIC, { peery: [nas()], pin: "p1", klice: [{ id: "zbyly", state: "valid", revoked: false, auto_groups: [GPU] }] });
    expect(v.rc, v.stderr).toBe(0);
    expect(v.volani).toContain("DELETE /api/setup-keys/zbyly ");
    expect(vydal(v)).toHaveLength(0);
  });

  test("peer jiné skupiny (most) se do posudku uzlu nepočítá", () => {
    const v = spust(KLIC, { peery: [{ id: "m1", name: "testfork-model-most", connected: true, groups: [{ id: MOST }] }] });
    expect(v.rc, v.stderr).toBe(0);
    expect(odebral(v)).toEqual([]);
    expect(vydal(v)).toHaveLength(1);
  });
});

describe.skipIf(!HAS_JQ)("modelový mesh: jediná jednosměrná politika (O8), ověřená zpětným čtením", () => {
  test("výchozí „All“ pryč, založena jen most → uzel, tcp na portu modelu, bidirectional=false", () => {
    const v = spust(`model_zajisti_politiku ${MOST} ${GPU} 8000`, {
      politiky: [{ id: "d1", name: "Default", enabled: true, rules: [{ bidirectional: true }] }],
    });
    expect(v.rc, v.stderr).toBe(0);
    expect(v.volani).toContain("DELETE /api/policies/d1 ");
    const post = v.volani.find((c) => c.startsWith("POST /api/policies"));
    const p = JSON.parse(post!.replace(/^POST \/api\/policies /, ""));
    expect(p.rules).toHaveLength(1);
    expect(p.rules[0]).toMatchObject({
      action: "accept", bidirectional: false, protocol: "tcp", ports: ["8000"], sources: [MOST], destinations: [GPU],
    });
  });

  test("naše politika už existuje (obousměrná) → srovná se PUTem, nezakládá se druhá", () => {
    const v = spust(`model_zajisti_politiku ${MOST} ${GPU} 8000`, {
      politiky: [{ id: "n1", name: "model-most-na-model-gpu", enabled: true, rules: [{ bidirectional: true }] }],
    });
    expect(v.rc, v.stderr).toBe(0);
    expect(v.volani.some((c) => c.startsWith("PUT /api/policies/n1 "))).toBe(true);
    expect(v.volani.some((c) => c.startsWith("POST /api/policies"))).toBe(false);
  });

  test("fail-open: server tiše NEodebere výchozí „All“ → selže (ne „hotovo“)", () => {
    const v = spust(`model_zajisti_politiku ${MOST} ${GPU} 8000`, {
      politiky: [{ id: "d1", name: "Default", enabled: true, rules: [{ bidirectional: true }] }],
      ignoruj: ["policy-delete"],
    });
    expect(v.rc).not.toBe(0);
    expect(v.stderr).toMatch(/po srovnání NESEDÍ/);
  });
});

const jwt = (payload: object) =>
  ["x", Buffer.from(JSON.stringify(payload)).toString("base64url"), "y"].join(".");

describe.skipIf(!HAS_JQ)("token bootstrap uživatele: audience v obou směrech (žádné přenesení mezi meshi)", () => {
  const over = (musi: string, nesmi: string, payload: object) =>
    spust(`BOOTSTRAP_CLIENT_ID=x BOOTSTRAP_AUD_MUSI=${musi} BOOTSTRAP_AUD_NESMI=${nesmi}; bootstrap_token_audience_ok '${jwt(payload)}'`, {});
  test("modelový token jen s netbird-model → v pořádku", () => {
    expect(over("netbird-model", "netbird", { aud: "netbird-model" }).rc).toBe(0);
  });
  test("modelový token s netbird i netbird-model → odmítnut (platil by v hlavním meshi)", () => {
    const v = over("netbird-model", "netbird", { aud: ["netbird", "netbird-model"] });
    expect(v.rc).not.toBe(0);
    expect(v.stderr).toMatch(/platil by i v druhé rovině/);
  });
  test("modelový token bez netbird-model → odmítnut", () => {
    expect(over("netbird-model", "netbird", { aud: "account" }).rc).not.toBe(0);
  });
  test("hlavní token s netbird-model → odmítnut (platil by v modelovém meshi)", () => {
    expect(over('""', "netbird-model", { aud: ["netbird", "netbird-model"] }).rc).not.toBe(0);
  });
});

describe("modelová instance se volí výslovně, hlavní se nemění, pověření hlavního se nepřenáší", () => {
  const spustCely = (instance: string, extra: string[] = []) => {
    const env = join(workdir, `cely-${instance}-${extra.length}.env`);
    writeFileSync(env, ["KEYCLOAK_DOMAIN=auth.invalid", "KEYCLOAK_REALM=test", ...extra].join("\n") + "\n");
    return spawnSync("bash", [BOOTSTRAP], {
      encoding: "utf-8",
      env: { ...process.env, NETBIRD_INSTANCE: instance, ENV_FILE: env, SKIP_KEYCLOAK_GATE: "1", SYNC_COOLIFY: "0" },
      timeout: 30_000,
    });
  };

  test("neznámá instance → exit 2 dřív, než se na cokoli sáhne", () => {
    const r = spustCely("cizi");
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toMatch(/neznámá instance stacku NetBird: 'cizi'/);
  });

  test("model bez lane MODEL_MESH → konec 0 s výslovnou hláškou (neexistující řídicí rovině nic)", () => {
    const r = spustCely("model", ["MODEL_MESH="]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/instance ho nemá \(MODEL_MESH prázdná\)/);
  });

  test("model s NETBIRD_AUTH_SCHEME=Token (statický token hlavního meshe) → odmítne, exit 1", () => {
    const r = spustCely("model", ["MODEL_MESH=gpu", "NETBIRD_MODEL_DOMAIN=mesh-model.invalid", "NETBIRD_AUTH_SCHEME=Token", "NETBIRD_API_TOKEN=hlavni-tajne"]);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/JEN tokenem bootstrap uživatele/);
  });

  test("skript: modelová větev končí dřív, než sáhne na stack klíče hlavní; token si vyžádá scope audience", () => {
    const s = readFileSync(BOOTSTRAP, "utf-8");
    const model = s.indexOf('if [ "$NETBIRD_INSTANCE_ZVOLENA" = "model" ]; then\n  banner');
    const hlavni = s.indexOf('FRONTEND_GROUP_ID="$(ensure_group aisha-frontend)"');
    expect(model).toBeGreaterThan(-1);
    expect(hlavni).toBeGreaterThan(model);
    expect(s.slice(model, hlavni)).toMatch(/exit 0\s*\nfi/);
    expect(s.slice(model, hlavni)).not.toMatch(/NETBIRD_STACK_KEY_/);
    expect(s).toContain('BOOTSTRAP_CLIENT_ID="netbird-model-bootstrap"');
    expect(s).toMatch(/bootstrap_token_audience_ok "\$_t" \|\| return 1/);
  });
});

// ── MOST (C4, P7): IP uzlu jen z připnutého peeru, klíč mostu jen do skupiny mostu ──────────
const MOST_PEER = "testfork-model-most";
const ENV_INSTANCE = ["MODEL_MESH_PORT=8000", `MODEL_MESH_GPU_PEER=${UZEL}`, `MODEL_MESH_MOST_PEER=${MOST_PEER}`];
const IP_UZLU =
  "model_zajisti_ip_uzlu " + GPU + " " + UZEL + " MODEL_MESH_GPU_PEER_ID MODEL_MESH_GPU_PEER_IP || exit $?; " +
  'echo "ZMENA_MOST=${MODEL_ZMENA_MOST:-0}"';
const BOOT = 'model_bootstrap_instance || exit $?; echo "UZEL=${MODEL_ZMENA_UZEL} MOST=${MODEL_ZMENA_MOST}"';
const payloadKlice = (v: Vysledek) => vydal(v).map((c) => JSON.parse(c.replace(/^POST \/api\/setup-keys /, "")));

describe.skipIf(!HAS_JQ)("modelový mesh: IP uzlu pro most (C4)", () => {
  test("připnutý připojený uzel ve skupině → IP z jeho záznamu, mostu se doručí", () => {
    const v = spust(IP_UZLU, { peery: [nas({ ip: "100.70.1.2" })], pin: "p1" });
    expect(v.rc, v.stderr).toBe(0);
    expect(v.env.MODEL_MESH_GPU_PEER_IP).toBe("100.70.1.2");
    expect(v.stdout).toContain("ZMENA_MOST=1");
  });

  test("táž IP už doručená → nic se nepřepisuje ani nedoručuje", () => {
    const v = spust(IP_UZLU, { peery: [nas({ ip: "100.70.1.2" })], pin: "p1", env: ["MODEL_MESH_GPU_PEER_IP=100.70.1.2"] });
    expect(v.rc, v.stderr).toBe(0);
    expect(v.stdout).toContain("ZMENA_MOST=0");
  });

  test("bez připnutého uzlu → IP se VYPRÁZDNÍ (most 503), poslední známá se nedrží", () => {
    const v = spust(IP_UZLU, { peery: [nas({ ip: "100.70.1.2" })], env: ["MODEL_MESH_GPU_PEER_IP=100.70.1.2"] });
    expect(v.rc, v.stderr).toBe(0);
    expect(v.env.MODEL_MESH_GPU_PEER_IP).toBe("");
    expect(v.stdout).toContain("ZMENA_MOST=1");
  });

  test.each([
    ["jiné jméno", { id: "p1", name: "vetrelec", connected: true, ip: "100.70.6.6", groups: [{ id: GPU }] }],
    ["mimo skupinu uzlu", { id: "p1", name: UZEL, connected: true, ip: "100.70.6.6", groups: [{ id: MOST }] }],
    ["jiné id se jménem uzlu (připnutý v meshi není)", { id: "p2", name: UZEL, connected: true, ip: "100.70.6.6", groups: [{ id: GPU }] }],
  ])("připnutý uzel neodpovídá — %s → IP se mostu nedoručí", (_p, peer) => {
    const v = spust(IP_UZLU, { peery: [peer as Peer], pin: "p1" });
    expect(v.rc, v.stderr).toBe(0);
    expect(v.env.MODEL_MESH_GPU_PEER_IP ?? "").toBe("");
  });

  test.each([["172.17.0.1"], ["10.0.0.5"], [[100, 128, 0, 1].join(".")], [[100, 63, 255, 1].join(".")]])(
    "adresa %s mimo rozsah modelového meshe (100.64.0.0/10) → selže a mostu nic nedoručí",
    (ip) => {
      const v = spust(IP_UZLU, { peery: [nas({ ip })], pin: "p1" });
      expect(v.rc).toBe(1);
      expect(v.env.MODEL_MESH_GPU_PEER_IP).toBeUndefined();
      expect(v.stderr).toMatch(/mimo rozsah meshe/);
    },
  );

  test("adresa, která není IPv4 → selže a mostu nic nedoručí", () => {
    const v = spust(IP_UZLU, { peery: [nas({ ip: "100.70.1.2;rm -rf /" })], pin: "p1" });
    expect(v.rc).toBe(1);
    expect(v.env.MODEL_MESH_GPU_PEER_IP).toBeUndefined();
    expect(v.stderr).toMatch(/není IPv4/);
  });

  test("seznam peerů nečitelný (401) → selže, doručená IP zůstane", () => {
    const v = spust(IP_UZLU, { peersChyba: true, pin: "p1", env: ["MODEL_MESH_GPU_PEER_IP=100.70.1.2"] });
    expect(v.rc).toBe(1);
    expect(v.env.MODEL_MESH_GPU_PEER_IP).toBe("100.70.1.2");
  });
});

describe.skipIf(!HAS_JQ)("modelový mesh: celý bootstrap instance — uzel i most (C4, P7)", () => {
  test("prázdný mesh → dva jednorázové klíče, každý JEN do své skupiny; jediná politika most → uzel", () => {
    const v = spust(BOOT, { env: ENV_INSTANCE });
    expect(v.rc, v.stderr).toBe(0);
    const k = payloadKlice(v);
    expect(k).toHaveLength(2);
    expect(k.find((p) => p.name === UZEL)).toMatchObject({ type: "one-off", usage_limit: 1, auto_groups: [GPU] });
    expect(k.find((p) => p.name === MOST_PEER)).toMatchObject({ type: "one-off", usage_limit: 1, auto_groups: [MOST] });
    expect(v.env.MODEL_MESH_SETUP_KEY).toBe("NOVY-KLIC");
    expect(v.env.MODEL_MESH_MOST_SETUP_KEY).toBe("NOVY-KLIC-MOST");
    expect(v.env.MODEL_MESH_MOST_SETUP_KEY_ID).toBe("novy-most-id");
    expect(v.stdout).toContain("UZEL=1 MOST=1");
    const politika = v.volani.filter((c) => c.startsWith("POST /api/policies"));
    expect(politika).toHaveLength(1);
    const pravidlo = JSON.parse(politika[0].replace(/^POST \/api\/policies /, "")).rules[0];
    expect(pravidlo).toMatchObject({ sources: [MOST], destinations: [GPU], bidirectional: false, ports: ["8000"] });
  });

  test("uzel i most v meshi a připnutí → žádný klíč; IP UZLU (ne mostu) jen mostu", () => {
    const most: Peer = { id: "m1", name: MOST_PEER, connected: true, ip: "100.70.9.9", groups: [{ id: MOST }] };
    const v = spust(BOOT, {
      peery: [nas({ ip: "100.70.1.2" }), most],
      pin: "p1",
      env: [...ENV_INSTANCE, "MODEL_MESH_MOST_PEER_ID=m1"],
    });
    expect(v.rc, v.stderr).toBe(0);
    expect(vydal(v)).toHaveLength(0);
    expect(v.env.MODEL_MESH_GPU_PEER_IP).toBe("100.70.1.2");
    expect(v.stdout).toContain("UZEL=0 MOST=1");
  });

  test("most se zapíše poprvé → připne se jeho id (TOFU) a zbylý klíč skupiny mostu se odvolá", () => {
    const most: Peer = { id: "m1", name: MOST_PEER, connected: true, groups: [{ id: MOST }] };
    const v = spust(BOOT, {
      peery: [nas(), most],
      pin: "p1",
      env: ENV_INSTANCE,
      klice: [{ id: "zbyly-most", state: "valid", revoked: false, auto_groups: [MOST] }],
    });
    expect(v.rc, v.stderr).toBe(0);
    expect(v.env.MODEL_MESH_MOST_PEER_ID).toBe("m1");
    expect(v.volani).toContain("DELETE /api/setup-keys/zbyly-most ");
  });

  test("cizí peer ve skupině mostu → incident: odebrat a STOP (most je jediný vstup k uzlu)", () => {
    const vetrelec: Peer = { id: "x9", name: "vetrelec", connected: true, groups: [{ id: MOST }] };
    const v = spust(BOOT, { peery: [nas(), vetrelec], pin: "p1", env: ENV_INSTANCE });
    expect(v.rc).toBe(3);
    expect(odebral(v)).toContain("x9");
    expect(payloadKlice(v).filter((p) => p.name === MOST_PEER)).toHaveLength(0);
  });

  test("uzel a most se stejným jménem peeru → selže dřív, než sáhne do meshe", () => {
    const v = spust(BOOT, { env: ["MODEL_MESH_PORT=8000", `MODEL_MESH_GPU_PEER=${UZEL}`, `MODEL_MESH_MOST_PEER=${UZEL}`] });
    expect(v.rc).toBe(1);
    expect(v.volani).toHaveLength(0);
  });
});
