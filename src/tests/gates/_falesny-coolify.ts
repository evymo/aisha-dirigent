/**
 * Postroj pro brány, které spouštějí SKUTEČNÝ cold-start proti FALEŠNÉMU Coolify.
 *
 * Proč: izolace prostředí je vlastnost celého běhu (obal → cold-start → discovery →
 * wipe), ne jednoho řádku. Incident 2026-09-24 prošel přes tři soubory, z nichž každý
 * „sám o sobě" vypadal správně. Měří se proto to, co by se stalo v Coolify: každý
 * požadavek, který by měnil stav.
 *
 * TŘI POJISTKY, aby test nikdy nesáhl na skutečný Coolify ani na pracovní kopii:
 *   1. běh jde v DOČASNÉ kopii repa (scripts/, config/, coolify/ se klonují — Node
 *      řeší cestu modulu přes realpath, symlink by ho vrátil do pracovní kopie);
 *      `.example` hodnoty se skutečnými hostiteli se v kopii přepíšou na falešný Coolify;
 *   2. síť: `curl` jde přes shim, který pustí jen 127.0.0.1/localhost, a Node dostane
 *      přes NODE_OPTIONS hák, který zablokuje každé TCP spojení mimo loopback;
 *   3. prostředí je prázdné (env -i): žádný token, HOME je dočasný adresář.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envWithoutGitLocation } from "../../../scripts/lib/git-worktree-health.mjs";

export type Aplikace = { uuid: string; name: string; environment_id: number; smazana?: boolean };
export type Projekt = { uuid: string; name: string; environments: { id: number; name: string }[] };
export type Pozadavek = { method: string; path: string; body: string };

export type Scenar = {
  projekty: Projekt[];
  aplikace: Aplikace[];
  /** env, které vrací GET /applications/{uuid}/envs (pro bootstrap zálohy a zděděné příznaky) */
  envAplikaci?: Record<string, { key: string; value: string }[]>;
};

/**
 * Sdílený Coolify, na kterém staging a produkce téže instance sdílejí JMÉNA
 * (naměřeno 2026-09-24 ve forku, staging na sdíleném Coolify): produkční projekt
 * se jmenuje jako instance (`inst`), stagingový jinak (`inst-staging`), aplikace
 * se v OBOU jmenují `inst-*`. Jméno instance tedy rozlišit neumí — rozliší jen
 * UUID projektu. Jména jsou syntetická; jádro nenese data žádného projektu.
 */
export function scenarSdilenaJmena(): Scenar {
  return {
    projekty: [
      { uuid: "proj-prod", name: "inst", environments: [{ id: 1, name: "production" }] },
      { uuid: "proj-stg", name: "inst-staging", environments: [{ id: 2, name: "production" }] },
    ],
    aplikace: [
      { uuid: "app-prod-core", name: "inst-core", environment_id: 1 },
      { uuid: "app-prod-netinit", name: "inst-netinit", environment_id: 1 },
      { uuid: "app-stg-core", name: "inst-core", environment_id: 2 },
      { uuid: "app-stg-netinit", name: "inst-netinit", environment_id: 2 },
    ],
    envAplikaci: {
      // netinit má v compose `DRY_RUN: ${DRY_RUN:-0}` — přesně tohle stáhl bootstrap 24. 9.
      "app-stg-netinit": [
        { key: "DRY_RUN", value: "0" },
        { key: "WIPE", value: "1" },
      ],
    },
  };
}

/** Coolify v4 mutuje i přes GET: /deploy, /applications/{uuid}/(start|stop|restart). */
export function jeMutujici(p: Pozadavek): boolean {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(p.method)) return true;
  const cesta = p.path.split("?")[0];
  return /^\/api\/v1\/deploy$/.test(cesta) || /\/applications\/[^/]+\/(start|stop|restart)$/.test(cesta);
}

/** Komu mutující požadavek patří: UUID projektu, "novy-projekt", nebo "neznamy". */
export function cilovyProjekt(p: Pozadavek, sc: Scenar): string {
  const cesta = p.path.split("?")[0];
  if (p.method === "POST" && cesta === "/api/v1/projects") return "novy-projekt";
  const envNaProjekt = new Map<number, string>();
  for (const pr of sc.projekty) for (const e of pr.environments) envNaProjekt.set(e.id, pr.uuid);
  const app = cesta.match(/\/applications\/([^/]+)/)?.[1];
  const zAplikace = app && sc.aplikace.find((a) => a.uuid === app);
  if (zAplikace) return envNaProjekt.get(zAplikace.environment_id) ?? "neznamy";
  const zDotazu = new URLSearchParams(p.path.split("?")[1] ?? "").get("uuid");
  const zDeploye = zDotazu && sc.aplikace.find((a) => a.uuid === zDotazu);
  if (zDeploye) return envNaProjekt.get(zDeploye.environment_id) ?? "neznamy";
  try {
    const telo = JSON.parse(p.body || "{}");
    if (typeof telo?.project_uuid === "string") return telo.project_uuid;
  } catch {
    /* tělo není JSON */
  }
  return "neznamy";
}

export async function falesnyCoolify(sc: Scenar): Promise<{
  url: string;
  pozadavky: Pozadavek[];
  zavri: () => Promise<void>;
}> {
  const pozadavky: Pozadavek[] = [];
  const telo = (req: IncomingMessage) =>
    new Promise<string>((ok) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => ok(b));
    });
  const server: Server = createServer(async (req, res) => {
    const body = await telo(req);
    const method = req.method ?? "GET";
    const path = req.url ?? "/";
    pozadavky.push({ method, path, body });
    const json = (kod: number, data: unknown) => {
      res.writeHead(kod, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    const cesta = path.split("?")[0].replace(/\/+$/, "");
    const zive = sc.aplikace.filter((a) => !a.smazana);
    const bezTajemstvi = (a: Aplikace) => ({ uuid: a.uuid, name: a.name, environment_id: a.environment_id, status: "running:healthy" });

    if (method === "DELETE") {
      const m = cesta.match(/^\/api\/v1\/applications\/([^/]+)$/);
      const a = m && sc.aplikace.find((x) => x.uuid === m[1]);
      if (a) a.smazana = true;
      return json(200, { message: "Application deletion request queued." });
    }
    if (method !== "GET") return json(201, { uuid: `novy-${pozadavky.length}` });

    if (cesta === "/api/v1/version") return json(200, "4.0.0-beta.falesny");
    if (cesta === "/api/v1/healthcheck" || cesta === "/api/health") return json(200, "OK");
    if (cesta === "/api/v1/projects") return json(200, sc.projekty.map(({ uuid, name }) => ({ uuid, name })));
    let m = cesta.match(/^\/api\/v1\/projects\/([^/]+)$/);
    if (m) {
      const pr = sc.projekty.find((p) => p.uuid === m![1]);
      return pr ? json(200, pr) : json(404, { message: "Project not found." });
    }
    m = cesta.match(/^\/api\/v1\/projects\/([^/]+)\/([^/]+)$/);
    if (m) {
      const pr = sc.projekty.find((p) => p.uuid === m![1]);
      const env = pr?.environments.find((e) => e.name === m![2]);
      if (!pr || !env) return json(404, { message: "Environment not found." });
      return json(200, { ...env, applications: zive.filter((a) => a.environment_id === env.id).map(bezTajemstvi) });
    }
    if (cesta === "/api/v1/applications") return json(200, zive.map(bezTajemstvi));
    m = cesta.match(/^\/api\/v1\/applications\/([^/]+)\/envs$/);
    if (m) return json(200, sc.envAplikaci?.[m[1]] ?? []);
    m = cesta.match(/^\/api\/v1\/applications\/([^/]+)$/);
    if (m) {
      const a = zive.find((x) => x.uuid === m![1]);
      return a ? json(200, bezTajemstvi(a)) : json(404, { message: "Application not found." });
    }
    if (cesta === "/api/v1/servers")
      return json(200, [{ uuid: "srv-a", name: "srv-a", ip: "127.0.0.1", is_coolify_host: true, settings: { is_build_server: false } }]);
    if (cesta === "/api/v1/services" || cesta === "/api/v1/databases") return json(200, []);
    return json(404, { message: "falesny Coolify: neznama cesta" });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    pozadavky,
    zavri: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}

const HAK_SITE = `// Pojistka postroje: Node smí jen na loopback.
import net from "node:net";
const povoleno = new Set(["127.0.0.1", "localhost", "::1", "::ffff:127.0.0.1"]);
const puvodni = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...a) {
  const o = a[0];
  const host = typeof o === "object" && o !== null ? (o.host ?? "localhost") : (typeof a[1] === "string" ? a[1] : "localhost");
  const jeCesta = typeof o === "object" && o !== null && typeof o.path === "string";
  if (!jeCesta && !povoleno.has(String(host))) {
    throw new Error("POSTROJ: spojeni mimo loopback zablokovano: " + host);
  }
  return puvodni.apply(this, a);
};
`;

const SHIM_CURL = `#!/bin/bash
# Pojistka postroje: curl smí jen na loopback.
for a in "$@"; do
  case "$a" in
    http://127.0.0.1*|http://localhost*|https://127.0.0.1*|https://localhost*) ;;
    http://*|https://*) echo "POSTROJ: curl mimo loopback zablokovan: $a" >&2; echo "$a" >> "$POSTROJ_LOG/curl-zablokovano"; exit 7 ;;
  esac
done
exec /usr/bin/curl "$@"
`;

/** Nástroje, které v bráně NESMÍ nic udělat: zapíšou se a selžou. */
// docker: projde JEN lokální validace `docker compose … config` (krok 2b), nic jiného.
const SHIM_DOCKER = `#!/bin/bash
echo "docker $*" >> "$POSTROJ_LOG/docker"
case " $* " in *" compose "*" config "*) exit 0 ;; esac
exit 1
`;

// git: projdou jen lokální dotazy (placeholder-scan, env-doctor); nic, co jde po síti.
const SHIM_GIT = `#!/bin/bash
echo "git $*" >> "$POSTROJ_LOG/git"
# podpříkaz = první argument za volbami -C <adr> / -c <k=v> (cold-start volá git -C "$REPO_ROOT" …)
kde=(); a=("$@")
while [ "\${#a[@]}" -gt 0 ]; do
  case "\${a[0]}" in
    -C|-c) kde+=("\${a[0]}" "\${a[1]}"); a=("\${a[@]:2}") ;;
    *) break ;;
  esac
done
case "\${a[0]:-}" in
  --version|rev-parse|ls-files|remote|config|status|diff|log|show) exec /usr/bin/git "$@" ;;
  ls-remote)
    # Jen holé repo postroje na disku, nikdy síť. Měří se SKUTEČNÝ cíl dotazu (jméno
    # remote nebo adresa, po přepisu insteadOf) — ne remote jménem origin: dotaz na
    # jinou adresu by jinak prošel, jakmile je origin lokální.
    cil=""
    for x in "\${a[@]:1}"; do case "$x" in -*) ;; *) cil="$x"; break ;; esac; done
    url=$(/usr/bin/git "\${kde[@]}" ls-remote --get-url "$cil" 2>/dev/null)
    case "$url" in /*) exec /usr/bin/git "$@" ;; esac ;;
esac
exit 128
`;

const ZAKAZANE = ["ssh", "scp", "rsync", "psql", "pg_dump", "security", "op", "gh", "tea", "kubectl"];

export function pripravPostroj(koren: string): { repo: string; home: string; shimy: string; log: string; hak: string } {
  const tmp = mkdtempSync(join(tmpdir(), "cs-izolace-"));
  const repo = join(tmp, "repo");
  const home = join(tmp, "home");
  const shimy = join(tmp, "shimy");
  const log = join(tmp, "log");
  for (const d of [repo, home, shimy, log]) mkdirSync(d, { recursive: true });

  const kopirovat = new Set(["scripts", "config", "coolify"]);
  for (const jmeno of readdirSync(koren)) {
    if (jmeno === ".git" || jmeno === "node_modules" || jmeno.startsWith(".env") && !jmeno.endsWith(".example")) continue;
    const zdroj = join(koren, jmeno);
    // .gitignore/.gitmodules/.gitattributes git jako symlink odmítne (bezpečnostní pravidlo) — kopie.
    if (kopirovat.has(jmeno) || jmeno.startsWith(".git")) cpSync(zdroj, join(repo, jmeno), { recursive: true, dereference: true });
    else symlinkSync(zdroj, join(repo, jmeno));
  }
  symlinkSync(join(koren, "node_modules"), join(repo, "node_modules"));

  const hak = join(tmp, "hak-site.mjs");
  writeFileSync(hak, HAK_SITE);
  writeFileSync(join(shimy, "curl"), SHIM_CURL);
  chmodSync(join(shimy, "curl"), 0o755);
  writeFileSync(join(shimy, "docker"), SHIM_DOCKER);
  chmodSync(join(shimy, "docker"), 0o755);
  writeFileSync(join(shimy, "git"), SHIM_GIT);
  chmodSync(join(shimy, "git"), 0o755);
  for (const n of ZAKAZANE) {
    const p = join(shimy, n);
    writeFileSync(p, `#!/bin/bash\necho "${n} $*" >> "$POSTROJ_LOG/zakazane-nastroje"\nexit 1\n`);
    chmodSync(p, 0o755);
  }
  return { repo, home, shimy, log, hak };
}

/** Forgejo syntetické instance postroje — odtud a z `repo:` manifestu plyne adresa, ze které se staví. */
export const FORGEJO_DOMENA_POSTROJE = "repo.inst.invalid";

/**
 * Domény stagingu v kopii repa: syntetické, na `.invalid` (placeholder-scan je propouští).
 * Skutečný soubor instance (je-li v repu) se v kopii PŘEPÍŠE — běh tak nezávisí na
 * datech žádného projektu a v jádru i ve forku měří totéž.
 */
export function zapisDomenyStagingu(repo: string): void {
  const kv: Record<string, string> = {
    INSTANCE_NAME: "inst-staging",
    APP_NAME_PREFIX: "inst",
    PUBLIC_TLD: "inst.invalid",
    INTERNAL_TLD: "inst.invalid",
    // Pin obsluhy (config/domains.env ho ctí): Forgejo instance, ze kterého se staví.
    // Stejnou adresu nese remote kopie repa — viz zalozGitOrigin().
    FORGEJO_DOMAIN: FORGEJO_DOMENA_POSTROJE,
    MESH_TLD: "mesh.inst.invalid",
    KEYCLOAK_DOMAIN: "auth.inst.invalid",
    KEYCLOAK_REALM: "inst",
    KC_REALM: "inst",
    VITE_KC_AUTHORITY: "https://auth.inst.invalid/realms/inst",
    VITE_KC_CLIENT_ID: "inst-app",
    OIDC_APP_CLIENT_ID: "inst-app",
    OIDC_CLIENT_PREFIX: "inst-",
    OAUTH2_COOKIE_DOMAINS: ".inst.invalid",
    OAUTH2_WHITELIST_DOMAINS: ".inst.invalid",
  };
  writeFileSync(
    join(repo, "config", "domains-staging.env"),
    Object.entries(kv).map(([k, v]) => `${k}=${v}`).join("\n") + "\n",
  );
}

/**
 * Kopie repa jako pracovní strom operátora: git repo, jehož HEAD = origin/main
 * (origin je holé repo na disku). Cold-start si to ověřuje, než nasadí (krok 2b2) —
 * proti repozitáři, ze kterého se staví; `deklarovanaUrl` je jeho adresa.
 * Volat PO úpravách konfigurace a PŘED zápisem .env souborů (ty zůstanou mimo git).
 */
export function zalozGitOrigin(repo: string, deklarovanaUrl?: string): void {
  // ⛔ NAMĚŘENO 2026-09-25 (fork, pre-push): uvnitř git hooku git exportuje GIT_DIR a
  // GIT_INDEX_FILE. Se ZDĚDĚNÝM prostředím šly `init/add/commit/push origin main` do
  // SKUTEČNÉHO repa: 4 commity „postroj" na větvi, přepsaný index, `core.bare=true`
  // a pokus pushnout lokální main na origin (odmítnut jen proto, že byl pozadu).
  // Proto: sdílené envWithoutGitLocation() (brána git-v-testech-bez-prostredi), pojistka
  // na git-dir a push jen na CESTU holého repa.
  const gitEnv = envWithoutGitLocation({ ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" });
  const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, env: gitEnv, stdio: "ignore" });
  const origin = `${repo}-origin.git`;
  execFileSync("git", ["init", "-q", "--bare", origin], { env: gitEnv, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: repo, env: gitEnv, encoding: "utf8" }).trim();
  if (realpathSync(gitDir) !== realpathSync(join(repo, ".git"))) {
    throw new Error(`POSTROJ: git-dir ${gitDir} neleží v dočasné kopii ${repo} — odmítám zapisovat do cizího repa`);
  }
  git("add", "-A");
  git("-c", "user.email=postroj@invalid", "-c", "user.name=postroj", "commit", "-q", "--no-verify", "-m", "postroj");
  if (deklarovanaUrl) {
    // Remote nese ADRESU repozitáře, ze kterého se staví — podle ní ho cold-start
    // (krok 2b2) pozná, na jménu remote nezáleží. Na holé repo na disku ji přepíše
    // insteadOf, takže dotaz nikdy neopustí stroj.
    git("remote", "add", "origin", deklarovanaUrl);
    git("config", `url.${origin}.insteadOf`, deklarovanaUrl);
  } else {
    git("remote", "add", "origin", origin);
  }
  git("push", "-q", origin, "HEAD:refs/heads/main");
}

/** Přepíše v kopii repa `.example` hodnoty se skutečnými hostiteli/UUID na falešné. */
export function vycistiPriklady(repo: string, coolifyUrl: string): void {
  const p = join(repo, "config", "coolify-environments.env.example");
  if (!existsSync(p)) return;
  const radky = readFileSync(p, "utf8").split("\n").map((r) => {
    const m = r.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) return r;
    if (/_URL$/.test(m[1])) return `${m[1]}=${coolifyUrl}`;
    if (/_UUID/.test(m[1])) return `${m[1]}=`;
    return r;
  });
  writeFileSync(p, radky.join("\n"));
}

export async function spustObal(opts: {
  repo: string;
  home: string;
  shimy: string;
  log: string;
  hak: string;
  env: Record<string, string>;
  args: string[];
  timeoutMs: number;
  /** Jakmile výstup obsahuje tuhle značku, běh se ukončí (zastaveno=true). */
  zastavNa?: RegExp;
}): Promise<{ kod: number | null; vystup: string; vyprselo: boolean; zastaveno: boolean }> {
  const PATH = [opts.shimy, `${process.execPath.replace(/\/node$/, "")}`, "/usr/bin", "/bin", "/usr/sbin", "/sbin", "/opt/homebrew/bin", "/usr/local/bin"].join(":");
  // Prostředí cold-startu staví postroj celé sám (nic nezdědí); envWithoutGitLocation ho navíc
  // dokazatelně zbaví git lokace, i kdyby ji někdo předal v opts.env (brána git-v-testech).
  const prostredi = envWithoutGitLocation({
    PATH,
    HOME: opts.home,
    TMPDIR: opts.home,
    LANG: "C.UTF-8",
    NODE_OPTIONS: `--import=${opts.hak}`,
    POSTROJ_LOG: opts.log,
    CI: "1",
    AISHA_NO_PROMPT: "1",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    // overlay-cachebust jinak volá `git ls-remote` (síť)
    KC_THEME_OVERLAY_CACHEBUST: "postroj",
    AISHA_WEB_DESIGN_CACHEBUST: "postroj",
    AISHA_DESIGN_CACHEBUST: "postroj",
    ...opts.env,
  });
  return new Promise((ok) => {
    let vystup = "";
    let vyprselo = false;
    let zastaveno = false;
    const p = spawn("bash", [join(opts.repo, "scripts", "aisha-cold-start-env.sh"), ...opts.args], {
      cwd: opts.repo,
      env: prostredi,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const pridej = (d: Buffer) => {
      vystup += d;
      if (opts.zastavNa && !zastaveno && opts.zastavNa.test(vystup)) {
        zastaveno = true;
        try {
          process.kill(-p.pid!, "SIGKILL");
        } catch {
          /* už skončil */
        }
      }
    };
    p.stdout.on("data", pridej);
    p.stderr.on("data", pridej);
    const t = setTimeout(() => {
      vyprselo = true;
      try {
        process.kill(-p.pid!, "SIGKILL");
      } catch {
        /* už skončil */
      }
    }, opts.timeoutMs);
    p.on("exit", (kod) => {
      clearTimeout(t);
      ok({ kod, vystup, vyprselo, zastaveno });
    });
  });
}
