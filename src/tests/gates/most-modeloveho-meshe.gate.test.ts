/**
 * Brána: MOST modelového meshe forku (varianta C, krok C4) — jediné místo, kde se hlavní
 * mesh forku potká s modelovým (GPU uzel na sdíleném stroji).
 *
 * Tvrdí VÝSLEDEK, ne text: spustí příkaz most-proxy přesně tak, jak ho dostane kontejner
 * (po de-escapování `$$` → `$`), se stubem `caddy`, a čte Caddyfile, který vznikne.
 *   · předává JEN na IP uzlu a port modelu; dial ≤3 s (R5a); proudové odpovědi (flush -1);
 *   · uzel nedostupný / IP nedoručena → 503 `LANE_NEDOSTUPNA` (slovník @aisha/accel-protokol),
 *     nikdy jiný cíl ani CPU model (MM8);
 *   · spojení z rozsahu meshe (wt0 modelového meshe) → abort — do mostu se z uzlu nesmí;
 *   · vadná IP nebo port = vadné doručení → kontejner spadne, Caddyfile nevznikne.
 * A tvar compose: dva jmenné prostory (hlavní mesh × modelový mesh) se potkají JEN na
 * vnitřní síti mostu, netns modelového meshe nesměruje (ip_forward=0), agent modelového
 * meshe nepřijímá trasy ani DNS, nikde `coolify`, `ports` ani sdílená síť u modelové strany.
 */
import { describe, expect, test } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";

const ROOT = process.cwd();
const COMPOSE = "docker-compose.coolify-model-most.yml";
type Sluzba = {
  command?: string[];
  entrypoint?: string[];
  network_mode?: string;
  networks?: string[] | Record<string, unknown>;
  sysctls?: Record<string, string>;
  ports?: unknown;
  environment?: Record<string, unknown>;
};
const compose = parse(readFileSync(join(ROOT, COMPOSE), "utf8"), { merge: true }) as {
  services: Record<string, Sluzba>;
  networks: Record<string, { internal?: boolean; external?: boolean; name?: string }>;
};
const site = (s: Sluzba) => (Array.isArray(s.networks) ? s.networks : Object.keys(s.networks ?? {})).sort();

// Atrapa `ip` = netns mostu: eth0 = ven (výchozí trasa), eth1 = síť mostu, wt0 = modelový mesh.
// Prostředí ATRAPA_* tvar mění (žádná výchozí trasa, dvě kandidátní sítě…).
const ATRAPA_IP = `#!/bin/sh
case "$*" in
  "-4 route show default") [ -n "\${ATRAPA_VYCHOZI-eth0}" ] && echo "default via 172.30.0.1 dev \${ATRAPA_VYCHOZI-eth0}" ;;
  "-o -4 addr show") printf '1: lo    inet 127.0.0.1/8 scope host lo\\n2: eth0    inet 172.30.0.3/16 scope global eth0\\n3: eth1    inet 172.31.0.2/24 scope global eth1\\n4: wt0    inet 100.70.0.5/16 scope global wt0\\n'"\${ATRAPA_NAVIC-}" ;;
  "-4 route show dev eth0 scope link") echo "172.30.0.0/16 proto kernel scope link src 172.30.0.3" ;;
  "-4 route show dev eth1 scope link") echo "172.31.0.0/24 proto kernel scope link src 172.31.0.2" ;;
  "-4 route show dev eth2 scope link") echo "172.29.0.0/24 proto kernel scope link src 172.29.0.2" ;;
esac
`;

function vyrenderuj(env: Record<string, string>): { rc: number | null; caddyfile: string | null; log: string } {
  const dir = mkdtempSync(join(tmpdir(), "most-proxy-"));
  try {
    const bin = join(dir, "bin");
    const caddyDir = join(dir, "caddy");
    mkdirSync(bin);
    mkdirSync(caddyDir);
    writeFileSync(join(bin, "caddy"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(bin, "caddy"), 0o755);
    writeFileSync(join(bin, "ip"), ATRAPA_IP);
    chmodSync(join(bin, "ip"), 0o755);
    const prikaz = compose.services["most-proxy"]?.command;
    if (!Array.isArray(prikaz) || prikaz.length < 3) throw new Error("most-proxy nemá command [sh, -c, skript]");
    const skript = prikaz[2].split("$$").join("$").split("/etc/caddy").join(caddyDir);
    const r = spawnSync("sh", ["-c", skript], {
      env: { MODEL_MESH_GPU_PEER_IP: "", PATH: `${bin}:${process.env.PATH}`, ...env },
      encoding: "utf8",
      timeout: 20_000,
    });
    const soubor = join(caddyDir, "Caddyfile");
    return { rc: r.status, caddyfile: existsSync(soubor) ? readFileSync(soubor, "utf8") : null, log: `${r.stdout}\n${r.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("most-proxy: předává jen na uzel, jinak odmítne kódem ze slovníku lane", () => {
  test("s IP uzlu: port modelu → http://<IP>:<port>, dial 3 s, flush -1, z meshe abort", () => {
    const { rc, caddyfile, log } = vyrenderuj({ MODEL_MESH_PORT: "8000", MODEL_MESH_GPU_PEER_IP: "100.70.1.2" });
    expect(rc, log).toBe(0);
    const c = caddyfile ?? "";
    expect(c).toMatch(/^:8000 \{$/m);
    expect(c).toContain("reverse_proxy http://100.70.1.2:8000 {");
    expect(c).toContain("flush_interval -1");
    expect(c).toContain("dial_timeout 3s");
    expect(c).toMatch(/@zmodelovehomeshe remote_ip 100\.64\.0\.0\/10\n\s*handle @zmodelovehomeshe \{\n\s*abort/);
    // jediný upstream — žádný druhý cíl, na který by most „spadl“
    expect(c.match(/reverse_proxy /g)).toHaveLength(1);
    expect(c).toMatch(/handle_errors \{[^}]*x-aisha-odmitl most[^}]*"duvod":"LANE_NEDOSTUPNA"[^`]*` 503/s);
    expect(c).toContain("admin off");
    // přijímá JEN ze sítě mostu (+ localhost kvůli zdraví) — ne z `ven` ani z hostitele
    expect(c).toMatch(/@mimomost not remote_ip 172\.31\.0\.0\/24 127\.0\.0\.1\/32\n\s*handle @mimomost \{\n\s*abort/);
    expect(c).not.toContain("172.30.0.0/16");
    expect(log).toMatch(/jen ze sítě mostu 172\.31\.0\.0\/24/);
  });

  test.each([
    ["netns bez výchozí trasy (síť ven nejde odlišit)", { ATRAPA_VYCHOZI: "" }],
    ["dvě kandidátní sítě mostu", { ATRAPA_NAVIC: "5: eth2    inet 172.29.0.2/24 scope global eth2\\n" }],
  ])("síť mostu nejde určit jednoznačně — %s → kontejner spadne, Caddyfile nevznikne", (_p, atrapa) => {
    const { rc, caddyfile, log } = vyrenderuj({ MODEL_MESH_PORT: "8000", MODEL_MESH_GPU_PEER_IP: "100.70.1.2", ...atrapa });
    expect(rc, log).not.toBe(0);
    expect(caddyfile).toBeNull();
    expect(log).toMatch(/FATAL/);
  });

  test.each([["172.17.0.1"], ["10.0.0.5"], [[100, 128, 0, 1].join(".")], [[100, 63, 1, 1].join(".")]])(
    "IP uzlu %s mimo modelový mesh (100.64.0.0/10) → kontejner spadne (most jen do modelového meshe)",
    (ip) => {
      const { rc, caddyfile, log } = vyrenderuj({ MODEL_MESH_PORT: "8000", MODEL_MESH_GPU_PEER_IP: ip });
      expect(rc).not.toBe(0);
      expect(caddyfile).toBeNull();
      expect(log).toMatch(/mimo modelový mesh/);
    },
  );

  test("bez IP uzlu → žádné předávání, 503 LANE_NEDOSTUPNA nahlas", () => {
    const { rc, caddyfile, log } = vyrenderuj({ MODEL_MESH_PORT: "8000" });
    expect(rc, log).toBe(0);
    const c = caddyfile ?? "";
    expect(c).not.toContain("reverse_proxy");
    expect(c).toMatch(/handle \{\n\s*header Content-Type application\/json\n\s*header x-aisha-odmitl most\n\s*respond `\{"duvod":"LANE_NEDOSTUPNA"/);
    expect(log).toMatch(/MODEL_MESH_GPU_PEER_IP nedoručena/);
  });

  test.each([
    ["IP s příkazem", { MODEL_MESH_PORT: "8000", MODEL_MESH_GPU_PEER_IP: "100.70.1.2 { }" }],
    ["jméno místo IP", { MODEL_MESH_PORT: "8000", MODEL_MESH_GPU_PEER_IP: "uzel.example" }],
    ["port není číslo", { MODEL_MESH_PORT: "80;00", MODEL_MESH_GPU_PEER_IP: "100.70.1.2" }],
    ["port prázdný", { MODEL_MESH_PORT: "", MODEL_MESH_GPU_PEER_IP: "100.70.1.2" }],
  ])("vadné doručení — %s → kontejner spadne, Caddyfile nevznikne", (_p, env) => {
    const { rc, caddyfile } = vyrenderuj(env);
    expect(rc).not.toBe(0);
    expect(caddyfile).toBeNull();
  });
});

// Mesh DNS: záznam jména modelu musí mířit tam, kam vede trasa ingressu — na peer MOSTU.
// Bez toho by ukázal na peer CPU modelu (`experimental-model`), pokud v meshi ještě visí
// (MM8: žádný tichý návrat na CPU). Pouští se skutečný nástroj nanečisto s mapou peerů.
function planDns(umisteni: "gpu" | null): string {
  const dir = mkdtempSync(join(tmpdir(), "most-dns-"));
  try {
    mkdirSync(join(dir, "profiles"));
    const zaklad = JSON.parse(readFileSync(join(ROOT, "config/profiles/cloud-multi.json"), "utf8"));
    const profil = { ...zaklad, id: "most-dns", ...(umisteni ? { service_overrides: { model: { placement: umisteni } } } : {}) };
    writeFileSync(join(dir, "profiles", "most-dns.json"), JSON.stringify(profil));
    writeFileSync(join(dir, "peery.txt"), "backend-model-most|100.64.5.5\nexperimental-model|100.64.9.9\n");
    writeFileSync(join(dir, "aliasy.txt"), "");
    const r = spawnSync(
      process.execPath,
      [join(ROOT, "scripts/netbird-dns-provision.mjs"), "--peer-ip-map", join(dir, "peery.txt"), "--alias-ip-map", join(dir, "aliasy.txt")],
      {
        encoding: "utf8",
        timeout: 60_000,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          AISHA_INSTANCE_CONFIG_DIR: dir,
          AISHA_PROFILE: "most-dns",
          APP_NAME_PREFIX: "testfork",
          PUBLIC_TLD: "testfork.example",
          INTERNAL_TLD: "mesh.testfork.internal",
          MESH_TLD: "mesh.testfork.internal",
          CHAT_GGUF_URL: "https://m.example/x.gguf",
        },
      },
    );
    if (r.status !== 0) throw new Error(`netbird-dns-provision nanečisto skončil ${r.status}: ${r.stderr}`);
    return r.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("mesh DNS: jméno modelu míří na peer, který drží jeho trasu", () => {
  test("model na GPU slotu → záznam jména modelu na peer MOSTU, ne na CPU model", () => {
    const plan = planDns("gpu");
    expect(plan).toMatch(/testfork-model\.mesh\.testfork\.internal +→ 100\.64\.5\.5 +\(peer:backend-model-most\)/);
    expect(plan).not.toMatch(/testfork-model\.mesh\.testfork\.internal +→ 100\.64\.9\.9/);
  });

  test("kotva: model podle katalogu → záznam na vlastní peer modelu, most v plánu není", () => {
    const plan = planDns(null);
    expect(plan).toMatch(/testfork-model\.mesh\.testfork\.internal +→ 100\.64\.9\.9 +\(peer:experimental-model\)/);
    expect(plan).not.toContain("backend-model-most");
  });
});

describe("most: dva jmenné prostory se potkají jen na vnitřní síti mostu", () => {
  const agentModelu = compose.services["model-mesh-agent"];
  const agentHlavni = compose.services["netbird-agent"];

  test("most-proxy bydlí v netns agenta modelového meshe, ingress hlavního meshe v netns hlavního agenta", () => {
    expect(compose.services["most-proxy"]?.network_mode).toBe("service:model-mesh-agent");
    expect(compose.services["model-most-mesh-ingress"]?.network_mode).toBe("service:netbird-agent");
  });

  test("netns modelového meshe nesměruje a agent nepřijímá trasy ani DNS", () => {
    expect(agentModelu?.sysctls?.["net.ipv4.ip_forward"]).toBe("0");
    const skript = (agentModelu?.entrypoint ?? []).join("\n");
    for (const prepinac of ["--disable-dns", "--disable-client-routes", "--disable-server-routes", "--block-lan-access"]) {
      expect(skript, prepinac).toContain(prepinac);
    }
  });

  test("společná síť obou agentů je JEN `most`, a ta je vnitřní", () => {
    const spolecne = site(agentModelu).filter((n) => site(agentHlavni).includes(n));
    expect(spolecne).toEqual(["most"]);
    expect(compose.networks.most?.internal).toBe(true);
    expect(site(agentModelu)).toEqual(["most", "ven"]);
  });

  test("nikde coolify ani publikovaný port; modelová strana bez sdílené sítě forku", () => {
    for (const [jmeno, s] of Object.entries(compose.services)) {
      expect(site(s), jmeno).not.toContain("coolify");
      expect(s.ports, jmeno).toBeUndefined();
    }
    expect(site(agentModelu)).not.toContain("internal");
  });

  test("cíl trasy mostu má na síti mostu alias s identitou (container_name Coolify přepisuje)", () => {
    const most = (agentModelu?.networks as Record<string, { aliases?: string[] }>)?.most;
    expect(most?.aliases ?? []).toContain("${APP_NAME_PREFIX:?identita instance}-model-most--model-mesh");
  });

  test("katalog: most drží jméno modelu na portu modelu, koncový bod = agent modelového meshe", () => {
    const sluzby = JSON.parse(readFileSync(join(ROOT, "config/services.json"), "utf8")).services;
    const most = sluzby["model-most"];
    expect(most.mesh_most_pro).toBe("model");
    expect(most.compose).toBe(COMPOSE);
    expect(most.internal_url).toEqual({ service: "model-mesh-agent", port: sluzby.model.internal_url.port });
    expect(most.provision_when_env).toBe("MODEL_MESH");
  });
});
