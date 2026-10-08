/**
 * Vydávání balíčků se k registru OPRAVDU přihlásí
 *
 * ── PRAVIDLO ──────────────────────────────────────────────────────────────────
 * Po krocích přihlášení z workflow vydávání musí `npm` umět proti registru
 * odpovědět, kdo je (`npm whoami`) — tedy token musí ležet tam, kde ho npm čte,
 * a musí být platný. Co neplatí, se pozná TADY, ne až u `npm publish`.
 *
 * ── PROČ (naměřeno 2026-10-04) ────────────────────────────────────────────────
 * Vydávání v CI končilo E401 i u balíčku, který se sestavil (logy od 2026-06-11).
 * Krok přihlášení připisoval token do ~/.npmrc. Akce setup-node s `registry-url`
 * ale npm přesměruje proměnnou NPM_CONFIG_USERCONFIG na vlastní soubor a npm čte
 * právě jeden uživatelský soubor: změřeno, že s přesměrováním platné přihlášení
 * v ~/.npmrc nevidí. K tomu čerstvě vyražený token zůstal uvnitř kroku a krok
 * vydání dostal statický secret, který mezitím vypršel.
 *
 * ── JAK SE MĚŘÍ ───────────────────────────────────────────────────────────────
 * CHOVÁNÍM: kroky přihlášení VYJMUTÉ z workflow běží se skutečným npm a skutečným
 * skriptem ražení proti falešnému registru na 127.0.0.1 (přihlášení účtem a
 * heslem, /-/whoami podle tokenu). Prostředí má tvar, který nechává setup-node:
 * NPM_CONFIG_USERCONFIG míří na soubor se zástupným tokenem.
 *
 * Kotva: starý tvar (token připsaný do ~/.npmrc) nad týmž prostředím přihlášení
 * NEPROKÁŽE — jinak by brána prošla i tehdy, kdyby na místě zápisu nezáleželo.
 *
 * Z nedůvěřivého čtení (2026-10-04) měří i to, co první verze pouštěla: údaje
 * nastavené a token nezískaný je PÁD, ne zelené „nevydává“; token není na disku
 * ani v argumentech npm (jen odkaz na proměnnou prostředí); co nemá tvar tokenu,
 * se nezapíše.
 *
 * Lehká dráha: pět scénářů s npm a node proti místnímu serveru dává 1,5–2,0 s
 * i při loadu 41–44 (měřeno 3×). Podprocesy běží asynchronně — falešný registr
 * žije v témž procesu.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { parse } from "yaml";

const ROOT = process.cwd();
const WORKFLOW = ".forgejo/workflows/aisha-packages-publish.yml";

const UCET = "vydavatel";
const HESLO = "spravne-heslo";

/** Token tvaru JWT s daným koncem platnosti (podpis registr vzoru neověřuje). */
const jwt = (exp: number) => {
  const cast = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${cast({ alg: "HS256", typ: "JWT" })}.${cast({ name: UCET, exp })}.podpis`;
};
const TED = Math.floor(Date.now() / 1000);
const VYRAZENY = jwt(TED + 30 * 86_400);
const STATICKY_PLATNY = jwt(TED + 86_400);
const STATICKY_PROSLY = jwt(Date.UTC(2026, 5, 2, 12, 0) / 1000);
const STATICKY_DOBIHA = jwt(TED + 600);
const PLATNE = new Set([VYRAZENY, STATICKY_PLATNY]);

let server: Server;
let adresa = "";
/** Stav falešného registru pro balíček vzoru: vydané verze a přijatá vydání. */
const BALICEK = "@vzor/balicek";
const vRegistru = new Set<string>();
const prijataVydani: string[] = [];
let registrRozbity = false;
const ZAKLAD = mkdtempSync(path.join(tmpdir(), "prihlaseni-registr-"));

beforeAll(async () => {
  server = createServer((req, res) => {
    const odpovez = (kod: number, telo: unknown) => {
      res.writeHead(kod, { "Content-Type": "application/json" });
      res.end(JSON.stringify(telo));
    };
    if (req.method === "POST" && req.url === "/-/verdaccio/sec/login") {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        const { username, password } = JSON.parse(data || "{}") as { username?: string; password?: string };
        if (username === UCET && password === HESLO) odpovez(200, { username, token: VYRAZENY });
        else odpovez(401, { error: "bad username/password, access denied" });
      });
      return;
    }
    if (req.method === "GET" && req.url === "/-/whoami") {
      const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      if (PLATNE.has(token)) odpovez(200, { username: UCET });
      else odpovez(401, { error: "unauthorized" });
      return;
    }
    if (req.url === "/@vzor%2fbalicek") {
      if (registrRozbity) return odpovez(500, { error: "internal" });
      if (req.method === "GET") {
        if (vRegistru.size === 0) return odpovez(404, { error: "no such package available" });
        return odpovez(200, { name: BALICEK, versions: Object.fromEntries([...vRegistru].map((v) => [v, { name: BALICEK, version: v }])) });
      }
      if (req.method === "PUT") {
        const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
        let data = "";
        req.on("data", (c) => (data += c));
        req.on("end", () => {
          if (!PLATNE.has(token)) return odpovez(401, { error: "unauthorized" });
          const verze = Object.keys((JSON.parse(data || "{}") as { versions?: Record<string, unknown> }).versions ?? {});
          prijataVydani.push(...verze);
          verze.forEach((v) => vRegistru.add(v));
          odpovez(201, { ok: true, success: true });
        });
        return;
      }
    }
    odpovez(404, { error: "not found" });
  });
  await new Promise<void>((hotovo) => server.listen(0, "127.0.0.1", hotovo));
  adresa = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((hotovo) => server.close(() => hotovo()));
  rmSync(ZAKLAD, { recursive: true, force: true });
});

type Beh = { kod: number; vystup: string };

/** Asynchronně — falešný registr běží v témž procesu a musí stihnout odpovědět. */
const bash = (kod: string, env: Record<string, string>, cwd: string = ROOT): Promise<Beh> =>
  new Promise((hotovo) => {
    execFile("bash", ["-c", kod], { cwd, env, encoding: "utf8" }, (chyba, stdout, stderr) => {
      const c = chyba as (Error & { code?: number }) | null;
      hotovo({ kod: c ? (typeof c.code === "number" ? c.code : 1) : 0, vystup: `${stdout}${stderr}` });
    });
  });

/** Prostředí kroku tak, jak ho nechává setup-node s `registry-url`. */
function prostredi(jmeno: string, udaje: { ucet?: string; heslo?: string; staticky?: string }) {
  const dir = path.join(ZAKLAD, jmeno);
  mkdirSync(path.join(dir, "domov"), { recursive: true });
  const npmrc = path.join(dir, "setup-node.npmrc");
  const klic = `//${adresa.replace(/^https?:\/\//, "")}/`;
  writeFileSync(npmrc, `${klic}:_authToken=\${NODE_AUTH_TOKEN}\nregistry=${adresa}/\nalways-auth=true\n`);
  const vystupy = path.join(dir, "github-output");
  const promenne = path.join(dir, "github-env");
  writeFileSync(vystupy, "");
  writeFileSync(promenne, "");
  // npm obalené zapisovačem argumentů: token se do nich dostat nesmí (výpis procesů je čitelný všem).
  const argumenty = path.join(dir, "npm-argumenty");
  writeFileSync(argumenty, "");
  mkdirSync(path.join(dir, "bin"), { recursive: true });
  writeFileSync(
    path.join(dir, "bin", "npm"),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${argumenty}"\nPATH="${process.env.PATH ?? ""}" exec npm "$@"\n`,
    { mode: 0o755 },
  );
  const env: Record<string, string> = {
    PATH: `${path.join(dir, "bin")}:${process.env.PATH ?? ""}`,
    HOME: path.join(dir, "domov"),
    NPM_CONFIG_USERCONFIG: npmrc,
    npm_config_update_notifier: "false",
    VERDACCIO_URL: adresa,
    GITHUB_OUTPUT: vystupy,
    GITHUB_ENV: promenne,
  };
  if (udaje.ucet) env.VERDACCIO_USER = udaje.ucet;
  if (udaje.heslo) env.VERDACCIO_PASSWORD = udaje.heslo;
  if (udaje.staticky) env.VERDACCIO_TOKEN = udaje.staticky;
  const ctiPromenne = () => readFileSync(promenne, "utf8");
  /** Prostředí DALŠÍHO kroku: runner do něj načte, co předchozí krok zapsal do GITHUB_ENV. */
  const dalsiKrok = (): Record<string, string> => ({
    ...env,
    ...Object.fromEntries(
      ctiPromenne()
        .split("\n")
        .filter((r) => r.includes("="))
        .map((r) => [r.slice(0, r.indexOf("=")), r.slice(r.indexOf("=") + 1)] as [string, string]),
    ),
  });
  return {
    env,
    npmrc,
    klic,
    dalsiKrok,
    vystupy: () => readFileSync(vystupy, "utf8"),
    promenne: ctiPromenne,
    argumentyNpm: () => readFileSync(argumenty, "utf8"),
  };
}

/** Kroky přihlášení SKUTEČNÉHO workflow: nastavení a ověření. */
const wf = parse(readFileSync(path.join(ROOT, WORKFLOW), "utf8")) as {
  jobs?: Record<string, { steps?: { id?: string; name?: string; run?: unknown; env?: Record<string, string> }[] }>;
};
const kroky = Object.values(wf.jobs ?? {}).flatMap((j) => j.steps ?? []);
const krokNastav = kroky.find((k) => k.id === "auth");
const krokOver = kroky.find((k) => typeof k.run === "string" && /\bnpm whoami\b|registr-prihlaseni\.sh over/.test(k.run));
const krokVydej = kroky.find((k) => typeof k.run === "string" && k.run.includes("aisha-packages-publish.mjs"));

describe("přihlášení k registru před vydáváním", () => {
  it("workflow kroky přihlášení má — a ověření stojí před instalací a vydáním", () => {
    expect(krokNastav?.run, `${WORKFLOW}: krok s id „auth“ se nenašel — brána neměří`).toBeTypeOf("string");
    expect(krokOver?.run, `${WORKFLOW}: krok, který ověří přihlášení (npm whoami), chybí`).toBeTypeOf("string");
    expect(krokVydej, `${WORKFLOW}: krok vydání se nenašel`).toBeDefined();
    expect(kroky.indexOf(krokOver!)).toBeGreaterThan(kroky.indexOf(krokNastav!));
    const prvniInstalace = kroky.findIndex((k) => typeof k.run === "string" && /\bnpm (ci|install)\b/.test(k.run));
    expect(kroky.indexOf(krokOver!), "ověření má běžet dřív než minuty instalace").toBeLessThan(prvniInstalace);
  });

  it("účet a heslo: token se vyrazí, npm ho dostane jen prostředím a přihlášení funguje", async () => {
    const p = prostredi("razeni", { ucet: UCET, heslo: HESLO, staticky: STATICKY_PROSLY });
    const nastav = await bash(krokNastav!.run as string, p.env);
    expect(nastav.kod, nastav.vystup).toBe(0);
    expect(p.vystupy()).toContain("publish=true");
    // V souboru, který npm čte, je jen ODKAZ na proměnnou — token na disku není.
    const soubor = readFileSync(p.npmrc, "utf8");
    expect(soubor, "odkaz na token není v souboru, který npm čte").toContain(`${p.klic}:_authToken=\${NODE_AUTH_TOKEN}`);
    expect(soubor, "token se zapsal na disk").not.toContain(VYRAZENY);
    expect(existsSync(path.join(p.env.HOME, ".npmrc")), "něco se zapsalo do ~/.npmrc, který npm nečte").toBe(false);
    expect(p.argumentyNpm(), "sonda argumentů npm nic nezachytila — neměří").toContain("config set");
    expect(p.argumentyNpm(), "token šel do argumentů npm (je vidět ve výpisu procesů)").not.toContain(VYRAZENY);
    // Další kroky dostanou vyražený token prostředím (npm i dotaz na verzi) — a maskovaný.
    expect(p.promenne()).toContain(`NODE_AUTH_TOKEN=${VYRAZENY}`);
    expect(p.promenne()).toContain(`VERDACCIO_TOKEN=${VYRAZENY}`);
    expect(nastav.vystup).toContain(`::add-mask::${VYRAZENY}`);

    const over = await bash(krokOver!.run as string, p.dalsiKrok());
    expect(over.kod, over.vystup).toBe(0);
    expect(over.vystup).toContain(UCET);

    // Bez prostředí z GITHUB_ENV přihlášení fungovat NESMÍ — jinak by token ležel na disku.
    const bezPredani = await bash(krokOver!.run as string, p.env);
    expect(bezPredani.kod, "ověření prošlo i bez předaného tokenu").not.toBe(0);
  });

  it("kotva: token připsaný do ~/.npmrc (starý tvar) přihlášení NEPROKÁŽE", async () => {
    const p = prostredi("stary-tvar", {});
    const stary = [
      `echo "${p.klic}:_authToken=${VYRAZENY}" >> ~/.npmrc`,
      `echo "@aisha:registry=${adresa}" >> ~/.npmrc`,
      `echo "registry=${adresa}" >> ~/.npmrc`,
    ].join("\n");
    expect((await bash(stary, p.env)).kod).toBe(0);
    // Přímo npm, bez skriptu: token v ~/.npmrc existuje, a npm se s ním přesto nepřihlásí,
    // protože čte soubor z NPM_CONFIG_USERCONFIG. To je premisa celé opravy.
    const primo = await bash('npm whoami --registry "$VERDACCIO_URL"', p.env);
    expect(primo.kod, "npm se přihlásil tokenem z ~/.npmrc — vzor neměří, kam npm sahá").not.toBe(0);
    expect(primo.vystup).toMatch(/ENEEDAUTH|E401|need auth/);
    // A krok ověření z workflow to nenechá projít.
    expect((await bash(krokOver!.run as string, p.env)).kod).not.toBe(0);
  });

  it("token v prostředí, ale registr ho odmítne: ověření spadne s hláškou, kam npm sahá", async () => {
    const p = prostredi("odmitnuty", {});
    const over = await bash(krokOver!.run as string, { ...p.env, NODE_AUTH_TOKEN: jwt(TED + 86_400).replace("podpis", "cizi") });
    expect(over.kod).toBe(1);
    expect(over.vystup).toContain("přihlášení k registru NEFUNGUJE");
    expect(over.vystup).toContain(p.npmrc);
  });

  it("ražení selže, statický token platí: použije se záloha a řekne to", async () => {
    const p = prostredi("zaloha", { ucet: UCET, heslo: "spatne-heslo", staticky: STATICKY_PLATNY });
    const nastav = await bash(krokNastav!.run as string, p.env);
    expect(nastav.kod, nastav.vystup).toBe(0);
    // Důvod neúspěchu ražení je vidět (stderr se nezahazuje) — heslo v něm není.
    expect(nastav.vystup).toContain("registry login HTTP 401");
    expect(nastav.vystup).not.toContain("spatne-heslo");
    expect(nastav.vystup).toMatch(/statický secret, platí do \d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z/);
    expect(p.promenne()).toContain(`VERDACCIO_TOKEN=${STATICKY_PLATNY}`);
    expect(p.promenne()).toContain(`NODE_AUTH_TOKEN=${STATICKY_PLATNY}`);
    expect((await bash(krokOver!.run as string, p.dalsiKrok())).kod).toBe(0);
  });

  it("ražení selže a statický token vypršel: pád HNED, s datem — ne E401 až při vydání", async () => {
    const p = prostredi("prosly", { ucet: UCET, heslo: "spatne-heslo", staticky: STATICKY_PROSLY });
    const nastav = await bash(krokNastav!.run as string, p.env);
    expect(nastav.kod).toBe(1);
    expect(nastav.vystup).toContain("statický VERDACCIO_TOKEN vypršel 2026-06-02T12:00Z");
    expect(p.vystupy(), "vypršelý token nesmí vydávání povolit").not.toContain("publish=true");
    expect(p.promenne()).toBe("");
  });

  it("údaje jsou, ražení selže a záloha není: PÁD — ne zelené „nevydává“", async () => {
    const p = prostredi("bez-zalohy", { ucet: UCET, heslo: "spatne-heslo" });
    const nastav = await bash(krokNastav!.run as string, p.env);
    expect(nastav.kod, "vydavatel bez tokenu skončil zeleně — tichý zastaralý registr").toBe(1);
    expect(nastav.vystup).toContain("údaje k registru jsou nastavené, ale token se nezískal");
    expect(p.vystupy(), "pád se nesmí tvářit jako „tento repozitář nevydává“").not.toContain("publish=");
    expect(nastav.vystup).not.toContain("publish skipped");
  });

  it("jen půlka údajů (účet bez hesla) a žádný token: PÁD", async () => {
    const p = prostredi("pulka-udaju", { ucet: UCET });
    const nastav = await bash(krokNastav!.run as string, p.env);
    expect(nastav.kod).toBe(1);
    expect(nastav.vystup).toContain("jen půlka");
    expect(p.vystupy()).not.toContain("publish=");
  });

  it("statický token, který vyprší během úlohy, se bere jako vypršelý", async () => {
    const p = prostredi("dobiha", { staticky: STATICKY_DOBIHA });
    const nastav = await bash(krokNastav!.run as string, p.env);
    expect(nastav.kod).toBe(1);
    expect(nastav.vystup).toMatch(/statický VERDACCIO_TOKEN vyprší \d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z, dřív než/);
    expect(p.promenne()).not.toContain("NODE_AUTH_TOKEN=");
  });

  it("co nemá tvar tokenu (víc řádků), se do prostředí dalších kroků NEZAPÍŠE", async () => {
    const p = prostredi("viceradkovy", { staticky: "prvni-radek\nDRUHA_PROMENNA=podvrh" });
    const nastav = await bash(krokNastav!.run as string, p.env);
    expect(nastav.kod).toBe(1);
    expect(nastav.vystup).toContain("nemá tvar tokenu");
    expect(p.promenne(), "víceřádková hodnota by do GITHUB_ENV zapsala cizí proměnnou").toBe("");
  });

  it("bez jakýchkoli údajů: repozitář nevydává — přeskočeno nahlas, ne pád", async () => {
    const p = prostredi("fork", {});
    const nastav = await bash(krokNastav!.run as string, p.env);
    expect(nastav.kod, nastav.vystup).toBe(0);
    expect(p.vystupy()).toContain("publish=false");
    expect(nastav.vystup).toContain("::warning title=publish skipped::");
  });

  it("krok vydání nepřebíjí token statickým secretem", () => {
    // Token nese GITHUB_ENV z kroku přihlášení; `env:` kroku má přednost a vrátil by ten statický.
    expect(Object.keys(krokVydej!.env ?? {}), "VERDACCIO_TOKEN v env kroku vydání přebije vyražený token").not.toContain("VERDACCIO_TOKEN");
  });
});

describe("vydání balíčku: „verze už existuje“ není totéž co „vydání selhalo“", () => {
  const SKRIPT = path.join(ROOT, "scripts/ci/vydej-balicek.sh");

  /** Balíček vzoru v dočasném adresáři a prostředí přihlášené daným tokenem (odkaz v npmrc, token prostředím). */
  function balicek(jmeno: string, token: string) {
    const p = prostredi(jmeno, {});
    const dir = path.join(ZAKLAD, jmeno, "balicek");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: BALICEK, version: "1.2.3", main: "index.js" }));
    writeFileSync(path.join(dir, "index.js"), "module.exports = 1;\n");
    return { dir, env: { ...p.env, NODE_AUTH_TOKEN: token, GITHUB_WORKSPACE: ROOT } };
  }
  const vydej = (b: { dir: string; env: Record<string, string> }) => bash(`bash "${SKRIPT}"`, b.env, b.dir);

  it("verze v registru není a přihlášení platí: balíček se vydá", async () => {
    vRegistru.clear();
    prijataVydani.length = 0;
    registrRozbity = false;
    const r = await vydej(balicek("vydani-ok", VYRAZENY));
    expect(r.kod, r.vystup).toBe(0);
    expect(prijataVydani, "registr žádné vydání nedostal").toEqual(["1.2.3"]);
    expect(r.vystup).toContain(`Vydáno: ${BALICEK}@1.2.3`);
  });

  it("verze v registru už je: nic se nevydává a není to chyba", async () => {
    vRegistru.clear();
    vRegistru.add("1.2.3");
    prijataVydani.length = 0;
    registrRozbity = false;
    const r = await vydej(balicek("vydani-je", VYRAZENY));
    expect(r.kod, r.vystup).toBe(0);
    expect(r.vystup).toContain("už v registru je");
    expect(prijataVydani).toEqual([]);
  });

  it("registr vydání odmítne (neplatný token): PÁD — chyba se nespolkne jako „verze asi existuje“", async () => {
    vRegistru.clear();
    prijataVydani.length = 0;
    registrRozbity = false;
    const r = await vydej(balicek("vydani-odmitnuto", jwt(TED + 86_400).replace("podpis", "cizi")));
    expect(r.kod, "odmítnuté vydání skončilo zeleně").not.toBe(0);
    expect(r.vystup).not.toContain("Vydáno:");
    expect(prijataVydani).toEqual([]);
  });

  it("stav registru nejde zjistit: nevydává se naslepo ani se nepřeskakuje mlčky", async () => {
    vRegistru.clear();
    prijataVydani.length = 0;
    registrRozbity = true;
    const r = await vydej(balicek("vydani-nezmereno", VYRAZENY));
    registrRozbity = false;
    expect(r.kod).toBe(1);
    expect(r.vystup).toContain("nevydávám naslepo");
    expect(prijataVydani).toEqual([]);
  });
});

describe("každé vydání do registru ve workflow jde přes přihlášení a chybu nespolkne", () => {
  type Krok = { id?: string; name?: string; run?: unknown };
  const soubory = [".forgejo/workflows", ".github/workflows"]
    .filter((d) => existsSync(path.join(ROOT, d)))
    .flatMap((d) => readdirSync(path.join(ROOT, d)).filter((f) => /\.ya?ml$/.test(f)).map((f) => `${d}/${f}`));
  const VYDAVA = /\bnpm publish\b|vydej-balicek\.sh|aisha-packages-publish\.mjs/;

  const ulohy = soubory.flatMap((soubor) => {
    const w = parse(readFileSync(path.join(ROOT, soubor), "utf8")) as { jobs?: Record<string, { steps?: Krok[] }> };
    return Object.entries(w?.jobs ?? {}).map(([uloha, def]) => ({ soubor, uloha, kroky: (def?.steps ?? []).filter((k) => typeof k.run === "string") }));
  });
  const vydavajici = ulohy.filter((u) => u.kroky.some((k) => VYDAVA.test(k.run as string)));

  it("sonda nemlčí: vydávající úlohy se našly", () => {
    expect(vydavajici.map((u) => `${u.soubor} :: ${u.uloha}`).length, "žádná úloha nevydává — brána neměří").toBeGreaterThanOrEqual(2);
  });

  it("před vydáním stojí nastavení přihlášení i jeho ověření", () => {
    const bez = vydavajici
      .filter((u) => {
        const prvniVydani = u.kroky.findIndex((k) => VYDAVA.test(k.run as string));
        const pred = u.kroky.slice(0, prvniVydani).map((k) => k.run as string);
        return !(pred.some((r) => r.includes("registr-prihlaseni.sh nastav")) && pred.some((r) => r.includes("registr-prihlaseni.sh over")));
      })
      .map((u) => `${u.soubor} :: ${u.uloha}`);
    expect(
      bez,
      "Úloha vydává do registru bez kroků `registr-prihlaseni.sh nastav` a `over` před vydáním —\n" +
        "token pak vyprší potichu nebo ho npm nečte a pád přijde až u `npm publish` (nebo vůbec).",
    ).toEqual([]);
  });

  it("žádný blok run: nepolyká chybu `npm publish`", () => {
    const polyka = ulohy.flatMap((u) =>
      u.kroky.filter((k) => /\bnpm publish\b[^\n]*\|\|/.test(k.run as string)).map((k) => `${u.soubor} :: ${u.uloha} :: ${k.name ?? "krok"}`),
    );
    expect(polyka, "`npm publish … || …` spolkne i E401 — „verze už existuje“ se zjišťuje dotazem před vydáním (scripts/ci/vydej-balicek.sh)").toEqual([]);
  });
});
