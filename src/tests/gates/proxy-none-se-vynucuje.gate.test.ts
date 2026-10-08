/**
 * Brána: deklarace „proxy none" něco VYNUTÍ a něco SHODÍ — nezůstane deklarací,
 * kterou zelený doktor přejde (kontrakt oprav F1: T1, T2, T4 v doktoru a T5).
 *
 * ⛔ NAMĚŘENO 2026-10-03 (vnější recenze větve): rozdíl typu proxy proti deklaraci
 * slotu i „proxy NEZMĚŘENA" byly v doktoru jen varování a firewall hostitele
 * v `enforce` veřejnou proxy zakryl — výsledkem byl zelený doktor nad běžící
 * proxy. Zápis `none` do API Coolify navíc kontejner proxy nezastaví (past
 * u POLE_PROXY v scripts/coolify-server-proxy.mjs), takže ani shoda typu v API
 * neříká, že proxy neběží.
 *
 * SMYSL ZÁMĚRU BĚHU: stav SDÍLENÉHO serveru (typ proxy, běžící proxy na uzlu)
 * nesmí v PŘEDLETU zastavit žádný cold-start — produkční běh ho teprve srovná
 * a na konci ověří, ne-produkční ho měnit nesmí. Doktor proto od KAŽDÉHO
 * cold-startu dostane `--predlet-cold-startu=srovna|nemeni`; s ním jsou oba
 * nálezy hlasité varování, bez něj (samostatný doktor) FAIL. NEZMĚŘENO nikdy ok.
 *
 * CO SE MĚŘÍ (chování, ne text; každé „bez nálezu" má v témže běhu kotvu):
 *   1. T1 — SKUTEČNÝ nástroj proti atrapě Coolify API (HTTP, jen čtení) → výpis
 *      + návratový kód → SKUTEČNÁ funkce doktoru `proxy_serveru_verdikt`:
 *      typ ≠ deklarace = FAIL samostatně, varování v předletu (text rozliší, zda
 *      běh server srovná, nebo ho nemění); kotva: typ = deklarace → kód 0 a ok.
 *   2. T2 — odpověď bez pole typu proxy = kód 3, NIKDY ok; R2 (re-recenze d8):
 *      samostatně FAIL jako rozdíl (nezměřený stav nesmí projít snáz), v předletu
 *      varování. R3: kód 0, který výpis nedoloží (ticho, nebo `✗`/`?` vedle kódu 0),
 *      je NEZMĚŘENO — ve fázi F i ve fázi V (tam i kód 1 bez `✗` a 2/3 bez `?`);
 *      kotva: skutečné „není co měřit“ (jen `· `) je výsledek, ne ticho.
 *   3. T4 v doktoru (fáze V) — SKUTEČNÝ výstup `vnejsi-expozice.mjs` nad falešným
 *      `docker` → SKUTEČNÁ funkce `vnejsi_expozice_verdikt` + skutečné čítače
 *      a závěr doktoru: kontejner proxy s porty je samostatně FAIL (kód 1),
 *      v předletu varování a kód doktoru není fatální. Kotva: uzel bez proxy →
 *      ok ve všech třech. R1 (re-recenze d8): totéž pro KAŽDÝ kontejner, který
 *      publikuje port mimo loopback a deklaraci uzlu (druh `port na uzlu`) — dřív
 *      se poznávala jen proxy podle jména. Ostatní nálezy fáze V zůstávají FAIL vždy.
 *   4. T5 — „brána hotovosti" cold-startu (NEDOKONCENO → běh končí nenulou):
 *      kód 3 z nástroje proxy i nález/NEZMĚŘENO z kontroly kontejnerů na uzlu
 *      skončí jako nedokončeno. Rozdíl a NEZMĚŘENO v kroku 4c ale běh, který za
 *      sdílený server neodpovídá (ne-produkční, dry-run), červeně neukončí — jsou
 *      tam hlasitým varováním, rozhodnutým touž jedinou odpovědí
 *      (cs_beh_odpovida_za_sdileny_server). Závěrečné ověření uzlu (SKUTEČNÁ funkce
 *      `overeni_proxy_na_uzlu` + skutečný nástroj nad falešným `docker`) běží
 *      v každém produkčním běhu naostro — i se `--skip-deploy`; dry-run a
 *      ne-produkční běh neměří a řeknou to.
 *   Mutace (F1-a, F1-b, F1-h, úleva bez předletu, krok 4c) jsou tu jako kontrola měřidla:
 *   zmutovaná funkce musí dát jiný verdikt, jinak brána neměří nic.
 *
 * Celého doktora s fází F pustit nejde (discovery a SSH na servery); funkce se
 * proto vyřezávají ze skutečných skriptů a spouštějí se zaznamenávajícími
 * ok/warn/fail — stejně jako v bráně doktor-dvere-verdikt-z-kodu.
 *
 * Spouští se přes: npm run test:gates
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execFile, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const ROOT = process.cwd();
const DOKTOR = readFileSync(join(ROOT, "scripts/cold-start-doctor.sh"), "utf-8");
const COLD_START = readFileSync(join(ROOT, "scripts/aisha-cold-start.sh"), "utf-8");
const NASTROJ = join(ROOT, "scripts/coolify-server-proxy.mjs");
const SONDA = join(ROOT, "scripts/lib/vnejsi-expozice.mjs");
const PROSTREDI_BEHU = join(ROOT, "scripts/lib/prostredi-behu.sh");
const UUID = "srv-gpu";

/** Co doktorovi řekl cold-start o svém předletu: nic (samostatný doktor), `srovna`, `nemeni`. */
type Predlet = "" | "srovna" | "nemeni";
const PREDLETY: Predlet[] = ["", "srovna", "nemeni"];

/** Funkce bash `jmeno() { … }` (víceřádková, končí `}` na začátku řádku) ze skriptu. */
function funkce(zdroj: string, jmeno: string): string {
  const m = new RegExp(`^${jmeno}\\(\\) \\{\\n[\\s\\S]*?\\n\\}\\n`, "m").exec(zdroj);
  expect(m, `funkce ${jmeno} ve skriptu není`).not.toBeNull();
  return m![0];
}
/** Jednořádková funkce bash `jmeno() { …; }`. */
function funkceNaRadku(zdroj: string, jmeno: string): string {
  const m = new RegExp(`^${jmeno}\\(\\) \\{ .* \\}$`, "m").exec(zdroj);
  expect(m, `funkce ${jmeno} ve skriptu není`).not.toBeNull();
  return m![0];
}
/** Zmutuje text a ověří, že mutace něco změnila (jinak by kontrola měřidla měřila nic). */
function mutace(text: string, najdi: string, nahrad: string): string {
  expect(text.split(najdi).length - 1, `mutace: '${najdi}' má být v textu právě jednou`).toBe(1);
  return text.replace(najdi, nahrad);
}

// ── Atrapa Coolify API: jen GET serveru; `proxy` odpovědi určuje test ────────
let server: Server;
let url: string;
let proxyOdpovedi: unknown;
let zapisy = 0;
// ── Falešný `docker` na PATH: výpis kontejnerů uzlu a stav firewallu ze souborů ─
let adresar: string;
const FW = "vrstva-accel-hostfw";
// Firewall hostitele běží v síti hostitele (sit_hostitele v katalogu); ostatní kontejnery fixtury v mostu.
const radekVypisu = (jmeno: string, porty = "") =>
  JSON.stringify({ Names: jmeno, Networks: jmeno === "vrstva-accel-hostfw" ? "host" : "bridge", Ports: porty, State: "running", Status: "Up 2 hours" });
const PROXY = radekVypisu("coolify-proxy", "0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp, 0.0.0.0:443->443/udp");
const UZEL_BEZ_PROXY = [radekVypisu(FW), radekVypisu("vrstva-neco-jineho", "9000/tcp")];
const UZEL_S_PROXY = [radekVypisu(FW), PROXY];
/** R1: kontejner JINÉHO jména než proxy publikuje 443 mimo loopback (a jeho kotva na loopbacku). */
const UZEL_S_PORTEM = [radekVypisu(FW), radekVypisu("nekdo-aplikace", "0.0.0.0:443->443/tcp, [::]:443->443/tcp")];
const UZEL_S_PORTEM_NA_LOOPBACKU = [radekVypisu(FW), radekVypisu("nekdo-aplikace", "127.0.0.1:443->443/tcp, [::1]:443->443/tcp")];

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.method !== "GET") zapisy++;
    const zname = req.method === "GET" && req.url === `/api/v1/servers/${UUID}`;
    const telo = zname ? { uuid: UUID, name: "Uzel", ip: "192.0.2.9", ...(proxyOdpovedi === undefined ? {} : { proxy: proxyOdpovedi }) } : { message: "atrapa nezná" };
    res.writeHead(zname ? 200 : 404, { "content-type": "application/json" });
    res.end(JSON.stringify(telo));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  adresar = mkdtempSync(join(tmpdir(), "proxy-none-brana-"));
  writeFileSync(
    join(adresar, "docker"),
    [
      "#!/bin/sh",
      'printf \'%s\\n\' "$*" >> "$FALESNY_DOCKER_LOG"',
      '[ "$1" = "-H" ] || exit 64',
      'case "$3" in',
      '  ps) if [ "${FALESNY_DOCKER_PS_RC:-}" ]; then echo "ssh: connect to host: Connection timed out" >&2; exit "$FALESNY_DOCKER_PS_RC"; fi',
      '      cat "$FALESNY_DOCKER_PS" ;;',
      '  inspect) cat "$FALESNY_DOCKER_INSPECT" ;;',
      "  *) exit 64 ;;",
      "esac",
      "",
    ].join("\n"),
  );
  chmodSync(join(adresar, "docker"), 0o755);
  writeFileSync(join(adresar, "inspect.txt"), `${JSON.stringify({ Status: "running", Health: { Log: [{ ExitCode: 0, Output: "stav VYNUCENO\n" }] } })}\n`);
});
afterAll(async () => {
  await new Promise<void>((ok) => server.close(() => ok()));
  rmSync(adresar, { recursive: true, force: true });
});

/** Prostředí s falešným `docker` (první na PATH) nad daným výpisem kontejnerů; vrací i cestu k záznamu volání. */
function prostrediSDockerem(kontejnery: string[], extra: Record<string, string> = {}) {
  const ps = join(adresar, "ps.txt");
  const log = join(adresar, "docker.log");
  writeFileSync(ps, `${kontejnery.join("\n")}\n`);
  writeFileSync(log, "");
  return {
    log,
    env: {
      PATH: `${adresar}:${dirname(process.execPath)}:/usr/bin:/bin`,
      FALESNY_DOCKER_PS: ps,
      FALESNY_DOCKER_INSPECT: join(adresar, "inspect.txt"),
      FALESNY_DOCKER_LOG: log,
      ACCEL_DEKLARACE_B64: "x",
      ACCEL_OWNER_PREFIX: "vrstva",
      ACCEL_FW_NODE_OWNER: "vrstva",
      GPU_HOSTNAME: "uzel-gpu",
      ACCEL_FW_MODE: "enforce",
      ACCEL_FW_SSH: "sprava",
      ACCEL_FW_ADMIN_CIDRS: "192.0.2.0/24",
      ...extra,
    },
  };
}

/**
 * `coolify-server-proxy.mjs` tak, jak ho volá fáze F doktoru (jen čtení) — výpis
 * a kód procesu. Jedna odpověď API se měří jednou za běh souboru (ukončení
 * procesu nástroje trvá pod zátěží stroje vteřiny): kotva i nález jsou pořád
 * z téhož běhu a téže metody.
 */
const zmereno = new Map<string, Promise<{ vypis: string; kod: number }>>();
function mereni(proxy: unknown): Promise<{ vypis: string; kod: number }> {
  const klic = JSON.stringify(proxy ?? null);
  if (!zmereno.has(klic)) zmereno.set(klic, spustNastroj(proxy));
  return zmereno.get(klic)!;
}
function spustNastroj(proxy: unknown): Promise<{ vypis: string; kod: number }> {
  proxyOdpovedi = proxy;
  return new Promise((hotovo) => {
    execFile(
      process.execPath,
      [NASTROJ],
      {
        encoding: "utf-8",
        timeout: 120_000,
        // Čisté prostředí: VŠECHNY kanály adresy a pověření míří na atrapu, nic
        // se nedědí z terminálu (zděděná adresa by poslala dotaz na ostré API).
        env: {
          PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
          COOLIFY_BASE_URL: url,
          COOLIFY_URL: url,
          COOLIFY_API_TOKEN: "atrapa",
          COOLIFY_API_KEY: "atrapa",
          ACCEL_DEKLARACE_B64: "x",
          COOLIFY_SERVER_UUID_GPU: UUID,
        },
      },
      (err, stdout, stderr) => {
        const kod = err ? (typeof err.code === "number" ? err.code : 99) : 0;
        hotovo({ vypis: `${stdout}${stderr}`, kod });
      },
    );
  });
}

/**
 * Týž nástroj bez otevřené lane slotu, který proxy deklaruje: SKUTEČNÉ „není co
 * měřit" (kód 0, jen řádky `· `). Kotva pro R3 — kód 0 doložený řádkem `· ` je
 * výsledek, ne ticho. Atrapu API nástroj nevolá (žádný slot k měření).
 */
function spustNastrojBezLane(): Promise<{ vypis: string; kod: number }> {
  return new Promise((hotovo) => {
    execFile(
      process.execPath,
      [NASTROJ],
      {
        encoding: "utf-8",
        timeout: 120_000,
        env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, COOLIFY_BASE_URL: url, COOLIFY_URL: url, COOLIFY_API_TOKEN: "atrapa", COOLIFY_API_KEY: "atrapa" },
      },
      (err, stdout, stderr) => hotovo({ vypis: `${stdout}${stderr}`, kod: err ? (typeof err.code === "number" ? err.code : 99) : 0 }),
    );
  });
}

type Verdikt = { ok: string[]; warn: string[]; fail: string[]; info: string[] };

/** Skutečná (vyříznutá) funkce fáze F nad výpisem, kódem a předletem. */
function verdiktDoktoru(vypis: string, kod: number, predlet: Predlet, telo = funkce(DOKTOR, "proxy_serveru_verdikt"), ocekava = ""): Verdikt {
  const skript = String.raw`
    set -uo pipefail
    ok() { printf 'OK\t%s\n' "$*"; }
    info() { printf 'INFO\t%s\n' "$*"; }
    warn() { printf 'WARN\t%s\n' "$*"; }
    fail() { printf 'FAIL\t%s\n' "$*"; }
    eval "$FUNKCE"
    proxy_serveru_verdikt "$VYPIS" "$KOD" "$PREDLET" "$OCEKAVA"
  `;
  const r = spawnSync("bash", ["-c", skript], {
    encoding: "utf-8",
    env: { PATH: process.env.PATH ?? "", FUNKCE: telo, VYPIS: vypis, KOD: String(kod), PREDLET: predlet, OCEKAVA: ocekava },
  });
  expect(r.status, `verdikt doktoru neproběhl:\n${r.stderr}`).toBe(0);
  const radky = r.stdout.split("\n");
  const druh = (d: string) => radky.filter((l) => l.startsWith(`${d}\t`)).map((l) => l.slice(d.length + 1));
  return { ok: druh("OK"), warn: druh("WARN"), fail: druh("FAIL"), info: druh("INFO") };
}

describe("T1: typ proxy ≠ deklarace slotu shodí samostatného doktora (fáze F)", () => {
  test("T1: API vrací TRAEFIK, slot deklaruje none → nástroj kód 2, doktor FAIL; KOTVA: táž odpověď s NONE → kód 0 a ok", async () => {
    const kotva = await mereni({ type: "NONE", status: "exited" });
    expect(kotva.kod, kotva.vypis).toBe(0);
    const vKotvy = verdiktDoktoru(kotva.vypis, kotva.kod, "");
    expect(vKotvy.ok).toHaveLength(1);
    expect(vKotvy.ok[0]).toMatch(/^Proxy serveru: gpu .*typ proxy v API 'NONE' = deklarace$/);
    expect(vKotvy.fail).toEqual([]);
    expect(vKotvy.warn).toEqual([]);

    const m = await mereni({ type: "TRAEFIK", status: "running" });
    expect(m.kod, m.vypis).toBe(2);
    const v = verdiktDoktoru(m.vypis, m.kod, "");
    expect(v.fail, "rozdíl musí být FAIL, ne varování").toHaveLength(1);
    expect(v.fail[0]).toMatch(/^Proxy serveru se liší od deklarace slotu a nikdo ji teď nesrovná/);
    expect(v.ok, "rozdíl se nesmí tvářit jako shoda").toEqual([]);
    expect(zapisy, "fáze F jen čte").toBe(0);
  }, 120_000);

  test("T1: v PŘEDLETU cold-startu je týž rozdíl hlasité varování — produkční běh „ji nastaví“, ne-produkční „sdílený server nemění“; bez předletu FAIL", async () => {
    const m = await mereni({ type: "TRAEFIK", status: "running" });
    expect(m.kod).toBe(2);
    const srovna = verdiktDoktoru(m.vypis, m.kod, "srovna");
    expect(srovna.fail).toEqual([]);
    expect(srovna.ok).toEqual([]);
    expect(srovna.warn).toHaveLength(1);
    expect(srovna.warn[0]).toMatch(/tenhle běh ji nastaví \(krok 4c cold-startu/);

    const nemeni = verdiktDoktoru(m.vypis, m.kod, "nemeni");
    expect(nemeni.fail).toEqual([]);
    expect(nemeni.ok).toEqual([]);
    expect(nemeni.warn).toHaveLength(1);
    expect(nemeni.warn[0]).toMatch(/tenhle běh sdílený server nemění; srovná ho produkční běh/);
    expect(nemeni.warn[0], "ne-produkční běh nesmí slibovat, že proxy nastaví").not.toMatch(/tenhle běh ji nastaví/);

    expect(verdiktDoktoru(m.vypis, m.kod, "").fail).toHaveLength(1);
  }, 120_000);

  test("kontrola měřidla (mutace F1-a): větev rozdílu samostatného doktoru zpět na `warn` → FAIL zmizí, brána to vidí", () => {
    const vypis = "✗ gpu (srv-gpu…): Coolify: 'TRAEFIK', deklarace: 'none'\n";
    const zmutovana = mutace(funkce(DOKTOR, "proxy_serveru_verdikt"), 'fail "Proxy serveru se liší od deklarace slotu', 'warn "Proxy serveru se liší od deklarace slotu');
    expect(verdiktDoktoru(vypis, 2, "").fail).toHaveLength(1);
    expect(verdiktDoktoru(vypis, 2, "", zmutovana).fail, "mutace F1-a musí být vidět").toEqual([]);
  });

  test("doktor předlet PŘIJÍMÁ jen přepínačem s hodnotou srovna|nemeni (ne z prostředí); neznámou hodnotu odmítne", () => {
    const m = /^PREDLET_COLD_STARTU=""\nwhile \[\[ \$# -gt 0 \]\]; do\n[\s\S]*?\ndone\ncase "\$PREDLET_COLD_STARTU" in\n[\s\S]*?\nesac\n/m.exec(DOKTOR);
    expect(m, "rozbor přepínačů doktoru nenalezen").not.toBeNull();
    const rozbor = (args: string[]) => {
      const skript = 'NO_NETWORK=0; PHASES_FILTER=""; WIPE_PLANNED=0; fail() { echo "FAIL $*"; }; eval "$ROZBOR"; echo "PREDLET=<$PREDLET_COLD_STARTU>"';
      const r = spawnSync("bash", ["-c", skript, "doktor", ...args], {
        encoding: "utf-8",
        // Zděděná proměnná téhož jména nesmí předlet zapnout.
        env: { PATH: process.env.PATH ?? "", ROZBOR: m![0], PREDLET_COLD_STARTU: "srovna" },
      });
      return { kod: r.status, out: `${r.stdout}${r.stderr}` };
    };
    expect(rozbor([]).out).toMatch(/^PREDLET=<>$/m);
    expect(rozbor(["--no-network", "--wipe-planned"]).out).toMatch(/^PREDLET=<>$/m);
    expect(rozbor(["--predlet-cold-startu=srovna"]).out).toMatch(/^PREDLET=<srovna>$/m);
    expect(rozbor(["--predlet-cold-startu=nemeni"]).out).toMatch(/^PREDLET=<nemeni>$/m);
    for (const vadny of ["--predlet-cold-startu=ano", "--predlet-cold-startu=1", "--predlet-cold-startu", "--proxy-apply-planned"]) {
      const r = rozbor([vadny]);
      expect(r.kod, vadny).toBe(1);
      expect(r.out, vadny).toMatch(/^FAIL /m);
      expect(r.out, vadny).not.toMatch(/^PREDLET=/m);
    }
    // Obě fáze dostávají TÝŽ předlet — jedna podmínka, jeden přepínač.
    expect(DOKTOR.split('proxy_serveru_verdikt "$_px_out" "$_px_rc" "$PREDLET_COLD_STARTU"').length - 1).toBe(1);
    expect(DOKTOR.split('vnejsi_expozice_verdikt "$_v_out" "$_v_rc" "$PREDLET_COLD_STARTU"').length - 1).toBe(1);
  });

  test("cold-start předlet PŘEDÁVÁ vždy a hodnotu bere z JEDNÉ odpovědi: produkční běh naostro = srovna, jinak nemeni; táž odpověď řídí zápis v kroku 4c", () => {
    const radek = /^\s*if cs_beh_odpovida_za_sdileny_server; then _doctor_args\+=\(--predlet-cold-startu=srovna\); else _doctor_args\+=\(--predlet-cold-startu=nemeni\); fi$/m.exec(COLD_START);
    expect(radek, "krok 0 předlet doktorovi nepředává").not.toBeNull();
    const predano = (env: Record<string, string>) => {
      const skript = '. "$PROSTREDI_BEHU"; eval "$JE_PROD"; eval "$ODPOVIDA"; _doctor_args=(); eval "$RADEK"; printf "%s\\n" "${_doctor_args[@]}"';
      const r = spawnSync("bash", ["-c", skript], {
        encoding: "utf-8",
        env: {
          PATH: process.env.PATH ?? "",
          PROSTREDI_BEHU,
          JE_PROD: funkceNaRadku(COLD_START, "cs_je_prod_env"),
          ODPOVIDA: funkceNaRadku(COLD_START, "cs_beh_odpovida_za_sdileny_server"),
          RADEK: radek![0],
          ...env,
        },
      });
      return r.stdout.trim() || `<nic: ${r.stderr}>`;
    };
    expect(predano({ DRY_RUN: "0", AISHA_ENV: "production" })).toBe("--predlet-cold-startu=srovna");
    expect(predano({ DRY_RUN: "0" }), "prázdné AISHA_ENV = přímý běh = produkce").toBe("--predlet-cold-startu=srovna");
    expect(predano({ DRY_RUN: "0", AISHA_ENV: "staging" }), "ne-produkční běh sdílený server nemění").toBe("--predlet-cold-startu=nemeni");
    expect(predano({ DRY_RUN: "0", AISHA_ENV: "pribeh-staging" })).toBe("--predlet-cold-startu=nemeni");
    expect(predano({ DRY_RUN: "1", AISHA_ENV: "production" }), "dry-run nic nezapisuje").toBe("--predlet-cold-startu=nemeni");

    // Předává se VŽDY: řádek stojí hned za záměrem wipu, nepodmíněně, a je jediný.
    expect(COLD_START).toMatch(/\n\s*\[ "\$WIPE" = "1" \] && _doctor_args\+=\(--wipe-planned\)\n\s*if cs_beh_odpovida_za_sdileny_server; then _doctor_args\+=\(--predlet-cold-startu=srovna\)/);
    expect(COLD_START.split("_doctor_args+=(--predlet-cold-startu=").length - 1, "předlet se předává na jediném místě (obě hodnoty na témž řádku)").toBe(2);
    // Táž odpověď řídí zápis typu proxy (krok 4c) — a zápis má jedinou cestu.
    expect(COLD_START).toMatch(/\nif cs_beh_odpovida_za_sdileny_server; then\n\s*_px_args\+=\(--apply\)\n/);
    expect(COLD_START.split("_px_args+=(--apply)").length - 1, "zápis proxy má jedinou cestu").toBe(1);
  });
});

describe("T2: NEZMĚŘENO není shoda (kód 3 nikdy ok)", () => {
  test("T2 + R2: odpověď API nemá pole proxy.type → nástroj kód 3; samostatný doktor FAIL (jako rozdíl), v předletu varování; nikdy ok; KOTVA: odpověď s polem → kód 0 a ok", async () => {
    const kotva = await mereni({ type: "NONE", status: "exited" });
    expect(kotva.kod).toBe(0);
    expect(verdiktDoktoru(kotva.vypis, kotva.kod, "").ok).toHaveLength(1);

    for (const proxy of [undefined, { status: "exited" }]) {
      const m = await mereni(proxy);
      expect(m.kod, m.vypis).toBe(3);
      expect(m.vypis).toMatch(/^\? gpu .*NEMĚŘENO — odpověď nemá pole proxy\.type/m);
      for (const predlet of PREDLETY) {
        const v = verdiktDoktoru(m.vypis, m.kod, predlet);
        expect(v.ok, "NEZMĚŘENO se nesmí vypsat jako ok").toEqual([]);
        // R2 (re-recenze d8): samostatný doktor — nezměřený stav nesmí projít snáz
        // než změřený rozdíl (kód 2 je FAIL); v předletu hlasité varování.
        const [prisne, mekke] = predlet === "" ? [v.fail, v.warn] : [v.warn, v.fail];
        expect(prisne, `předlet '${predlet}'`).toHaveLength(1);
        expect(prisne[0]).toMatch(/^Proxy serveru NEZMĚŘENA — to není shoda/);
        expect(mekke, `předlet '${predlet}'`).toEqual([]);
      }
    }
  }, 120_000);

  test("R2: pořadí přísnosti samostatného doktoru — NEZMĚŘENO (3) je aspoň tak přísné jako rozdíl (2): obojí FAIL; v předletu obojí varování", () => {
    const rozdil = "✗ gpu (srv-gpu…): Coolify: 'TRAEFIK', deklarace: 'none'\n";
    const nezmereno = "? gpu (srv-gpu…): NEMĚŘENO — odpověď nemá pole proxy.type\n";
    expect(verdiktDoktoru(rozdil, 2, "").fail).toHaveLength(1);
    expect(verdiktDoktoru(nezmereno, 3, "").fail).toHaveLength(1);
    expect(verdiktDoktoru(nezmereno, 3, "").fail[0], "hláška řekne, proč samostatný doktor nepustí").toMatch(/samostatný doktor ji nepustí/);
    for (const predlet of ["srovna", "nemeni"] as const) {
      expect(verdiktDoktoru(rozdil, 2, predlet).fail).toEqual([]);
      expect(verdiktDoktoru(nezmereno, 3, predlet).fail).toEqual([]);
      expect(verdiktDoktoru(nezmereno, 3, predlet).warn).toHaveLength(1);
    }
  });

  test("kontrola měřidla (mutace F1-b, R2-a, R2-b): kód 3 hlásí `ok` / samostatný doktor zpět na `warn` / FAIL i v předletu → brána to vidí", () => {
    const vypis = "? gpu (srv-gpu…): NEMĚŘENO — odpověď nemá pole proxy.type\n";
    const telo = funkce(DOKTOR, "proxy_serveru_verdikt");
    // F1-b: NEZMĚŘENO jako ok (v předletu i samostatně).
    const jakoOk = mutace(telo, 'srovna|nemeni) warn "Proxy serveru NEZMĚŘENA', 'srovna|nemeni) ok "Proxy serveru NEZMĚŘENA');
    expect(verdiktDoktoru(vypis, 3, "srovna").ok).toEqual([]);
    expect(verdiktDoktoru(vypis, 3, "srovna", jakoOk).ok, "mutace F1-b musí být vidět").toHaveLength(1);
    // R2-a: samostatný doktor zpět na varování (stav před R2).
    const mekky = mutace(telo, '*) fail "Proxy serveru NEZMĚŘENA', '*) warn "Proxy serveru NEZMĚŘENA');
    expect(verdiktDoktoru(vypis, 3, "").fail).toHaveLength(1);
    expect(verdiktDoktoru(vypis, 3, "", mekky).fail, "mutace R2-a musí být vidět").toEqual([]);
    // R2-b: FAIL i v předletu (předlet by zastavil cold-start kvůli stavu sdíleného serveru).
    const prisnyVsude = mutace(telo, 'srovna|nemeni) warn "Proxy serveru NEZMĚŘENA', 'srovna|nemeni) fail "Proxy serveru NEZMĚŘENA');
    expect(verdiktDoktoru(vypis, 3, "nemeni").fail).toEqual([]);
    expect(verdiktDoktoru(vypis, 3, "nemeni", prisnyVsude).fail, "mutace R2-b musí být vidět").toHaveLength(1);
  });

  test("neznámý kód nástroje (vadná deklarace, API) je FAIL, ne ok — samostatně i v předletu", () => {
    for (const kod of [1, 9, 127]) {
      for (const predlet of PREDLETY) {
        const v = verdiktDoktoru("✗ deklarace: slot 'gpu': proxy=\"None\" není traefik|caddy|none\n", kod, predlet);
        expect(v.fail, `kód ${kod}, předlet '${predlet}'`).toHaveLength(1);
        expect(v.ok).toEqual([]);
      }
    }
  });
});

describe("R3 (fáze F): kód 0 je tvrzení — výpis ho musí doložit, jinak NEZMĚŘENO (ne ticho)", () => {
  test("R3: kód 0 bez jediného řádku výsledku (prázdný výpis, jen šum) → NEZMĚŘENO: samostatně FAIL, v předletu varování, nikdy ok; KOTVA: skutečný výstup se ✓ → ok, skutečné „není co měřit“ (jen `· `) → info, bez varování i FAIL", async () => {
    const shoda = await mereni({ type: "NONE", status: "exited" });
    expect(shoda.kod, shoda.vypis).toBe(0);
    const bezLane = await spustNastrojBezLane();
    expect(bezLane.kod, bezLane.vypis).toBe(0);
    expect(bezLane.vypis, "kotva: nástroj bez slotu v provozu říká PROČ, řádkem `· `").toMatch(/^· slot 'gpu' deklaruje proxy, ale není v provozu/m);
    expect(bezLane.vypis).not.toMatch(/^[✓✗?] /m);
    for (const predlet of PREDLETY) {
      const vShody = verdiktDoktoru(shoda.vypis, shoda.kod, predlet);
      expect(vShody.ok, `předlet '${predlet}'`).toHaveLength(1);
      expect([...vShody.warn, ...vShody.fail]).toEqual([]);
      const vBezLane = verdiktDoktoru(bezLane.vypis, bezLane.kod, predlet);
      expect(vBezLane.info.some((l) => l.includes("není v provozu")), `předlet '${predlet}'`).toBe(true);
      expect([...vBezLane.ok, ...vBezLane.warn, ...vBezLane.fail], `předlet '${predlet}': „není co měřit“ není ok ani nález`).toEqual([]);

      for (const ticho of ["", "\n\n", "coolify-server-proxy: cosi na stderr\n"]) {
        const v = verdiktDoktoru(ticho, 0, predlet);
        const popis = `předlet '${predlet}', výpis ${JSON.stringify(ticho)}`;
        expect(v.ok, popis).toEqual([]);
        const [prisne, mekke] = predlet === "" ? [v.fail, v.warn] : [v.warn, v.fail];
        expect(prisne, popis).toHaveLength(1);
        expect(prisne[0], popis).toMatch(/^Proxy serveru NEZMĚŘENA — to není shoda \(nástroj skončil kódem 0 a nevypsal jediný řádek výsledku — ticho není shoda\)/);
        expect(mekke, popis).toEqual([]);
      }
    }
  }, 120_000);

  test("R3: kód 0 a ve výpisu `✗ ` nebo `? ` (kód a výpis si odporují) → NEZMĚŘENO, ani shoda sousedního slotu se nevypíše jako ok", () => {
    for (const odpor of ["? jiny-slot: NEMĚŘENO — pole chybí", "✗ jiny-slot: Coolify: 'TRAEFIK', deklarace: 'none'"]) {
      const vypis = `✓ gpu (srv-gpu…): typ proxy v API 'NONE' = deklarace\n${odpor}\n`;
      const samostatne = verdiktDoktoru(vypis, 0, "");
      expect(samostatne.ok, odpor).toEqual([]);
      expect(samostatne.fail, odpor).toHaveLength(1);
      expect(samostatne.fail[0]).toMatch(/kód a výpis si odporují/);
      const predlet = verdiktDoktoru(vypis, 0, "srovna");
      expect(predlet.ok, odpor).toEqual([]);
      expect(predlet.warn, odpor).toHaveLength(1);
      // Kotva: tentýž výpis bez odporujícího řádku je shoda.
      expect(verdiktDoktoru(vypis.split("\n")[0], 0, "").ok).toHaveLength(1);
    }
  });

  test("kontrola měřidla (mutace R3-a, R3-b, R3-c): ticho / odpor bez povšimnutí / `· ` bez dokladu → brána to vidí", () => {
    const telo = funkce(DOKTOR, "proxy_serveru_verdikt");
    const tichoProjde = mutace(telo, 'elif [[ "$doklad" -eq 0 ]]; then', "elif false; then");
    expect(verdiktDoktoru("", 0, "").fail).toHaveLength(1);
    expect(verdiktDoktoru("", 0, "", tichoProjde).fail, "mutace R3-a (ticho) musí být vidět").toEqual([]);
    const odporProjde = mutace(telo, 'if [[ "$rozpor" -eq 1 ]]; then', "if false; then");
    const odpor = "✓ gpu: typ proxy v API 'NONE' = deklarace\n? jiny: NEMĚŘENO\n";
    expect(verdiktDoktoru(odpor, 0, "").ok).toEqual([]);
    expect(verdiktDoktoru(odpor, 0, "", odporProjde).ok, "mutace R3-b (odpor) musí být vidět").toHaveLength(1);
    const infoNeniDoklad = mutace(telo, '"· "*) if [[ "${4:-}" == "1" ]]; then jen_info=1; else doklad=1; fi ;;', '"· "*) jen_info=1 ;;');
    const neniCoMerit = "· slot 'gpu' deklaruje proxy, ale není v provozu (lane jeho služeb zavřená) — neměří se\n";
    expect(verdiktDoktoru(neniCoMerit, 0, "").fail).toEqual([]);
    expect(verdiktDoktoru(neniCoMerit, 0, "", infoNeniDoklad).fail, "mutace R3-c (`· ` není doklad) musí být vidět").toHaveLength(1);
  });
});

describe("P1 (re-recenze 2 d8): „·“ je doklad JEN když deklarace měření nečeká", () => {
  test("P1 (fáze F): deklarovaný uzel s firewallem + skutečný výstup jen „·“ + kód 0 → NEZMĚŘENO (samostatně FAIL, v předletu varování); KOTVA: bez deklarovaného uzlu týž výstup = info, bez nálezu", async () => {
    const bezLane = await spustNastrojBezLane();
    expect(bezLane.kod, bezLane.vypis).toBe(0);
    expect(bezLane.vypis).not.toMatch(/^[✓✗?] /m);
    for (const predlet of PREDLETY) {
      const ceka = verdiktDoktoru(bezLane.vypis, 0, predlet, undefined, "1");
      expect(ceka.ok, `předlet '${predlet}'`).toEqual([]);
      const [prisne, mekke] = predlet === "" ? [ceka.fail, ceka.warn] : [ceka.warn, ceka.fail];
      expect(prisne, `předlet '${predlet}'`).toEqual([expect.stringMatching(/^Proxy serveru NEZMĚŘENA — to není shoda \(instance deklaruje uzel s firewallem, a nástroj přesto vrátil kód 0 jen s „není co měřit“/)]);
      expect(mekke).toEqual([]);
      for (const nececka of ["0", ""]) {
        const kotva = verdiktDoktoru(bezLane.vypis, 0, predlet, undefined, nececka);
        expect([...kotva.ok, ...kotva.warn, ...kotva.fail], `předlet '${predlet}', čeká '${nececka}'`).toEqual([]);
        expect(kotva.info.length).toBeGreaterThan(0);
      }
      // Skutečné měření (✓) projde i s deklarovaným uzlem — „čeká měření“ neznamená „nic neprojde“.
      expect(verdiktDoktoru("✓ gpu (srv-gpu…): typ proxy v API 'NONE' = deklarace\n", 0, predlet, undefined, "1").ok).toHaveLength(1);
    }
  }, 120_000);

  test("P1 (doktor): o tom, zda deklarace měření čeká, rozhoduje lane firewallu z katalogu (provision-gate --zapnuto accel-hostfw) nad souborem prostředí doktoru; nezjištěno = čeká", () => {
    const pomocnik = funkce(DOKTOR, "uzel_s_firewallem_deklarovan");
    const adr = mkdtempSync(join(tmpdir(), "p1-doktor-"));
    try {
      const zeptej = (obsah: string | null, koren = ROOT) => {
        const soubor = join(adr, "doktor.env");
        if (obsah === null) rmSync(soubor, { force: true });
        else writeFileSync(soubor, obsah);
        const r = spawnSync("bash", ["-c", 'eval "$FUNKCE"; uzel_s_firewallem_deklarovan'], {
          encoding: "utf-8",
          env: { PATH: process.env.PATH ?? "", FUNKCE: pomocnik, DOKTOR_ENV_SOUBOR: soubor, REPO_ROOT: koren },
        });
        return r.stdout.trim();
      };
      expect(zeptej("ACCEL_FW_NODE_OWNER=vrstva-a\n")).toBe("1");
      expect(zeptej("ACCEL_FW_SSH=svet\n")).toBe("1");
      expect(zeptej("ACCEL_DEKLARACE_B64=x\n"), "lane vstupu uzel s firewallem nedeklaruje").toBe("0");
      expect(zeptej(""), "kotva: nic deklarováno").toBe("0");
      expect(zeptej("ACCEL_FW_NODE_OWNER=vrstva-a\n", join(adr, "neni-repo")), "nástroj nejde spustit = čeká (fail-closed)").toBe("1");
      // Každý kód nástroje zvlášť (zástupný provision-gate): 0 = otevřená lane, 1 + klíče = zavřená,
      // 1 bez klíčů = pád, 2 (NEMĚŘENO: katalog nečitelný, neznámý přepínač) i jiný = čeká.
      const zastupce = (kod: number, vystup: string) => {
        const koren = join(adr, `zastupce-${kod}-${vystup ? "s" : "bez"}`);
        mkdirSync(join(koren, "scripts/lib"), { recursive: true });
        writeFileSync(join(koren, "scripts/lib/provision-gate.mjs"), `process.stdout.write(${JSON.stringify(vystup)}); process.exit(${kod});\n`);
        return zeptej("", koren);
      };
      expect(zastupce(0, ""), "otevřená lane").toBe("1");
      expect(zastupce(1, "ACCEL_FW_NODE_OWNER ACCEL_FW_SSH\n"), "kotva: zavřená lane = nečeká").toBe("0");
      expect(zastupce(1, ""), "kód 1 bez klíčů = pád").toBe("1");
      expect(zastupce(2, ""), "NEMĚŘENO nástroje = čeká").toBe("1");
      expect(zastupce(3, "x\n"), "neznámý kód = čeká").toBe("1");
    } finally {
      rmSync(adr, { recursive: true, force: true });
    }
    // Zapojení: obě fáze se ptají téhož pomocníka; lane se neopisuje, jen jméno služby katalogu.
    expect(DOKTOR.split('"$(uzel_s_firewallem_deklarovan)"').length - 1).toBe(2);
    expect(pomocnik).toMatch(/--zapnuto accel-hostfw/);
  });

  test("kontrola měřidla (mutace P1-a, P1-b): „·“ zase doklad i s deklarovaným uzlem → brána to vidí", () => {
    const vypis = "· slot 'gpu' deklaruje proxy, ale není v provozu (lane jeho služeb zavřená) — neměří se\n";
    const telo = funkce(DOKTOR, "proxy_serveru_verdikt");
    const mutF = mutace(telo, '"· "*) if [[ "${4:-}" == "1" ]]; then jen_info=1; else doklad=1; fi ;;', '"· "*) doklad=1 ;;');
    expect(verdiktDoktoru(vypis, 0, "", undefined, "1").fail).toHaveLength(1);
    expect(verdiktDoktoru(vypis, 0, "", mutF, "1").fail, "mutace P1-a musí být vidět").toEqual([]);
  });
});

describe("T4 v doktoru (fáze V): proxy na uzlu je FAIL samostatně, v předletu cold-startu hlasité varování", () => {
  /**
   * `vnejsi-expozice.mjs` tak, jak ho volá fáze V — nad falešným `docker` (výpis
   * kontejnerů uzlu) a BEZ Coolify i odchozí IP: měří se jen uzel, zbytek sonda
   * přizná jako NEMĚŘENO a žádné spojení ven nevznikne.
   */
  function fazeV(kontejnery: string[], extra: Record<string, string> = {}): Promise<{ vypis: string; kod: number }> {
    const { env } = prostrediSDockerem(kontejnery, extra);
    return new Promise((hotovo) => {
      execFile(process.execPath, [SONDA], { encoding: "utf-8", timeout: 120_000, env }, (err, stdout, stderr) =>
        hotovo({ vypis: `${stdout}${stderr}`, kod: err ? (typeof err.code === "number" ? err.code : 99) : 0 }),
      );
    });
  }

  // Skutečné čítače, hlášení a závěr doktoru — kód „běhu“ je kód, kterým by doktor skončil.
  const BARVY = /^R='\\033\[0;31m'; .*$/m.exec(DOKTOR)?.[0] ?? "";
  const HLASENI = [...DOKTOR.matchAll(/^(?:ok|fail|warn|info)\(\)\s+\{ .* \}$/gm)].map((m) => m[0]).join("\n");
  const CITACE = /^PASS_COUNT=0\nFAIL_COUNT=0\nWARN_COUNT=0\nFAIL_REASONS=\(\)\nWARN_REASONS=\(\)$/m.exec(DOKTOR)?.[0] ?? "";
  const ZAVER = DOKTOR.slice(DOKTOR.lastIndexOf('echo -e "\\n${C}${BOLD}━━━ SUMMARY ━━━${N}"'));
  // eslint-disable-next-line no-control-regex
  const bezBarev = (t: string) => t.replace(/\x1b\[[0-9;]*m/g, "");

  /** Skutečná funkce fáze V + skutečný závěr doktoru nad výpisem; vrací kód doktoru a jeho hlášení. */
  function doktor(vypis: string, kod: number, predlet: Predlet, telo = funkce(DOKTOR, "vnejsi_expozice_verdikt"), ocekava = "") {
    const skript = 'set -uo pipefail\neval "$BARVY"\neval "$HLASENI"\neval "$CITACE"\neval "$FUNKCE"\nvnejsi_expozice_verdikt "$VYPIS" "$KOD" "$PREDLET" "$OCEKAVA"\neval "$ZAVER"\n';
    const r = spawnSync("bash", ["-c", skript], {
      encoding: "utf-8",
      env: { PATH: process.env.PATH ?? "", BARVY, HLASENI, CITACE, ZAVER, FUNKCE: telo, VYPIS: vypis, KOD: String(kod), PREDLET: predlet, OCEKAVA: ocekava },
    });
    const radky = bezBarev(`${r.stdout}${r.stderr}`).split("\n");
    const pred = radky.slice(0, radky.findIndex((l) => l.includes("SUMMARY")));
    const druh = (znak: string) => pred.filter((l) => l.startsWith(`  ${znak} `)).map((l) => l.slice(4));
    return { kod: r.status, ok: druh("✓"), warn: druh("⚠"), fail: druh("✗"), out: radky.join("\n") };
  }

  test("měřidlo: hlášení, čítače a závěr doktoru jsou ve skriptu k vyříznutí a závěr rozlišuje FAIL / varování / čisto", () => {
    expect(BARVY.length).toBeGreaterThan(0);
    expect(HLASENI.split("\n")).toHaveLength(4);
    expect(CITACE.length).toBeGreaterThan(0);
    expect(ZAVER).toMatch(/NOT READY for cold-start/);
    expect(doktor("✗ gpu: cokoli\n", 1, "").kod).toBe(1);
    expect(doktor("? gpu: cokoli\n", 2, "").kod).toBe(2);
    expect(doktor("✓ gpu: cokoli\n", 0, "").kod).toBe(0);
  });

  test("T4 (doktor): kontejner proxy publikuje porty → samostatně FAIL a doktor končí fatálně (1); v předletu cold-startu hlasité VAROVÁNÍ a kód není fatální (2); KOTVA: uzel bez proxy → ok ve všech třech", async () => {
    const kotva = await fazeV(UZEL_BEZ_PROXY);
    expect(kotva.vypis).toMatch(/^✓ gpu: žádný kontejner proxy serveru/m);
    for (const predlet of PREDLETY) {
      const v = doktor(kotva.vypis, kotva.kod, predlet);
      expect(v.fail, `předlet '${predlet}':\n${v.out}`).toEqual([]);
      expect(v.ok.filter((l) => l.includes("žádný kontejner proxy serveru"))).toHaveLength(1);
      expect(v.warn.some((l) => l.includes("PROXY NA UZLU")), "bez proxy není o čem varovat").toBe(false);
      expect(v.kod).not.toBe(1);
    }

    const m = await fazeV(UZEL_S_PROXY);
    expect(m.kod, m.vypis).toBe(1);
    expect(m.vypis).toMatch(/^✗ proxy na uzlu: gpu: kontejner proxy serveru 'coolify-proxy' publikuje 80\/tcp, 443\/tcp, 443\/udp/m);

    const samostatne = doktor(m.vypis, m.kod, "");
    expect(samostatne.fail, samostatne.out).toHaveLength(1);
    expect(samostatne.fail[0]).toMatch(/^Vnější expozice: proxy na uzlu: gpu: kontejner proxy serveru 'coolify-proxy' publikuje/);
    expect(samostatne.kod, "samostatný doktor: NOT READY").toBe(1);

    const texty: Record<Exclude<Predlet, "">, RegExp> = {
      srovna: /tenhle běh to na konci ověří a zapíše jako NEDOKONČENO/,
      nemeni: /tenhle běh sdílený server nemění — ověří ho produkční běh/,
    };
    for (const predlet of ["srovna", "nemeni"] as const) {
      const predletDoktoru = doktor(m.vypis, m.kod, predlet);
      expect(predletDoktoru.fail, predletDoktoru.out).toEqual([]);
      const varovani = predletDoktoru.warn.filter((l) => l.includes("PROXY NA UZLU PUBLIKUJE PORTY"));
      expect(varovani, predlet).toHaveLength(1);
      expect(varovani[0]).toMatch(texty[predlet]);
      expect(varovani[0]).toMatch(/gpu: kontejner proxy serveru 'coolify-proxy' publikuje 80\/tcp/);
      expect(predletDoktoru.ok.some((l) => l.includes("proxy")), "nález se nesmí vypsat jako ok").toBe(false);
      expect(predletDoktoru.kod, `předlet '${predlet}': varování, ne fatální`).toBe(2);
    }
    expect(doktor(m.vypis, m.kod, "nemeni").warn.join("\n"), "ne-produkční běh nesmí slibovat závěrečné ověření").not.toMatch(/na konci ověří/);
  }, 120_000);

  test("R1 (doktor): JINÝ kontejner publikuje port mimo loopback a deklaraci → skutečný výstup sondy `✗ port na uzlu:`; samostatně FAIL a doktor končí fatálně (1), v předletu hlasité VAROVÁNÍ (2) jako u proxy; KOTVA: tentýž kontejner na loopbacku → ok ve všech třech", async () => {
    const kotva = await fazeV(UZEL_S_PORTEM_NA_LOOPBACKU);
    expect(kotva.vypis, "kotva: loopback není vystavení").toMatch(/^✓ gpu: žádný kontejner proxy serveru .* ani jiný kontejner nepublikuje port mimo loopback/m);
    expect(kotva.vypis).not.toMatch(/^✗/m);

    const m = await fazeV(UZEL_S_PORTEM);
    expect(m.kod, m.vypis).toBe(1);
    expect(m.vypis).toMatch(/^✗ port na uzlu: gpu: kontejner 'nekdo-aplikace' publikuje 443\/tcp na 0\.0\.0\.0, \[::\] mimo loopback a mimo deklaraci/m);
    for (const predlet of PREDLETY) {
      const vKotvy = doktor(kotva.vypis, kotva.kod, predlet);
      expect(vKotvy.fail, `předlet '${predlet}':\n${vKotvy.out}`).toEqual([]);
      expect(vKotvy.warn.some((l) => l.includes("NA UZLU")), "bez nálezu není o čem varovat").toBe(false);
    }
    const samostatne = doktor(m.vypis, m.kod, "");
    expect(samostatne.fail, samostatne.out).toHaveLength(1);
    expect(samostatne.fail[0]).toMatch(/^Vnější expozice: port na uzlu: gpu: kontejner 'nekdo-aplikace' publikuje 443\/tcp/);
    expect(samostatne.kod).toBe(1);
    for (const predlet of ["srovna", "nemeni"] as const) {
      const v = doktor(m.vypis, m.kod, predlet);
      expect(v.fail, v.out).toEqual([]);
      const varovani = v.warn.filter((l) => l.includes("PORT NA UZLU PUBLIKOVANÝ MIMO DEKLARACI"));
      expect(varovani, predlet).toHaveLength(1);
      expect(varovani[0]).toMatch(/gpu: kontejner 'nekdo-aplikace' publikuje 443\/tcp/);
      expect(v.kod, `předlet '${predlet}': varování, ne fatální`).toBe(2);
    }
  }, 120_000);

  test("kontrola měřidla (mutace R1-e): úleva v předletu jen pro DRUH proxy (port na uzlu by předlet zastavil) → brána to vidí", () => {
    const vypis = "✗ port na uzlu: gpu: kontejner 'nekdo-aplikace' publikuje 443/tcp na 0.0.0.0 mimo loopback a mimo deklaraci\n";
    const zmutovana = mutace(funkce(DOKTOR, "vnejsi_expozice_verdikt"), '"✗ proxy na uzlu: "*|"✗ port na uzlu: "*)', '"✗ proxy na uzlu: "*)');
    expect(doktor(vypis, 1, "srovna").kod).toBe(2);
    expect(doktor(vypis, 1, "srovna", zmutovana).kod, "mutace R1-e musí být vidět").toBe(1);
  });

  test("⛔ úleva je JEN pro nálezy NA UZLU (proxy, port mimo deklaraci) — otevřený port zvenku, vystavené UDP podle pravidla i neplatná deklarace zůstávají FAIL i v předletu", () => {
    const jine = [
      "✗ gpu: TCP 80 OTEVŘENÝ na slotu s proxy 'none' — proxy serveru je pořád veřejná",
      "✗ gpu: UDP 443 publikuje aplikace x a firewall na uzlu je ve stavu MERENI (měřeno; deklarovaný režim enforce) — nezahazuje nic, port je vystavený",
      "✗ deklarace firewallu neplatná — firewall NENABĚHNE: x",
    ].join("\n");
    for (const predlet of PREDLETY) {
      const v = doktor(`${jine}\n`, 1, predlet);
      expect(v.fail, `předlet '${predlet}'`).toHaveLength(3);
      expect(v.kod).toBe(1);
    }
    // NEZMĚŘENO z uzlu (kotva chybí, docker neodpověděl) je varování, nikdy ok.
    for (const predlet of PREDLETY) {
      const nezmereno = doktor("? gpu: proxy na uzlu NEZMĚŘENA — ve výpisu (1 kontejnerů) chybí kotva\n", 2, predlet);
      expect(nezmereno.ok).toEqual([]);
      expect(nezmereno.warn).toHaveLength(1);
      expect(nezmereno.kod).toBe(2);
    }
  });

  test("kontrola měřidla (mutace): úleva i BEZ předletu → samostatný doktor by nález jen varoval, brána to vidí", () => {
    const vypis = "✗ proxy na uzlu: gpu: kontejner proxy serveru 'coolify-proxy' publikuje 80/tcp\n";
    const puvodni = funkce(DOKTOR, "vnejsi_expozice_verdikt");
    const zmutovana = mutace(puvodni, '          *) fail "Vnější expozice: ${radek#✗ }" ;;', '          *) warn "Vnější expozice: ${radek#✗ }" ;;');
    expect(doktor(vypis, 1, "").kod).toBe(1);
    expect(doktor(vypis, 1, "", zmutovana).kod, "mutace musí být vidět").toBe(2);
  });

  test("R3 (fáze V): kód sondy musí doložit řádek jeho druhu — 0 bez jediného řádku = NEZMĚŘENO, 1 bez `✗ ` = FAIL, 2/3 bez `? ` = NEZMĚŘENO; KOTVA: skutečný výstup s lane zavřenou (jen `· `, kód 0) → čisto, skutečný nález → právě jeden FAIL", async () => {
    // Lane firewallu = deklarace uzlu; bez ní se firewall nenasazuje (lane vrstvy na tom nic nemění).
    const bezLane = await fazeV(UZEL_S_PROXY, { ACCEL_FW_NODE_OWNER: "", ACCEL_FW_SSH: "" });
    expect(bezLane.kod, bezLane.vypis).toBe(0);
    expect(bezLane.vypis).toMatch(/^· firewall hostitele \(accel-hostfw\) se nenasazuje \(lane zavřená\)/m);
    expect(bezLane.vypis).not.toMatch(/^[✓✗?] /m);
    const nalez = await fazeV(UZEL_S_PROXY);
    expect(nalez.kod, nalez.vypis).toBe(1);
    for (const predlet of PREDLETY) {
      const kotva = doktor(bezLane.vypis, bezLane.kod, predlet);
      expect([...kotva.ok, ...kotva.warn, ...kotva.fail], `předlet '${predlet}': „není co měřit“ není ok ani varování\n${kotva.out}`).toEqual([]);
      expect(kotva.kod, kotva.out).toBe(0);

      const ticho = doktor("", 0, predlet);
      expect(ticho.ok).toEqual([]);
      expect(ticho.warn, `předlet '${predlet}'`).toEqual(["Vnější expozice NEZMĚŘENA — sonda skončila kódem 0 a nevypsala jediný řádek výsledku; ticho není shoda"]);
      expect(ticho.kod, "ticho není READY bez výhrad").toBe(2);

      const nalezBezRadku = doktor("· gpu: uzel 192.0.2.9\n", 1, predlet);
      expect(nalezBezRadku.fail, `předlet '${predlet}'`).toHaveLength(1);
      expect(nalezBezRadku.fail[0]).toMatch(/^Vnější expozice: sonda hlásí nález \(kód 1\), ale výpis žádný řádek nálezu nenese/);
      expect(nalezBezRadku.kod).toBe(1);

      for (const kod of [2, 3]) {
        const nezmerenoBezRadku = doktor("· gpu: uzel 192.0.2.9\n", kod, predlet);
        expect(nezmerenoBezRadku.warn, `kód ${kod}, předlet '${predlet}'`).toHaveLength(1);
        expect(nezmerenoBezRadku.warn[0]).toMatch(new RegExp(`^Vnější expozice NEZMĚŘENA \\(kód ${kod}\\), ale výpis neříká, co změřit nešlo`));
        expect(nezmerenoBezRadku.ok).toEqual([]);
      }
    }
    // Kotva nálezu: skutečný řádek `✗ ` dá právě JEDEN FAIL — doklad kódu nepřidá druhý.
    expect(doktor(nalez.vypis, nalez.kod, "").fail, nalez.vypis).toHaveLength(1);
  }, 120_000);

  test("P1 (fáze V): deklarovaný uzel s firewallem + skutečný výstup sondy jen „·“ + kód 0 → NEZMĚŘENO (varování, doktor ne čistě); KOTVA: bez deklarovaného uzlu týž výstup čistě", async () => {
    const bezLane = await fazeV(UZEL_S_PROXY, { ACCEL_FW_NODE_OWNER: "", ACCEL_FW_SSH: "" });
    expect(bezLane.kod, bezLane.vypis).toBe(0);
    for (const predlet of PREDLETY) {
      const ceka = doktor(bezLane.vypis, 0, predlet, undefined, "1");
      expect(ceka.warn, ceka.out).toEqual([expect.stringMatching(/^Vnější expozice NEZMĚŘENA — instance deklaruje uzel s firewallem, a sonda přesto vrátila kód 0 bez jediného měření/)]);
      expect(ceka.kod).toBe(2);
      const kotva = doktor(bezLane.vypis, 0, predlet, undefined, "0");
      expect([...kotva.ok, ...kotva.warn, ...kotva.fail]).toEqual([]);
      expect(kotva.kod).toBe(0);
    }
    // Skutečné měření s deklarovaným uzlem projde (kotva opačného směru).
    expect(doktor("✓ gpu: žádný kontejner proxy serveru\n", 0, "", undefined, "1").kod).toBe(0);
    const mutV = mutace(funkce(DOKTOR, "vnejsi_expozice_verdikt"), "           || warn \"Vnější expozice NEZMĚŘENA — instance deklaruje uzel s firewallem", "           || true \"Vnější expozice NEZMĚŘENA — instance deklaruje uzel s firewallem");
    expect(doktor(bezLane.vypis, 0, "", mutV, "1").kod, "mutace P1-b musí být vidět").toBe(0);
  }, 120_000);

  test("kontrola měřidla (mutace R3-d, R3-e, R3-f): ticho s kódem 0 / kód 1 bez řádku / `· ` nepočítaný jako doklad → brána to vidí", () => {
    const telo = funkce(DOKTOR, "vnejsi_expozice_verdikt");
    const tichoProjde = mutace(telo, "         [[ $((n_shoda + n_nalez + n_nezmereno + n_info)) -gt 0 ]]", "         [[ 1 -gt 0 ]]");
    expect(doktor("", 0, "").kod).toBe(2);
    expect(doktor("", 0, "", tichoProjde).kod, "mutace R3-d musí být vidět").toBe(0);
    const nalezProjde = mutace(telo, '1) [[ "$n_nalez" -gt 0 ]]', "1) [[ 1 -gt 0 ]]");
    expect(doktor("· x\n", 1, "").kod).toBe(1);
    expect(doktor("· x\n", 1, "", nalezProjde).kod, "mutace R3-e musí být vidět").toBe(0);
    const infoNeniDoklad = mutace(telo, '"· "*) info "${radek#· }"; n_info=$((n_info+1)) ;;', '"· "*) info "${radek#· }" ;;');
    const laneZavrena = "· firewall hostitele (accel-hostfw) se nenasazuje (lane zavřená) — žádný uzel k vnějšímu měření\n";
    expect(doktor(laneZavrena, 0, "").kod).toBe(0);
    expect(doktor(laneZavrena, 0, "", infoNeniDoklad).kod, "mutace R3-f musí být vidět").toBe(2);
  });

  test("zapojení: fáze V předává verdiktu výpis sondy, její kód a předlet", () => {
    expect(DOKTOR).toMatch(/_v_out="\$\(COOLIFY_URL="\$\{COOLIFY_URL:-\}" COOLIFY_API_TOKEN="\$_v_token" \\\n\s+node "\$REPO_ROOT\/scripts\/lib\/vnejsi-expozice\.mjs" [^\n]*2>&1\)" \|\| _v_rc=\$\?\n\s+vnejsi_expozice_verdikt "\$_v_out" "\$_v_rc" "\$PREDLET_COLD_STARTU" "\$\(uzel_s_firewallem_deklarovan\)"\n/);
    // Jediný přepínač záměru pro sdílený server — starý, který říkal jen „proxy se srovná“, už není.
    expect(DOKTOR).not.toMatch(/proxy-apply-planned|PROXY_APPLY_PLANNED/);
    expect(COLD_START).not.toMatch(/proxy-apply-planned|cs_proxy_srovna_tento_beh/);
  });
});

describe("T5: brána hotovosti cold-startu — NEZMĚŘENO a nález končí jako NEDOKONČENO", () => {
  const NEDOKONCENO_DEF = /^NEDOKONCENO=\(\)\nnedokonceno\(\) \{ .* \}$/m.exec(COLD_START)?.[0] ?? "";
  const SOUHRN = /^if \[ "\$\{#NEDOKONCENO\[@\]\}" -gt 0 \]; then\n[\s\S]*?\nfi\n/m.exec(COLD_START)?.[0] ?? "";

  /** Běh, který za sdílený server odpovídá (produkční, naostro), a běhy, které za něj neodpovídají. */
  const PRODUKCNI_BEH = { DRY_RUN: "0", AISHA_ENV: "production" };
  const BEHY_BEZ_ODPOVEDNOSTI = [
    { DRY_RUN: "0", AISHA_ENV: "staging" },
    { DRY_RUN: "0", AISHA_ENV: "pribeh-staging" },
    { DRY_RUN: "1", AISHA_ENV: "production" },
  ];

  /**
   * Skutečný verdikt kroku + skutečný závěrečný souhrn cold-startu; vrací kód
   * „běhu" a výpis. O tom, jestli běh za sdílený server odpovídá, rozhoduje
   * SKUTEČNÁ odpověď skriptu (cs_beh_odpovida_za_sdileny_server) nad režimem běhu.
   */
  function beh(jmeno: string, kod: number, telo = funkce(COLD_START, jmeno), rezim: { DRY_RUN: string; AISHA_ENV: string } = PRODUKCNI_BEH) {
    const skript = String.raw`
      set -uo pipefail
      . "$PROSTREDI_BEHU"
      ok() { printf 'OK %s\n' "$*"; }
      warn() { printf 'WARN %s\n' "$*"; }
      err() { printf 'ERR %s\n' "$*"; }
      eval "$NEDOKONCENO_DEF"
      eval "$JE_PROD"
      eval "$ODPOVIDA"
      eval "$FUNKCE"
      "$JMENO" "$KOD"
      eval "$SOUHRN"
      echo "BEH_BEZ_NEDOKONCENEHO"
    `;
    const r = spawnSync("bash", ["-c", skript], {
      encoding: "utf-8",
      env: {
        PATH: process.env.PATH ?? "",
        ...rezim,
        PROSTREDI_BEHU,
        NEDOKONCENO_DEF,
        SOUHRN,
        JE_PROD: funkceNaRadku(COLD_START, "cs_je_prod_env"),
        ODPOVIDA: funkceNaRadku(COLD_START, "cs_beh_odpovida_za_sdileny_server"),
        FUNKCE: telo,
        JMENO: jmeno,
        KOD: String(kod),
      },
    });
    return { kod: r.status, out: `${r.stdout}${r.stderr}` };
  }

  test("měřidlo: definice NEDOKONCENO a závěrečný souhrn (končí `exit 1`) jsou ve skriptu k vyříznutí", () => {
    expect(NEDOKONCENO_DEF).toMatch(/NEDOKONCENO\+=\("\$\*"\)/);
    expect(SOUHRN).toMatch(/COLD-START NEDOKONČEN/);
    expect(SOUHRN).toMatch(/\n\s*exit 1\nfi\n$/);
  });

  test("T5: produkční běh — kód 3 (NEZMĚŘENO) z nástroje proxy → krok 4c nedokončen a běh končí nenulou; KOTVA: kód 0 projde", () => {
    const kotva = beh("proxy_serveru_krok_verdikt", 0);
    expect(kotva.kod, kotva.out).toBe(0);
    expect(kotva.out).toMatch(/^OK Typ proxy serverů v API Coolify odpovídá deklaraci slotů/m);
    expect(kotva.out).toMatch(/^BEH_BEZ_NEDOKONCENEHO$/m);

    const r = beh("proxy_serveru_krok_verdikt", 3);
    expect(r.kod, r.out).toBe(1);
    expect(r.out).toMatch(/^ERR Krok 4c: proxy serveru NEZMĚŘENA/m);
    expect(r.out).toMatch(/COLD-START NEDOKONČEN — 1 bodů/);
    expect(r.out).not.toMatch(/^OK /m);
    expect(r.out).not.toMatch(/^WARN /m);
    expect(r.out).not.toMatch(/BEH_BEZ_NEDOKONCENEHO/);
    // Rozdíl, který běh nesrovnal, i chyba nástroje jsou totéž: nedokončeno.
    for (const kod of [1, 2, 9]) expect(beh("proxy_serveru_krok_verdikt", kod).kod, `kód ${kod}`).toBe(1);
    expect(beh("proxy_serveru_krok_verdikt", 2).out).toMatch(/^ERR Krok 4c: proxy serveru se liší od deklarace slotu a tenhle běh ji nenastavil/m);
  });

  test("T5: běh, který za sdílený server neodpovídá (ne-produkční, dry-run) — rozdíl i NEZMĚŘENO v kroku 4c jsou hlasité VAROVÁNÍ, běh kvůli nim červeně nekončí a nikdy to není ok; KOTVA: v produkčním běhu tytéž kódy končí nedokončeně", () => {
    for (const rezim of BEHY_BEZ_ODPOVEDNOSTI) {
      for (const [kod, co] of [[2, "se liší od deklarace slotu"], [3, "NEZMĚŘENA"]] as const) {
        const popis = `${JSON.stringify(rezim)} kód ${kod}`;
        const r = beh("proxy_serveru_krok_verdikt", kod, undefined, rezim);
        expect(r.kod, popis + r.out).toBe(0);
        const varovani = r.out.split("\n").filter((x) => x.startsWith("WARN "));
        expect(varovani, popis).toHaveLength(1);
        expect(varovani[0], popis).toBe(`WARN Krok 4c: proxy serveru ${co} (výpis výš) — sdílený server tenhle běh nemění; srovná ho produkční běh`);
        expect(r.out, `${popis}: varování se nesmí tvářit jako shoda`).not.toMatch(/^OK /m);
        expect(r.out, popis).not.toMatch(/^ERR /m);
        expect(r.out, popis).not.toMatch(/COLD-START NEDOKONČEN/);
        expect(r.out, popis).toMatch(/^BEH_BEZ_NEDOKONCENEHO$/m);
        // KOTVA: tentýž kód v běhu, který za server odpovídá, běh ukončí červeně a varováním není.
        const prod = beh("proxy_serveru_krok_verdikt", kod, undefined, PRODUKCNI_BEH);
        expect(prod.kod, `produkční běh, kód ${kod}`).toBe(1);
        expect(prod.out).toMatch(/^ERR Krok 4c: proxy serveru /m);
        expect(prod.out).not.toMatch(/^WARN /m);
      }
      // Úleva platí JEN pro stav sdíleného serveru: chyba nástroje je nedokončeno i tady, shoda je ok i tady.
      for (const kod of [1, 9]) {
        const chyba = beh("proxy_serveru_krok_verdikt", kod, undefined, rezim);
        expect(chyba.kod, `${JSON.stringify(rezim)} kód ${kod}`).toBe(1);
        expect(chyba.out).toMatch(/^ERR Krok 4c: proxy serveru — chyba deklarace, čtení nebo zápisu/m);
      }
      const shoda = beh("proxy_serveru_krok_verdikt", 0, undefined, rezim);
      expect(shoda.kod).toBe(0);
      expect(shoda.out).toMatch(/^OK Typ proxy serverů v API Coolify odpovídá deklaraci slotů/m);
      expect(shoda.out).not.toMatch(/^WARN /m);
    }
  });

  test("kontrola měřidla (mutace kroku 4c): ne-produkční běh končí nedokončeně / varování hlášené jako ok / úleva i produkčnímu běhu → brána to vidí", () => {
    const skutecny = funkce(COLD_START, "proxy_serveru_krok_verdikt");
    const [neprodukcni] = BEHY_BEZ_ODPOVEDNOSTI;
    // (a) „ne-produkční běh končí nedokončeně": větev bez odpovědnosti zapisuje do NEDOKONCENO.
    for (const [kod, varovani] of [[2, 'warn "Krok 4c: proxy serveru se liší od deklarace slotu (výpis výš)'], [3, 'warn "Krok 4c: proxy serveru NEZMĚŘENA (výpis výš)']] as const) {
      const mutant = mutace(skutecny, varovani, varovani.replace(/^warn /, "nedokonceno "));
      expect(beh("proxy_serveru_krok_verdikt", kod, skutecny, neprodukcni).kod).toBe(0);
      expect(beh("proxy_serveru_krok_verdikt", kod, mutant, neprodukcni).kod, `mutace „ne-produkční běh končí nedokončeně" (kód ${kod}) musí být vidět`).toBe(1);
      // (b) kód 3 nikdy ok: varování přepsané na `ok` je vidět ve výpisu.
      const jakoOk = mutace(skutecny, varovani, varovani.replace(/^warn /, "ok "));
      expect(beh("proxy_serveru_krok_verdikt", kod, jakoOk, neprodukcni).out, `mutace „varování jako ok" (kód ${kod}) musí být vidět`).toMatch(/^OK Krok 4c/m);
      expect(beh("proxy_serveru_krok_verdikt", kod, skutecny, neprodukcni).out).not.toMatch(/^OK /m);
    }
    // (c) úleva i běhu, který za server odpovídá: obrácená podmínka → produkční běh by skončil nulou.
    const obracene = skutecny.split("if cs_beh_odpovida_za_sdileny_server; then").join("if ! cs_beh_odpovida_za_sdileny_server; then");
    expect(obracene).not.toBe(skutecny);
    expect(beh("proxy_serveru_krok_verdikt", 3, skutecny, PRODUKCNI_BEH).kod).toBe(1);
    expect(beh("proxy_serveru_krok_verdikt", 3, obracene, PRODUKCNI_BEH).kod, "mutace „úleva i produkčnímu běhu\" musí být vidět").toBe(0);
  });

  test("T5: nález i NEZMĚŘENO z kontroly kontejnerů na uzlu (T4) → nedokončeno; KOTVA: kód 0 projde", () => {
    const kotva = beh("kontejnery_uzlu_krok_verdikt", 0);
    expect(kotva.kod, kotva.out).toBe(0);
    expect(kotva.out).toMatch(/^OK Proxy na uzlech s firewallem hostitele/m);

    const nalez = beh("kontejnery_uzlu_krok_verdikt", 1);
    expect(nalez.kod, nalez.out).toBe(1);
    expect(nalez.out).toMatch(/^ERR Proxy na uzlu: kontejner PUBLIKUJE port mimo loopback a deklaraci uzlu \(výpis výš — proxy serveru, nebo jiný\)/m);
    expect(nalez.out, "hláška říká, že typ v API nestačí a že běh nezastavuje").toMatch(/typ 'none' v API Coolify proxy nezastaví a firewall nález jen zakryje; zastavení kontejneru je rozhodnutí majitele/);
    for (const kod of [2, 3]) {
      const r = beh("kontejnery_uzlu_krok_verdikt", kod);
      expect(r.kod, `kód ${kod}`).toBe(1);
      expect(r.out).toMatch(/^ERR Proxy na uzlu NEZMĚŘENA/m);
      expect(r.out).not.toMatch(/^OK /m);
    }
    expect(beh("kontejnery_uzlu_krok_verdikt", 127).kod, "selhání nástroje není ok").toBe(1);
  });

  test("kontrola měřidla (mutace F1-h): kód 3 počítaný jako splněno → běh by skončil nulou, brána to vidí", () => {
    const proxy = mutace(funkce(COLD_START, "proxy_serveru_krok_verdikt"), 'nedokonceno "Krok 4c: proxy serveru NEZMĚŘENA', 'ok "Krok 4c: proxy serveru NEZMĚŘENA');
    expect(beh("proxy_serveru_krok_verdikt", 3).kod).toBe(1);
    expect(beh("proxy_serveru_krok_verdikt", 3, proxy).kod, "mutace F1-h (krok 4c) musí být vidět").toBe(0);
    const uzel = mutace(funkce(COLD_START, "kontejnery_uzlu_krok_verdikt"), '2|3) nedokonceno "Proxy na uzlu NEZMĚŘENA', '2|3) ok "Proxy na uzlu NEZMĚŘENA');
    expect(beh("kontejnery_uzlu_krok_verdikt", 2).kod).toBe(1);
    expect(beh("kontejnery_uzlu_krok_verdikt", 2, uzel).kod, "mutace F1-h (kontrola uzlu) musí být vidět").toBe(0);
  });

  test("doktor: kód 3 z fáze F není READY bez výhrad — v předletu varování, samostatně FAIL (kotva: kód 0 varování ani FAIL nedá)", () => {
    expect(verdiktDoktoru("? gpu: NEMĚŘENO — odpověď nemá pole proxy.type\n", 3, "srovna").warn).toHaveLength(1);
    expect(verdiktDoktoru("? gpu: NEMĚŘENO — odpověď nemá pole proxy.type\n", 3, "").fail).toHaveLength(1);
    const kotva = verdiktDoktoru("✓ gpu: typ proxy v API 'NONE' = deklarace\n", 0, "srovna");
    expect(kotva.warn).toEqual([]);
    expect(kotva.fail).toEqual([]);
  });

  /**
   * SKUTEČNÉ závěrečné ověření cold-startu (`overeni_proxy_na_uzlu`) se skutečným
   * nástrojem nad falešným `docker`, pak skutečný souhrn — kód „běhu".
   */
  function zaverecneOvereni(kontejnery: string[], rezim: { DRY_RUN: string; SKIP_DEPLOY: string; AISHA_ENV: string }, extra: Record<string, string> = {}) {
    const { env, log } = prostrediSDockerem(kontejnery, extra);
    const skript = String.raw`
      set -uo pipefail
      . "$PROSTREDI_BEHU"
      ok() { printf 'OK %s\n' "$*"; }
      info() { printf 'INFO %s\n' "$*"; }
      err() { printf 'ERR %s\n' "$*"; }
      eval "$NEDOKONCENO_DEF"
      eval "$JE_PROD"
      eval "$ODPOVIDA"
      eval "$VERDIKT"
      eval "$OVERENI"
      overeni_proxy_na_uzlu
      eval "$SOUHRN"
      echo "BEH_BEZ_NEDOKONCENEHO"
    `;
    const r = spawnSync("bash", ["-c", skript], {
      encoding: "utf-8",
      timeout: 120_000,
      env: {
        ...env,
        ...rezim,
        REPO_ROOT: ROOT,
        PROSTREDI_BEHU,
        NEDOKONCENO_DEF,
        SOUHRN,
        JE_PROD: funkceNaRadku(COLD_START, "cs_je_prod_env"),
        ODPOVIDA: funkceNaRadku(COLD_START, "cs_beh_odpovida_za_sdileny_server"),
        VERDIKT: funkce(COLD_START, "kontejnery_uzlu_krok_verdikt"),
        OVERENI: funkce(COLD_START, "overeni_proxy_na_uzlu"),
      },
    });
    return { kod: r.status, out: `${r.stdout}${r.stderr}`, volaniDockeru: readFileSync(log, "utf-8").split("\n").filter(Boolean) };
  }
  const PROD_SE_SKIP_DEPLOY = { DRY_RUN: "0", SKIP_DEPLOY: "1", AISHA_ENV: "production" };

  test("T5: produkční běh se `--skip-deploy` a proxy s porty → závěrečné ověření zapíše NEDOKONČENO a běh končí nenulou; KOTVA: uzel bez proxy → ok", () => {
    const kotva = zaverecneOvereni(UZEL_BEZ_PROXY, PROD_SE_SKIP_DEPLOY);
    expect(kotva.kod, kotva.out).toBe(0);
    expect(kotva.out).toMatch(/^✓ gpu: žádný kontejner proxy serveru/m);
    expect(kotva.out).toMatch(/^OK Proxy na uzlech s firewallem hostitele/m);
    expect(kotva.out).toMatch(/^BEH_BEZ_NEDOKONCENEHO$/m);
    expect(kotva.volaniDockeru.map((v) => v.split(" ")[2]), "měří se jen čtením").toEqual(["ps", "inspect"]);

    const r = zaverecneOvereni(UZEL_S_PROXY, PROD_SE_SKIP_DEPLOY);
    expect(r.kod, r.out).toBe(1);
    expect(r.out).toMatch(/^✗ proxy na uzlu: gpu: kontejner proxy serveru 'coolify-proxy' publikuje/m);
    expect(r.out).toMatch(/^ERR Proxy na uzlu: kontejner PUBLIKUJE port mimo loopback a deklaraci uzlu/m);
    expect(r.out).toMatch(/COLD-START NEDOKONČEN — 1 bodů/);
    expect(r.out).not.toMatch(/BEH_BEZ_NEDOKONCENEHO/);
    // S nasazením totéž — ověření na `--skip-deploy` nezávisí.
    expect(zaverecneOvereni(UZEL_S_PROXY, { ...PROD_SE_SKIP_DEPLOY, SKIP_DEPLOY: "0" }).kod).toBe(1);
  }, 120_000);

  test("R1 (T5): JINÝ kontejner s portem mimo loopback a deklaraci → závěrečné ověření zapíše NEDOKONČENO; KOTVA: tentýž kontejner na loopbacku → ok", () => {
    const kotva = zaverecneOvereni(UZEL_S_PORTEM_NA_LOOPBACKU, PROD_SE_SKIP_DEPLOY);
    expect(kotva.kod, kotva.out).toBe(0);
    expect(kotva.out).toMatch(/^OK Proxy na uzlech s firewallem hostitele/m);
    const r = zaverecneOvereni(UZEL_S_PORTEM, PROD_SE_SKIP_DEPLOY);
    expect(r.kod, r.out).toBe(1);
    expect(r.out).toMatch(/^✗ port na uzlu: gpu: kontejner 'nekdo-aplikace' publikuje 443\/tcp/m);
    expect(r.out).toMatch(/COLD-START NEDOKONČEN — 1 bodů/);
  }, 120_000);

  test("⛔ T5: docker neodpoví (NEZMĚŘENO) → nedokončeno, ne ok; dry-run a ne-produkční běh NEMĚŘÍ, řeknou to a docker nevolají", () => {
    const nezmereno = zaverecneOvereni(UZEL_BEZ_PROXY, PROD_SE_SKIP_DEPLOY, { FALESNY_DOCKER_PS_RC: "255" });
    expect(nezmereno.kod, nezmereno.out).toBe(1);
    expect(nezmereno.out).toMatch(/^ERR Proxy na uzlu NEZMĚŘENA/m);
    expect(nezmereno.out).not.toMatch(/^OK /m);

    for (const rezim of [
      { DRY_RUN: "1", SKIP_DEPLOY: "0", AISHA_ENV: "production" },
      { DRY_RUN: "0", SKIP_DEPLOY: "0", AISHA_ENV: "staging" },
      { DRY_RUN: "0", SKIP_DEPLOY: "1", AISHA_ENV: "pribeh-staging" },
    ]) {
      const r = zaverecneOvereni(UZEL_S_PROXY, rezim);
      expect(r.kod, JSON.stringify(rezim) + r.out).toBe(0);
      expect(r.out).toMatch(/^INFO Proxy na uzlech s firewallem hostitele se v tomhle běhu NEMĚŘÍ/m);
      expect(r.out, "kdo neměřil, nesmí hlásit ok").not.toMatch(/^OK /m);
      expect(r.volaniDockeru).toEqual([]);
    }
  }, 120_000);

  test("zapojení: krok 4c volá verdikt s kódem čteným hned; závěrečné ověření uzlu stojí na nejvyšší úrovni ZA vlnami, mimo podmínku nasazení, před souhrnem", () => {
    // Krok 4c: kód nástroje do proměnné hned (ne za rourou) a rovnou verdiktu.
    expect(COLD_START).toMatch(
      /\n_px_rc=0\nnode "\$REPO_ROOT\/scripts\/coolify-server-proxy\.mjs" \$\{_px_args\[@\]\+"\$\{_px_args\[@\]\}"\} \|\| _px_rc=\$\?\nproxy_serveru_krok_verdikt "\$_px_rc"\n/,
    );
    // Verdikt kroku 4c: o nedokončeno × varování rozhoduje táž jediná odpověď — žádná vlastní kopie podmínky.
    const verdikt4c = funkce(COLD_START, "proxy_serveru_krok_verdikt");
    expect(verdikt4c.split("if cs_beh_odpovida_za_sdileny_server; then").length - 1, "větve 2 a 3 se ptají jediné odpovědi").toBe(2);
    expect(verdikt4c, "verdikt nesmí nést vlastní podmínku režimu běhu").not.toMatch(/DRY_RUN|AISHA_ENV|cs_je_prod_env/);
    // Ověření uzlu: kód nástroje do proměnné hned a rovnou verdiktu; o tom, KDO měří, rozhoduje jediná odpověď.
    const overeni = funkce(COLD_START, "overeni_proxy_na_uzlu");
    expect(overeni).toMatch(/\n {2}if ! cs_beh_odpovida_za_sdileny_server; then\n/);
    expect(overeni).toMatch(/\(cd "\$REPO_ROOT" && node scripts\/lib\/kontejnery-uzlu\.mjs [^\n]*<\/dev\/null\) \|\| _ku_rc=\$\?\n {2}kontejnery_uzlu_krok_verdikt "\$_ku_rc"\n/);
    expect(overeni, "ověření nesmí záviset na nasazení").not.toMatch(/SKIP_DEPLOY/);
    expect(COLD_START.split("&& node scripts/lib/kontejnery-uzlu.mjs").length - 1, "nástroj má v cold-startu jediné volání").toBe(1);

    // Volání: právě jedno, na nejvyšší úrovni (neodsazené), za posledním spuštěním vln, před souhrnem…
    const volani = [...COLD_START.matchAll(/^overeni_proxy_na_uzlu$/gm)];
    expect(volani, "závěrečné ověření uzlu se nevolá právě jednou na nejvyšší úrovni").toHaveLength(1);
    const iVolani = volani[0].index!;
    expect(iVolani).toBeGreaterThan(COLD_START.lastIndexOf("node scripts/aisha-redeploy.mjs"));
    expect(iVolani).toBeLessThan(COLD_START.indexOf(SOUHRN));
    expect(SOUHRN.length).toBeGreaterThan(0);
    // …a ZA koncem bloku, který se při `--skip-deploy` přeskakuje (blok je mezi svým `if` a voláním uzavřený).
    const iBlok = COLD_START.lastIndexOf('if [ "$SKIP_DEPLOY" != "1" ] && [ "$DRY_RUN" != "1" ]; then', iVolani);
    expect(iBlok).toBeGreaterThan(-1);
    expect(COLD_START.slice(iBlok, iVolani), "ověření uzlu zůstalo uvnitř bloku nasazení").toMatch(/\nfi\n/);
  });
});
