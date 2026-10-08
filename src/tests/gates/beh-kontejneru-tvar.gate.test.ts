/**
 * Brána: TVAR KONTEJNERU BĚHU se nesmí vrátit (CLASS gate)
 *
 * ⛔ 2026-10-06 — majitel „síť zavřít“ = volba A (rada cb `plugin-exec-hranice-kontejneru`
 * K1–K7, M8–M12). Tři backendy runneru (docker, kata, claude-cli) si požadavek na kontejner
 * skládaly každý sám. Výsledek, čtený nad mainem @ab87c8a7a:
 *
 *   · síť běhů vznikala jako obyčejný `bridge` (bez `Internal`) → plugin, který vystoupí
 *     z VM, měl výchozí bránu ven — internet, hostitel, ostatní kontejnery,
 *   · do prostředí KAŽDÉHO běhu šel klíč k mesh síti (`NB_SETUP_KEY`), který žádný obraz
 *     nepoužil — jen ležel na dosah pluginu; runner k tomu držel pověření správy meshe,
 *   · kata neměla kořen jen pro čtení ani `CapDrop`, nikdo nevynucoval `PidsLimit` ani
 *     uživatele (běžel ten z obrazu — i root).
 *
 * Oprava dala požadavku JEDEN domov (`backends/run-container-spec.ts`), síti běhů jedno
 * místo vzniku s `Internal: true` (`backends/docker-http.ts` ensureExecNetwork, měřeno před
 * každým během) a jedinou cestu ven: povinnou broker-proxy runneru (převzatou z forku,
 * `feat/runner-broker-proxy`) s CONNECT jen pro výčet claude_cli_task. Tahle brána hlídá
 * TŘÍDU, ne vzorek: kdo přidá backend, druhé volání `containers/create`, vlastní
 * `HostConfig`, proměnnou mesh sítě, druhé místo zakládání sítě nebo ji otevře, zčervená
 * tady — ne až v provozu. Vlastnost builderu se MĚŘÍ jeho voláním, ne regexem.
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import ts from "typescript";
import { buildRunContainerBody, type RunContainerSpec } from "../../../services/svc-agent-runner/src/backends/run-container-spec.js";

const ROOT = process.cwd();
const SRC = join(ROOT, "services/svc-agent-runner/src");
const COMPOSE = join(ROOT, "docker-compose.coolify-exec.yml");

/** Zdrojáky runneru mimo testy. */
function zdroje(): Array<{ soubor: string; kod: string }> {
  const ven: Array<{ soubor: string; kod: string }> = [];
  const projdi = (dir: string): void => {
    for (const jmeno of readdirSync(dir)) {
      const cesta = join(dir, jmeno);
      if (statSync(cesta).isDirectory()) {
        if (jmeno === "tests" || jmeno === "__tests__") continue;
        projdi(cesta);
      } else if (jmeno.endsWith(".ts") && !jmeno.endsWith(".test.ts")) {
        ven.push({ soubor: relative(SRC, cesta), kod: bezKomentaru(readFileSync(cesta, "utf8")) });
      }
    }
  };
  projdi(SRC);
  return ven;
}

/**
 * Zmínka v komentáři není zapojení — měří se kód. Komentáře odstraňuje parser TypeScriptu,
 * ne regex (`${a}//${b}` v šabloně by regex uřízl i s kódem za ním).
 */
function bezKomentaru(text: string): string {
  const sf = ts.createSourceFile("x.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return ts.createPrinter({ removeComments: true }).printFile(sf);
}

const souboryS = (vzor: RegExp): string[] =>
  zdroje()
    .filter((z) => vzor.test(z.kod))
    .map((z) => z.soubor)
    .sort();

describe("kontejner běhu má jeden domov", () => {
  it("`containers/create` volá jen backends/run-container.ts", () => {
    expect(souboryS(/containers\/create/)).toEqual(["backends/run-container.ts"]);
  });

  it("`HostConfig` skládá jen backends/run-container-spec.ts (M9: žádná vlastní kopie v kata/claude)", () => {
    expect(souboryS(/\bHostConfig\b/)).toEqual(["backends/run-container-spec.ts"]);
  });

  it("run-container.ts posílá tělo výhradně z buildRunContainerBody", () => {
    const kod = zdroje().find((z) => z.soubor === "backends/run-container.ts")!.kod;
    expect(kod).toMatch(/buildRunContainerBody\(/);
  });

  it("kdo zakládá kontejner běhu, nejdřív změří síť běhů a připojení proxy (zajistiCestuKBrokeru)", () => {
    const zakladaji = souboryS(/createRunContainer\(/).filter((s) => s !== "backends/run-container.ts");
    expect(zakladaji.length, "žádný backend nezakládá kontejner — brána by nic neměřila").toBeGreaterThan(0);
    const bezMereni = zakladaji.filter((s) => !/zajistiCestuKBrokeru\(/.test(zdroje().find((z) => z.soubor === s)!.kod));
    expect(bezMereni, "zakládá kontejner bez změření sítě běhů").toEqual([]);
  });

  it("síť běhů zakládá JEDINÉ místo, jen s `Internal: true`, a bez paměti „ověřeno“ (T2/T9)", () => {
    expect(souboryS(/networks\/create/)).toEqual(["backends/docker-http.ts"]);
    const kod = zdroje().find((z) => z.soubor === "backends/docker-http.ts")!.kod;
    expect(kod, "tělo networks/create musí nést Internal: true").toMatch(/networks\/create[^{]*\{[^}]*\bInternal:\s*true\b/);
    expect(kod, "existující síť se musí měřit na Internal (ne jen na jméno)").toMatch(/\.Internal\s*!==\s*true/);
    // ⛔ NAMĚŘENO 2026-10-07: z Internal sítě s bránou bridge byl dosažitelný posluchač HOSTITELE.
    expect(kod, "síť běhů vzniká bez adresy hostitele (inhibit_ipv4)").toMatch(/BEZ_ADRESY_HOSTITELE\s*=\s*['"]com\.docker\.network\.bridge\.inhibit_ipv4['"]/);
    expect(kod, "tělo networks/create nese Options s inhibit_ipv4").toMatch(/networks\/create[^{]*\{[^}]*\bOptions:\s*\{\s*\[BEZ_ADRESY_HOSTITELE\]:\s*['"]true['"]/);
    expect(kod, "existující síť se měří i na bránu v IPAM").toMatch(/\.Gateway\b/);
    expect(souboryS(/execNetEnsured/)).toEqual([]);
  });

  it("broker-proxy je povinná: BROKER_URL běhu nikdy není přímo PLUGIN_BROKER_URL", () => {
    const proxy = zdroje().find((z) => z.soubor === "broker-proxy.ts")!.kod;
    const fce = proxy.slice(proxy.indexOf("function brokerUrlProBeh"), proxy.indexOf("}", proxy.indexOf("function brokerUrlProBeh")));
    expect(fce, "brokerUrlProBeh nesmí mít větev na přímý broker").not.toMatch(/pluginBrokerUrl/);
    expect(souboryS(/jeBrokerProxyZapnuta/)).toEqual([]);
    const cfg = zdroje().find((z) => z.soubor === "config.ts")!.kod;
    expect(cfg, "BROKER_PROXY_ALIAS je povinný (requireEnv), ne `?? ''`").toMatch(/brokerProxyAlias:\s*requireEnv\(\s*['"]BROKER_PROXY_ALIAS['"]/);
  });
});

describe("API runneru se ze sítě běhů neobslouží — ani dřív, než runner své sítě změří", () => {
  it("hák API rozhoduje výčtem (pristupKApi), ne zákazem jedné adresy, která může být neznámá", () => {
    const server = zdroje().find((z) => z.soubor === "server.ts")!.kod;
    expect(server, "onRequest hák musí volat pristupKApi").toMatch(/addHook\(\s*['"]onRequest['"][\s\S]*pristupKApi\(/);
    expect(server, "nezměřený stav = zavřeno (503), ne propuštění").toMatch(/['"]nezmereno['"]/);
    expect(server, "starý tvar `execAdresa && …` pouštěl vše, dokud adresa nebyla známá").not.toMatch(/execAdresa\s*&&/);
  });
});

describe("model claude_cli_task je deklarovaný a výstup měřený už při přípravě", () => {
  it("env-doktor odvozuje ANTHROPIC_BASE_URL z veřejné tváře modelu (GATEWAY_DOMAIN_PUBLIC), ne z literálu", () => {
    const doktor = readFileSync(join(ROOT, "scripts/aisha-env-doctor.mjs"), "utf8");
    expect(doktor).toMatch(/\["ANTHROPIC_BASE_URL",\s*"derived",\s*modelBehuAgenta\(\)\]/);
    const fce = doktor.slice(doktor.indexOf("const modelBehuAgenta"), doktor.indexOf("};", doktor.indexOf("const modelBehuAgenta")));
    expect(fce).toMatch(/derivedTopo\(\s*"GATEWAY_DOMAIN_PUBLIC"\s*\)/);
    expect(fce, "žádná doména instance v kódu").not.toMatch(/https:\/\/[a-z0-9-]+\.[a-z]/i);
  });

  it("VLASTNOST (spuštěním doktora): ANTHROPIC_BASE_URL = https://<GATEWAY_DOMAIN_PUBLIC> TÉHOŽ běhu", () => {
    // `--no-external`: operátorský soubor se nečte → měří se derivace, ne něčí deklarace.
    const dir = mkdtempSync(join(tmpdir(), "aisha-model-agenta-"));
    // Cíl NEEXISTUJE = čistý start (prázdný existující soubor by doktor správně odmítl).
    const envFile = join(dir, "env.coolify");
    try {
      const beh = spawnSync(process.execPath, [join(ROOT, "scripts/aisha-env-doctor.mjs"), "--no-external"], {
        cwd: ROOT,
        env: { ...process.env, ENV_FILE: envFile, AISHA_PROFILE: "cloud-multi", APP_NAME_PREFIX: "brana", AISHA_STORY: "brana" },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 90_000,
      });
      const zapsano = new Map(
        readFileSync(envFile, "utf8")
          .split("\n")
          .filter((r) => r.includes("=") && !r.startsWith("#"))
          .map((r) => [r.slice(0, r.indexOf("=")), r.slice(r.indexOf("=") + 1)] as const),
      );
      const tvar = zapsano.get("GATEWAY_DOMAIN_PUBLIC") ?? "";
      expect(tvar, `doktor nevydal GATEWAY_DOMAIN_PUBLIC (kód ${beh.status}): ${String(beh.stderr).split("\n").slice(-3).join(" | ")}`).not.toBe("");
      expect(zapsano.get("ANTHROPIC_BASE_URL")).toBe(`https://${tvar}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("příprava claude běhu měří cíle týmž SSRF, jaký je pustí proxy (overVystupBehu)", () => {
    const claude = zdroje().find((z) => z.soubor === "backends/claude-cli.ts")!.kod;
    expect(claude).toMatch(/await overVystupBehu\(/);
  });
});

describe("builder vynucuje invarianty (měřeno voláním)", () => {
  const vzor: RunContainerSpec = {
    image: "obraz:test",
    network: "inst-exec-runs",
    env: ["RUN_ID=r", "BROKER_URL=http://10.0.0.2:3031", "BROKER_TOKEN=t"],
    user: "1000",
    pidsLimit: 64,
    memoryBytes: 1,
    cpuQuota: 1,
    cpuPeriod: 1,
    readonlyRootfs: true,
  };

  it("PidsLimit > 0, číselný uživatel ≠ 0, CapDrop ALL, no-new-privileges, jediná síť", () => {
    const t = buildRunContainerBody(vzor) as {
      User: string;
      NetworkingConfig: { EndpointsConfig: Record<string, unknown> };
      HostConfig: Record<string, unknown>;
    };
    expect(t.HostConfig.PidsLimit).toBeGreaterThan(0);
    expect(t.User).toMatch(/^[1-9]\d*(:[1-9]\d*)?$/);
    expect(t.HostConfig.CapDrop).toEqual(["ALL"]);
    expect(t.HostConfig.SecurityOpt).toEqual(["no-new-privileges:true"]);
    expect(t.HostConfig.NetworkMode).toBe("inst-exec-runs");
    expect(Object.keys(t.NetworkingConfig.EndpointsConfig)).toEqual(["inst-exec-runs"]);
  });

  it.each<[string, Partial<RunContainerSpec>]>([
    ["uživatel root", { user: "0" }],
    ["uživatel jménem", { user: "root" }],
    ["gid root", { user: "1000:0" }],
    ["bez stropu procesů", { pidsLimit: 0 }],
    ["klíč k mesh síti", { env: [...vzor.env, "NB_SETUP_KEY=x"] }],
    ["adresa správy meshe", { env: [...vzor.env, "NB_MANAGEMENT_URL=https://m"] }],
  ])("%s → odmítnuto", (_popis, zmena) => {
    expect(() => buildRunContainerBody({ ...vzor, ...zmena })).toThrow();
  });
});

describe("runner nesahá na správu mesh sítě (K1/K5 volby A: klíč se nerazí vůbec)", () => {
  it("žádný klient správy meshe, žádné NB_* do běhu, žádné NETBIRD_* z prostředí", () => {
    expect(existsSync(join(SRC, "netbird-client.ts"))).toBe(false);
    expect(souboryS(/NB_SETUP_KEY|NB_MANAGEMENT_URL/)).toEqual([]);
    expect(souboryS(/setup-keys|createEphemeralKey|revokePeer/)).toEqual([]);
    expect(souboryS(/process\.env\.NETBIRD_/)).toEqual([]);
  });
});

describe("compose stacku exec: runner drží povinnou broker-proxy a žádné pověření meshe", () => {
  type Sluzba = { environment?: Record<string, unknown>; networks?: Record<string, unknown> | string[]; ports?: unknown };
  const compose = parse(readFileSync(COMPOSE, "utf8"), { merge: true }) as {
    services: Record<string, Sluzba>;
    networks: Record<string, { name?: string; internal?: boolean; external?: boolean }>;
  };
  const runner = compose.services["svc-agent-runner"]!;
  const env = (runner.environment ?? {}) as Record<string, unknown>;
  /** `${X:?zpráva}` → `${X}` — zpráva není součást jména. */
  const jmeno = (v: unknown) => String(v ?? "").replace(/\$\{([A-Z0-9_]+):\?[^}]*\}/g, "${$1}");

  it("DOCKER_EXEC_NETWORK nese identitu instance a NENÍ staré jméno otevřené sítě (`-exec-net`)", () => {
    const sitBehu = jmeno(env.DOCKER_EXEC_NETWORK);
    expect(sitBehu, "DOCKER_EXEC_NETWORK chybí").toMatch(/^\$\{APP_NAME_PREFIX\}-/);
    // `-exec-net` zakládal starší runner jako OTEVŘENÝ bridge a na hostitelích dál leží;
    // pod tím jménem by runner každý běh (správně) odmítl a nasazení by stálo na ručním
    // `docker network rm`. Nové jméno = runner založí čistou uzavřenou síť sám.
    expect(sitBehu).not.toMatch(/-exec-net$/);
    // Kdyby síť někdy deklaroval i compose, musí být uzavřená (jinak by ji compose založil otevřenou).
    const vCompose = Object.entries(compose.networks ?? {}).find(([, n]) => jmeno(n.name) === sitBehu);
    if (vCompose) expect(vCompose[1].internal, `síť ${vCompose[0]} v compose musí být internal: true`).toBe(true);
  });

  it("BROKER_PROXY_ALIAS je deklarovaný a nese identitu instance (proxy povinná)", () => {
    expect(jmeno(env.BROKER_PROXY_ALIAS)).toMatch(/^\$\{APP_NAME_PREFIX\}-.+/);
  });

  it("runner nedostává pověření ke správě mesh sítě ani přepínač klíče běhu", () => {
    const nb = Object.keys(env).filter((k) => /^NETBIRD_/.test(k) && k !== "NETBIRD_PEER_CIDR");
    expect(nb).toEqual([]);
    expect(Object.values(env).map(String).filter((v) => /NETBIRD_MGMT_SECRET|NETBIRD_API_TOKEN/.test(v))).toEqual([]);
  });

  it("broker-proxy se nepublikuje na hostitele (runner nemá `ports`)", () => {
    expect(runner.ports).toBeUndefined();
  });
});
