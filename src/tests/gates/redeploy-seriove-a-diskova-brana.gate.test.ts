/**
 * Brána: redeploy nasazuje SÉRIOVĚ a za DISKOVOU BRÁNOU
 *
 * ⛔ NAMĚŘENO 2026-09-24 (fork, sdílený hostitel pěti nájemníků). Fáze D
 * cold-startu přenasadila osm stacků NAJEDNOU — `REDEPLOY=1` v netbird-bootstrap
 * i `Promise.all` uvnitř vlny aisha-redeploy. Obrazy se souběžně stahovaly
 * a stavěly, disk uzlu došel (ENOSPC, 100 %) a kaskáda shodila i to, co předtím
 * běželo. Volné místo šlo změřit předem; nikdo se nezeptal.
 *
 * Tvrzení (každé má měřidlo, které umí zčervenat):
 *   1. deploy_concurrency=1 ⇒ server mock Coolify NIKDY nevidí víc než jedno
 *      rozběhnuté nasazení (místo se uvolní až doběhnutím, ne triggerem);
 *      mutace „uvolni při triggeru" ⇒ server vidí souběh.
 *   2. nízké místo ⇒ aisha-redeploy skončí ≠ 0 a mock nedostane ani jeden
 *      POST /deploy.
 *   3. neplatné deploy_concurrency v profilu ⇒ chyba, žádné nasazení.
 *   4. netbird-bootstrap nepřenasazuje přes `REDEPLOY=1`, ale přes
 *      aisha-redeploy; mutace (vrácený REDEPLOY=1) ⇒ detektor ho najde.
 *   5. všechny cesty k triggeru v aisha-redeploy jdou jedněmi dveřmi.
 *
 * Spouští se přes: npm run test:gates
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import http from "node:http";
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spustSOmezenim, pockejNaDobehnuti } from "../../../scripts/lib/nasazeni-s-omezenim.mjs";
import {
  REZERVA_B,
  bajty,
  nactiMapuUzlu,
  parsujMereni,
  prikazMereni,
  vytvorDiskovouBranu,
} from "../../../scripts/lib/diskova-brana.mjs";

const ROOT = process.cwd();
const GIB = 1024 ** 3;

// ── Mock Coolify: nasazení doběhne po N dotazech na svůj stav ────────────────
// Deterministické (žádné časovače): „čas" nasazení se měří počtem dotazů.
type Nasazeni = { zbyva: number; hotovo: boolean };
const DOTAZU_DO_DOBEHNUTI = 3;
let server: http.Server;
let base = "";
let nasazeni = new Map<string, Nasazeni>();
let postu = 0;
let maxVLetu = 0;
const vLetu = () => [...nasazeni.values()].filter((n) => !n.hotovo).length;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "";
    const json = (o: unknown, s = 200) => {
      res.writeHead(s, { "content-type": "application/json" });
      res.end(JSON.stringify(o));
    };
    if (req.method === "POST" && url.startsWith("/api/v1/deploy?")) {
      postu++;
      const id = `dep-${postu}`;
      nasazeni.set(id, { zbyva: DOTAZU_DO_DOBEHNUTI, hotovo: false });
      maxVLetu = Math.max(maxVLetu, vLetu());
      return json({ deployments: [{ deployment_uuid: id }] });
    }
    const m = url.match(/^\/api\/v1\/deployments\/(dep-\d+)$/);
    if (req.method === "GET" && m) {
      const n = nasazeni.get(m[1]);
      if (!n) return json({ message: "not found" }, 404);
      if (!n.hotovo && --n.zbyva <= 0) n.hotovo = true;
      return json({ status: n.hotovo ? "finished" : "in_progress" });
    }
    json({ message: "not found" }, 404);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const adresa = server.address();
  base = `http://127.0.0.1:${typeof adresa === "object" && adresa ? adresa.port : 0}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

function vynuluj() {
  nasazeni = new Map();
  postu = 0;
  maxVLetu = 0;
}

async function spust(jmeno: string) {
  const r = await fetch(`${base}/api/v1/deploy?uuid=${jmeno}&force=true`, { method: "POST" });
  const j = (await r.json()) as { deployments: { deployment_uuid: string }[] };
  return { ok: true, deployment: j.deployments[0].deployment_uuid };
}

const ctiStav = async (id: string) => {
  const r = await fetch(`${base}/api/v1/deployments/${id}`);
  return ((await r.json()) as { status: string }).status;
};

const dobehni = (_jmeno: string, r: { deployment: string }) =>
  pockejNaDobehnuti(r.deployment, { ctiStav, intervalMs: 0, limitMs: 10_000, spanek: async () => {} });

type Modul = typeof import("../../../scripts/lib/nasazeni-s-omezenim.mjs");

/** Kopie modulu s pozměněným zdrojem — mutace musí padnout na TÉMŽE měřidle. */
async function mutovanyModul(z: string, na: string): Promise<Modul> {
  const zdroj = readFileSync(join(ROOT, "scripts/lib/nasazeni-s-omezenim.mjs"), "utf8");
  expect(zdroj.includes(z), `mutace se nemá čeho chytit: ${z}`).toBe(true);
  const dir = mkdtempSync(join(tmpdir(), "mutace-omezeni-"));
  const cesta = join(dir, "nasazeni-s-omezenim.mjs");
  writeFileSync(cesta, zdroj.replace(z, na));
  return import(pathToFileURL(cesta).href);
}

describe("sériově = místo drží nasazení až do doběhnutí (mock Coolify)", () => {
  test("deploy_concurrency=1 ⇒ server nikdy nevidí víc než jedno rozběhnuté nasazení", async () => {
    vynuluj();
    const { vysledky, zastaveni } = await spustSOmezenim(["a", "b", "c", "d"], { soubeznost: 1, spust, dobehni });
    expect(zastaveni).toBeNull();
    expect(postu).toBe(4);
    expect(maxVLetu).toBe(1);
    expect(vysledky.map((v) => v.dobehlo)).toEqual(["finished", "finished", "finished", "finished"]);
  });

  test("limit je limit, ne náhodná serializace: souběžnost 3 ⇒ víc než 1, nejvýš 3", async () => {
    vynuluj();
    await spustSOmezenim(["a", "b", "c", "d", "e"], { soubeznost: 3, spust, dobehni });
    expect(postu).toBe(5);
    expect(maxVLetu).toBeGreaterThan(1);
    expect(maxVLetu).toBeLessThanOrEqual(3);
  });

  test("MUTACE: místo uvolněné triggerem (bez čekání na doběhnutí) ⇒ server vidí souběh", async () => {
    const m = await mutovanyModul(
      "const d = await dobehni(jmeno, r);",
      'const d = { dobehlo: true, stav: "mutace" };',
    );
    vynuluj();
    await m.spustSOmezenim(["a", "b", "c", "d"], { soubeznost: 1, spust, dobehni });
    expect(maxVLetu, "měřidlo souběhu je slepé — mutace ho neshodila").toBeGreaterThan(1);
  });

  test("nasazení, které nedoběhne, zastaví běh — další trigger by porušil limit", async () => {
    vynuluj();
    const { vysledky, zastaveni } = await spustSOmezenim(["a", "b", "c"], {
      soubeznost: 1,
      spust,
      dobehni: async () => ({ dobehlo: false, duvod: "strop vypršel" }),
    });
    expect(postu).toBe(1);
    expect(zastaveni?.druh).toBe("nedobehlo");
    expect(vysledky.slice(1).every((v) => v.zastaveno)).toBe(true);
  });

  test("brána před spuštěním zastaví běh: 0× POST pro zastavené i všechny další", async () => {
    vynuluj();
    const { vysledky, zastaveni } = await spustSOmezenim(["a", "b", "c"], {
      soubeznost: 1,
      predSpustenim: async (n: string) => (n === "b" ? { ok: false, duvod: "málo místa" } : { ok: true }),
      spust,
      dobehni,
    });
    expect(postu).toBe(1);
    expect(zastaveni).toMatchObject({ jmeno: "b", druh: "brana" });
    expect(vysledky.map((v) => Boolean(v.zastaveno))).toEqual([false, true, true]);
  });

  test("souběžnost mimo celá čísla ≥ 1 je chyba, ne tichá jednička", async () => {
    for (const spatne of [0, -1, 1.5, "2" as unknown as number]) {
      await expect(spustSOmezenim(["a"], { soubeznost: spatne, spust, dobehni })).rejects.toThrow(/souběžnost/);
    }
  });
});

// ── Disková brána (knihovna) ─────────────────────────────────────────────────
const UUID_A = "fixtureappaaaa01";
const UUID_B = "fixtureappbbbb02";

function vystupMereni(volnoKb: number, obrazy: [string, string, string][], chybi: [string, string][] = []) {
  // obrazy: [projekt, krátké ID, unikátní velikost jak ji tiskne docker]
  // chybi: [projekt, obraz, který stack deklaruje, ale na uzlu není]
  const radkyObrazu = [
    ...obrazy.map(([p, id]) => `OBRAZ ${p} sha256:${id}${"0".repeat(52)}`),
    ...chybi.map(([p, obraz]) => `CHYBI ${p} ${obraz}`),
  ];
  const tabulka = obrazy.map(
    ([, id, u]) => `fixture/img  latest    ${id}   2 weeks ago   9.9GB     1.1GB         ${u.padEnd(14)}1`,
  );
  return [
    `VOLNO_KB ${volnoKb}`,
    ...radkyObrazu,
    "DF_V",
    "Images space usage:",
    "",
    "REPOSITORY   TAG       IMAGE ID       CREATED       SIZE      SHARED SIZE   UNIQUE SIZE   CONTAINERS",
    ...tabulka,
    "",
    "Containers space usage:",
  ].join("\n");
}

describe("disková brána — měří uzel, kam nasazení poběží", () => {
  test("vzdálený příkaz jen ČTE (i s obrazy a stavbami z compose)", () => {
    const prikaz = prikazMereni(
      [UUID_A, UUID_B],
      new Map([[UUID_A, ["pgvector/pgvector:pg17"]]]),
      new Map([[UUID_A, ["ragnarok"]]]),
    );
    for (const zakazane of [/\brm\b/, /\bprune\b/, /\brmi\b/, /\bkill\b/, /\bstop\b/, /\brestart\b/, /\bpull\b/, /\bbuild\b/, /\brun\b/, /\bexec\b/, /[^2]>/, /\btee\b/]) {
      expect(prikaz, `vzdálený příkaz obsahuje ${zakazane}`).not.toMatch(zakazane);
    }
  });

  test("stack bez kontejnerů (po selhaném nasazení) se měří obrazy, které pro něj postavil Coolify", () => {
    const prikaz = prikazMereni([UUID_A]);
    // Kontejnery mají přednost; bez nich obrazy `<uuid>_<služba>` — jinak by brána
    // u znovu nasazovaného stacku viděla jen rezervu.
    expect(prikaz).toMatch(/if \[ -n "\$c" \]; then .*docker inspect/);
    expect(prikaz).toContain(`docker image ls -q --no-trunc --filter "reference=${UUID_A}_*"`);
    // Výstup fallbacku (plný digest `sha256:…`) projde týmž parserem jako obraz kontejneru.
    const { potreba } = parsujMereni(vystupMereni(5 * 1024 * 1024, [[UUID_A, "aaaaaaaaaaaa", "2.9GB"]]), [UUID_A]);
    expect(potreba.get(UUID_A)).toBe(2.9e9);
  });

  test("stack bez kontejnerů měří i obrazy, které si STÁHNE (`image:` z compose); chybějící vypíše", () => {
    const prikaz = prikazMereni([UUID_A], new Map([[UUID_A, ["pgvector/pgvector:pg17", "library/redis:7-alpine"]]]));
    for (const ref of ["pgvector/pgvector:pg17", "library/redis:7-alpine"]) {
      expect(prikaz).toContain(`docker image inspect -f "OBRAZ ${UUID_A} {{.Id}}" '${ref}' 2>/dev/null || echo "CHYBI ${UUID_A} ${ref}"`);
    }
  });

  test("stack bez kontejnerů: služba se `build:` bez obrazu `<uuid>_<služba>` se vypíše jako chybějící", () => {
    const prikaz = prikazMereni([UUID_A], new Map(), new Map([[UUID_A, ["ragnarok", "maestro"]]]));
    for (const s of ["ragnarok", "maestro"]) {
      expect(prikaz).toContain(
        `[ -n "$(docker image ls -q --filter "reference=${UUID_A}_${s}")" ] || echo "CHYBI ${UUID_A} ${UUID_A}_${s}"`,
      );
    }
    // Kontrola chybějících patří jen do větve BEZ kontejnerů — běžící stack se měří kontejnery.
    const [sKontejnery, bezKontejneru] = prikaz.split("; else ");
    expect(sKontejnery).not.toContain("CHYBI");
    expect(bezKontejneru).toContain("CHYBI");
  });

  test("uuid, reference i jméno služby se do vzdáleného příkazu dostanou jen v bezpečném tvaru", () => {
    expect(() => prikazMereni(["abc; reboot"])).toThrow(/tvar/);
    expect(() => prikazMereni([UUID_A], new Map([[UUID_A, ["nginx'; reboot"]]]))).toThrow(/bezpečný tvar/);
    expect(() => prikazMereni([UUID_A], new Map(), new Map([[UUID_A, ["$(id)"]]]))).toThrow(/bezpečný tvar/);
  });

  test("chybějící obrazy parser sečte po projektech (duplicitní řádek jednou)", () => {
    const text = vystupMereni(
      5 * 1024 * 1024,
      [[UUID_A, "aaaaaaaaaaaa", "1GB"]],
      [
        [UUID_A, `${UUID_A}_ragnarok`],
        [UUID_A, `${UUID_A}_ragnarok`],
        [UUID_B, "library/redis:7-alpine"],
      ],
    );
    const { chybi, nalezeno } = parsujMereni(text, [UUID_A, UUID_B]);
    expect(chybi.get(UUID_A)).toEqual([`${UUID_A}_ragnarok`]);
    expect(chybi.get(UUID_B)).toEqual(["library/redis:7-alpine"]);
    expect(nalezeno.get(UUID_A)).toBe(1);
  });

  test("potřeba = UNIKÁTNÍ velikost obrazů stacku; dva kontejnery téhož obrazu = jeden obraz", () => {
    const text = vystupMereni(5 * 1024 * 1024, [
      [UUID_A, "aaaaaaaaaaaa", "2.1GB"],
      [UUID_A, "aaaaaaaaaaaa", "2.1GB"],
      [UUID_A, "cccccccccccc", "500MB"],
    ]);
    const { volnoB, potreba } = parsujMereni(text, [UUID_A]);
    expect(volnoB).toBe(5 * GIB);
    expect(potreba.get(UUID_A)).toBe(2.1e9 + 5e8);
  });

  test("velikosti tak, jak je tiskne docker", () => {
    expect(bajty("0B")).toBe(0);
    expect(bajty("187MB")).toBe(187e6);
    expect(bajty("1.23GB")).toBe(1.23e9);
    expect(bajty("12.5kB")).toBe(12500);
    expect(bajty("-1.141e+08B")).toBe(-1.141e8);
    expect(bajty("N/A")).toBeNull();
  });

  test("záporná UNIQUE z containerd snapshotteru ⇒ SIZE (horní odhad), ne vynechaný obraz a falešný STOP", () => {
    // Skutečný řádek z hostitele forku (Docker 29.7.2), 2026-09-25.
    const text = [
      "VOLNO_KB 19000000",
      `OBRAZ ${UUID_A} sha256:2617f33e5550ab2df14aa1408bf0c4ae75d589182dd44f20e1140ac6011d2f9e`,
      "DF_V",
      "REPOSITORY                                      TAG                                        IMAGE ID       CREATED         SIZE      SHARED SIZE   UNIQUE SIZE   CONTAINERS",
      "fixture_aisha-kronos-shim                       eefcb0a89275d72386145b24e674b99eb6aa70d3   2617f33e5550   18 hours ago    123MB     237.5MB       -1.141e+08B   0",
      "",
    ].join("\n");
    const { potreba, nalezeno } = parsujMereni(text, [UUID_A]);
    expect(nalezeno.get(UUID_A)).toBe(1);
    expect(potreba.get(UUID_A)).toBe(123e6);
  });

  const brana = (text: string | Error, mapa = "uzel-a=fixture@stub", uzly: Record<string, string> = {}) =>
    vytvorDiskovouBranu({
      mapaUzlu: nactiMapuUzlu(mapa),
      uzelAplikace: (n: string) => uzly[n] ?? "uzel-a",
      uuidAplikace: (n: string) => ({ a: UUID_A, b: UUID_B })[n] ?? null,
      ssh: async () => {
        if (text instanceof Error) throw text;
        return text;
      },
    });

  test("málo místa ⇒ STOP s čísly", async () => {
    const v = await brana(vystupMereni(1024 * 1024, [[UUID_A, "aaaaaaaaaaaa", "2.1GB"]]))("a", { vLetu: [] });
    expect(v.ok).toBe(false);
    expect(v.duvod).toMatch(/volno 1\.0 GiB < potřeba/);
    expect(v.duvod).toMatch(/STOP/);
  });

  test("dost místa ⇒ projde a vrátí čísla (brána umí i zezelenat)", async () => {
    const v = await brana(vystupMereni(20 * 1024 * 1024, [[UUID_A, "aaaaaaaaaaaa", "2.1GB"]]))("a", { vLetu: [] });
    expect(v.ok).toBe(true);
    expect(v.cisla?.potrebaB).toBe(2.1e9 + REZERVA_B);
  });

  test("nasazení v letu NA TÉMŽE UZLU se připočte; na jiném uzlu ne", async () => {
    const text = vystupMereni(5 * 1024 * 1024, [
      [UUID_A, "aaaaaaaaaaaa", "2.1GB"],
      [UUID_B, "bbbbbbbbbbbb", "2.1GB"],
    ]);
    const spolu = await brana(text)("a", { vLetu: ["b"] });
    expect(spolu.ok).toBe(false);
    const jinde = await brana(text, "uzel-a=fixture@stub", { b: "uzel-b" })("a", { vLetu: ["b"] });
    expect(jinde.ok).toBe(true);
  });

  test("stack bez kontejnerů i obrazů ⇒ NEZMĚŘENO, ne zelená „jen rezerva“", async () => {
    const v = await brana(vystupMereni(20 * 1024 * 1024, []))("a", { vLetu: [] });
    expect(v.ok).toBe(true);
    expect(v.nezmereno?.duvod).toMatch(/nemá na uzlu kontejnery ani známé obrazy/);
  });

  test("…a když nestačí ani na rezervu, je to STOP", async () => {
    const v = await brana(vystupMereni(1024 * 1024, []))("a", { vLetu: [] });
    expect(v.ok).toBe(false);
    expect(v.duvod).toMatch(/STOP/);
  });

  // Naměřeno 2026-09-26 (jádro forku po úklidu): 5 obrazů ze 17 služeb → odhad
  // 4,8 GiB, nasazení zabralo 7,2 GiB. Část není celek.
  test("stack má na uzlu jen ČÁST obrazů ⇒ NEZMĚŘENO (změřené je jen dolní mez), ne zelená", async () => {
    const text = vystupMereni(
      20 * 1024 * 1024,
      [[UUID_A, "aaaaaaaaaaaa", "2.1GB"]],
      [
        [UUID_A, `${UUID_A}_ragnarok`],
        [UUID_A, "library/redis:7-alpine"],
      ],
    );
    const v = await brana(text)("a", { vLetu: [] });
    expect(v.ok).toBe(true);
    expect(v.nezmereno?.duvod).toMatch(/stacku a chybí na uzlu 2 obrazů/);
    expect(v.nezmereno?.duvod).toMatch(/dolní mez/);
    expect(v.cisla?.chybiObrazu).toBe(2);
  });

  test("…část obrazů a nestačí ani na změřenou dolní mez ⇒ STOP", async () => {
    const text = vystupMereni(3 * 1024 * 1024, [[UUID_A, "aaaaaaaaaaaa", "2.1GB"]], [[UUID_A, `${UUID_A}_ragnarok`]]);
    const v = await brana(text)("a", { vLetu: [] });
    expect(v.ok).toBe(false);
    expect(v.duvod).toMatch(/STOP/);
  });

  test("…chybí obrazy nasazení v letu na témže uzlu ⇒ taky NEZMĚŘENO, se jménem souseda", async () => {
    const text = vystupMereni(
      20 * 1024 * 1024,
      [
        [UUID_A, "aaaaaaaaaaaa", "1GB"],
        [UUID_B, "bbbbbbbbbbbb", "1GB"],
      ],
      [[UUID_B, `${UUID_B}_web`]],
    );
    const v = await brana(text)("a", { vLetu: ["b"] });
    expect(v.ok).toBe(true);
    expect(v.nezmereno?.duvod).toMatch(/nasazením v letu b chybí 1/);
  });

  test("stack má všechny obrazy ⇒ zelená bez NEZMĚŘENO", async () => {
    const v = await brana(vystupMereni(20 * 1024 * 1024, [[UUID_A, "aaaaaaaaaaaa", "2.1GB"]]))("a", { vLetu: [] });
    expect(v.ok).toBe(true);
    expect(v.nezmereno).toBeUndefined();
    expect(v.cisla?.chybiObrazu).toBe(0);
  });

  test("nedeklarovaný uzel ⇒ projde, ale jako NEZMĚŘENO (ne čisto)", async () => {
    const v = await brana("nikdy se nečte", "")("a", { vLetu: [] });
    expect(v.ok).toBe(true);
    expect(v.nezmereno?.uzel).toBe("uzel-a");
  });

  test("deklarovaný uzel, ale měření selže ⇒ STOP (slib hlídání neprojde tiše)", async () => {
    const v = await brana(new Error("ssh: connect timed out"))("a", { vLetu: [] });
    expect(v.ok).toBe(false);
    expect(v.duvod).toMatch(/deklarovaný, ale měření selhalo/);
  });

  test("neplatný záznam AISHA_NODE_SSH je chyba, ne tiché nedeklarováno", () => {
    expect(() => nactiMapuUzlu("uzel-a")).toThrow(/neplatný záznam/);
    expect(() => nactiMapuUzlu("uzel-a=x;rm")).toThrow(/neplatný záznam/);
    expect(() => nactiMapuUzlu("uzel-a=x,uzel-a=y")).toThrow(/dvakrát/);
  });
});

// ── aisha-redeploy end-to-end proti mock Coolify ─────────────────────────────
// Všechno míří na mock (COOLIFY_URL i COOLIFY_BASE_URL + token z prostředí mají
// přednost před soubory), takže ani regrese brány nedosáhne na živé Coolify.
const UUID_REGISTRY = "fixtureregistryuuid01";

async function spustRedeploy(o: { volnoKb: number; profil?: object }) {
  let posty = 0;
  const srv = http.createServer((req, res) => {
    const url = req.url ?? "";
    const json = (obj: unknown, s = 200) => {
      res.writeHead(s, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.method === "POST" && url.startsWith("/api/v1/deploy")) {
      posty++;
      return json({ deployments: [{ deployment_uuid: "dep-e2e" }] });
    }
    if (url === "/api/v1/projects/projfixture") return json({ environments: [{ id: 1, name: "production" }] });
    if (url === "/api/v1/projects/projfixture/production") {
      return json({
        applications: [{
          uuid: UUID_REGISTRY, name: "fixture-registry", status: "running:healthy",
          environment_id: 1, destination: { server: { name: "uzel-test" } },
        }],
      });
    }
    json({ message: "not found" }, 404);
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const adresa = srv.address();
  const url = `http://127.0.0.1:${typeof adresa === "object" && adresa ? adresa.port : 0}`;

  const tmp = mkdtempSync(join(tmpdir(), "redeploy-brana-"));
  const manifest = join(tmp, "fixture.manifest");
  writeFileSync(manifest, "app: registry:frontend:docker-compose.coolify-registry.yml\n");
  const bin = join(tmp, "bin");
  mkdirSync(bin);
  const sshLog = join(tmp, "ssh-volani");
  writeFileSync(
    join(bin, "ssh"),
    `#!/bin/sh\necho "$@" >> "${sshLog}"\ncat <<'EOF'\n${vystupMereni(o.volnoKb, [[UUID_REGISTRY, "aaaaaaaaaaaa", "2.1GB"]])}\nEOF\n`,
  );
  chmodSync(join(bin, "ssh"), 0o755);
  const overlay = join(tmp, "overlay");
  mkdirSync(join(overlay, "profiles"), { recursive: true });
  writeFileSync(join(overlay, "profiles", "fixture-profil.json"), JSON.stringify({ id: "fixture-profil", ...(o.profil ?? {}) }));

  const env: Record<string, string> = {
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    HOME: tmp,
    COOLIFY_BASE_URL: url,
    COOLIFY_URL: url,
    COOLIFY_API_TOKEN: "fixture-token",
    COOLIFY_PROJECT_UUID: "projfixture",
    COOLIFY_ENVIRONMENT: "production",
    APP_NAME_PREFIX: "fixture",
    MANIFEST_FILE: manifest,
    AISHA_PROFILE: "fixture-profil",
    AISHA_INSTANCE_CONFIG_DIR: overlay,
    AISHA_NODE_SSH: "uzel-test=fixture@stub",
    AISHA_SNAPSHOT_DIR: join(tmp, "snap"),
    AISHA_HEALTH_POLL_S: "1",
    NO_COLOR: "1",
  };
  const p = spawn(process.execPath, [join(ROOT, "scripts/aisha-redeploy.mjs"), "--only=registry"], { cwd: ROOT, env });
  let vystup = "";
  p.stdout.on("data", (d) => (vystup += d));
  p.stderr.on("data", (d) => (vystup += d));
  const kod = await new Promise<number | null>((r) => p.on("close", r));
  await new Promise<void>((r) => srv.close(() => r()));
  let ssh = "";
  try { ssh = readFileSync(sshLog, "utf8"); } catch { /* nevoláno */ }
  return { kod, vystup, posty, ssh };
}

describe("aisha-redeploy: disková brána a profil end-to-end", () => {
  test("nízké místo ⇒ exit ≠ 0, ZASTAVENO s čísly a 0× POST /deploy", async () => {
    const r = await spustRedeploy({ volnoKb: 1024 * 1024 });
    expect(r.posty, r.vystup).toBe(0);
    expect(r.kod, r.vystup).not.toBe(0);
    expect(r.vystup).toMatch(/ZASTAVENO/);
    expect(r.vystup).toMatch(/volno 1\.0 GiB < potřeba 4\.0 GiB/);
    expect(r.ssh, "brána se na uzel vůbec nezeptala").toMatch(/BatchMode=yes/);
    expect(r.vystup).toMatch(/Souběžnost nasazení: 1 \(profil fixture-profil klíč nemá/);
  }, 60_000);

  test("neplatné deploy_concurrency v profilu ⇒ chyba vstupu, 0× POST /deploy", async () => {
    const r = await spustRedeploy({ volnoKb: 100 * 1024 * 1024, profil: { deploy_concurrency: 0 } });
    expect(r.posty, r.vystup).toBe(0);
    expect(r.kod, r.vystup).toBe(2);
    expect(r.vystup).toMatch(/deploy_concurrency=0/);
  }, 60_000);
});

// ── Strukturální: jedny dveře, bootstrap bez REDEPLOY=1 ──────────────────────
/** Shell bez komentářových řádků (jen `#` — `*)` je větev `case`, ne komentář). */
const bezKomentaru = (text: string) =>
  text.split("\n").filter((r) => !/^\s*#/.test(r)).join("\n");

/** Přenasazuje bootstrap přes souběžný REDEPLOY=1? (detektor, ať ho jde zmutovat) */
function bootstrapPrenasazujeNaraz(zdroj: string): boolean {
  return /REDEPLOY=1[^\n]*coolify-sync-envs/.test(bezKomentaru(zdroj));
}

describe("netbird-bootstrap přenasazuje hlídaně", () => {
  const BOOTSTRAP = readFileSync(join(ROOT, "scripts/netbird-bootstrap.sh"), "utf8");

  test("žádné REDEPLOY=1 ani samostatné čekání přes coolify-deploy-watch", () => {
    expect(bootstrapPrenasazujeNaraz(BOOTSTRAP)).toBe(false);
    expect(bezKomentaru(BOOTSTRAP)).not.toMatch(/coolify-deploy-watch/);
  });

  test("přenasazuje aisha-redeploy --only; nezdar varuje s příkazem k dokončení, bootstrap neshodí", () => {
    // Neblokující jako dřívější čekání (brána par-klic-a-jeho-identifikator):
    // klíče jsou vyražené a doručené, tvrdý exit by je zahodil. Opakovaný
    // bootstrap je ale nepřenasadí — varování proto musí nést příkaz.
    const kod = bezKomentaru(BOOTSTRAP);
    expect(kod).toMatch(/node scripts\/aisha-redeploy\.mjs --only="\$_nb_stacky"/);
    const i = kod.indexOf('node scripts/aisha-redeploy.mjs --only="$_nb_stacky"');
    const vetevNezdaru = kod.slice(kod.indexOf("\n      else", i), kod.indexOf("\n      fi", i));
    expect(vetevNezdaru).toMatch(/\bwarn\s+"/);
    expect(vetevNezdaru).toMatch(/aisha-redeploy\.mjs --only=\$\{_nb_stacky\}/);
    expect(vetevNezdaru).not.toMatch(/\b(exit|return)\s+[1-9]/);
  });

  test("stacky bere z manifestu INSTANCE (sdílený resolver), ne ze šablony", () => {
    const kod = bezKomentaru(BOOTSTRAP);
    expect(kod).toMatch(/coolify-instance-scope\.mjs" --manifest-path/);
    expect(kod).not.toMatch(/manifests\/aisha\.manifest/);
  });

  test("MUTACE: vrácené REDEPLOY=1 detektor najde", () => {
    const mutant = BOOTSTRAP.replace(
      'SKIP_ENV_PREFLIGHT=1 bash "$ROOT/scripts/coolify-sync-envs.sh" $_nb_stacky_args',
      'SKIP_ENV_PREFLIGHT=1 REDEPLOY=1 bash "$ROOT/scripts/coolify-sync-envs.sh" $_nb_stacky_args',
    );
    expect(mutant).not.toBe(BOOTSTRAP);
    expect(bootstrapPrenasazujeNaraz(mutant)).toBe(true);
  });
});

describe("aisha-redeploy: každý trigger jde jedněmi dveřmi (spustHlidane)", () => {
  const REDEPLOY = readFileSync(join(ROOT, "scripts/aisha-redeploy.mjs"), "utf8");

  /** Tělo funkce podle počátku a vyvážených složených závorek. */
  function teloFunkce(zdroj: string, hlavicka: string): [number, number] {
    const start = zdroj.indexOf(hlavicka);
    expect(start, `nenalezeno: ${hlavicka}`).toBeGreaterThan(-1);
    // Tělo začíná `) {` — první `{` za hlavičkou může patřit destrukturovaným
    // parametrům (`{ apps, triggerFn, wave }`) a tělo by pak „skončilo" na `)`.
    const telo = zdroj.indexOf(") {", start);
    expect(telo, `nenalezeno tělo: ${hlavicka}`).toBeGreaterThan(-1);
    let hloubka = 0;
    for (let i = telo + 2; i < zdroj.length; i++) {
      if (zdroj[i] === "{") hloubka++;
      else if (zdroj[i] === "}" && --hloubka === 0) return [start, i];
    }
    throw new Error(`neuzavřené tělo: ${hlavicka}`);
  }

  test("volání triggerDeploy/triggerRestart/triggerFn jsou jen uvnitř spustHlidane", () => {
    const [od, do_] = teloFunkce(REDEPLOY, "async function spustHlidane(");
    const mimo: string[] = [];
    for (const m of REDEPLOY.matchAll(/\b(triggerDeploy|triggerRestart|triggerFn|retryTrigger)\(/g)) {
      const i = m.index ?? 0;
      const radek = REDEPLOY.slice(REDEPLOY.lastIndexOf("\n", i) + 1, REDEPLOY.indexOf("\n", i));
      if (/^\s*(async )?function /.test(radek) || /^\s*(\/\/|\*)/.test(radek)) continue;
      // retryTrigger volá čekání vlny — a vlna mu předává hlídaný obal (test níž).
      if (m[1] === "retryTrigger") continue;
      if (i < od || i > do_) mimo.push(radek.trim());
    }
    expect(mimo, "trigger mimo hlídané dveře").toEqual([]);
  });

  test("auto-retry uvnitř čekání dostává hlídaný obal, ne holý trigger", () => {
    expect(REDEPLOY).toMatch(
      /retryTrigger: async \(_uuid, name, poziceVlny\) => \(await spustHlidane\(\[name\], \{ apps, triggerFn, wave: poziceVlny \}\)\)/,
    );
    expect(REDEPLOY).not.toMatch(/retryTrigger: triggerFn/);
  });

  test("tvrdý problém zahrnuje STOP; NEZMĚŘENO není čisto", () => {
    expect(REDEPLOY).toMatch(/hlidani\.zastaveni !== null \|\|/);
    expect(REDEPLOY).toMatch(/disk NEZMĚŘEN na \$\{u\}/);
  });
});
