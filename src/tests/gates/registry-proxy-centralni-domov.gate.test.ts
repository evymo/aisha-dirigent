/**
 * Obrazy z Docker Hubu jdou přes CENTRÁLNÍ pull-through cache — jeden domov prefixu
 *
 * NAMĚŘENO 2026-09-14 na instanci <fork>: `REGISTRY_PROXY=` prázdné, 6/6 produkčních obrazů
 * postaveno s `REGISTRY_PROXY=` a 23/23 Docker Hub pinů `IMAGE_*` uložených BEZ
 * prefixu — vše šlo přímo na Docker Hub. Tři příčiny v řetězu:
 *  1. `config/image-versions.env` měl `${REGISTRY_PROXY:-}` → sourcování NASTAVILO
 *     prázdno a odvození v heredocu cold-startu (`${REGISTRY_PROXY-…}`) nikdy
 *     neproběhlo;
 *  2. env-doktor rozvíjel `${REGISTRY_PROXY}` v pinech z process.env, které tam
 *     skoro nikdy není;
 *  3. piny byly `required-static` → uložená hodnota bez prefixu už nikdy nesrovnala.
 *
 * Rozhodnutí majitele 2026-09-14: „jen v repu", domov centrální, výslovné vypnutí
 * cache smí žít JEN jako deklarace operátora v .env-prod-backup. (Coolify předává
 * build-time proměnné compose buildům jako --build-arg sám — změřeno na <fork>-core jiného forku:
 * gateway/postgrest/web bez `args:` mají v historii `REGISTRY_PROXY=<cache toho forku>/`
 * — takže stačí správná HODNOTA, ne úprava každého buildu.)
 *
 * Brána měří ZAPSANÝ soubor doktora v apply režimu (výpis doktora je useknutý).
 * Větev „výslovně vypnuto" potřebuje .env-prod-backup v kořeni repa, kam brána
 * nesahá — tu drží unit test `scripts/lib/registry-proxy.test.mjs`.
 */
import { afterAll, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { domovRegistryProxy } from "../../../scripts/lib/registry-proxy.mjs";
import { envDoktorDokoncil } from "./_env-doktor-dokoncil";

const ROOT = process.cwd();
const cti = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const IMAGE_VERSIONS = cti("config/image-versions.env");
const DOMOV = domovRegistryProxy(IMAGE_VERSIONS);
const DOCTOR = path.join(ROOT, "scripts/aisha-env-doctor.mjs");
const ZALOHY = path.join(ROOT, ".backup");

/**
 * CO SMÍ MIMO CACHE — jediný domov pravidla.
 *
 * Docker Hub = pin BEZ registru, nebo s výslovným `docker.io/`. Do 2026-10-03 se
 * „první segment s tečkou" bral jako jiný registr, takže `docker.io/…` cache obešlo
 * a brána mlčela (v mainu tak nebyl zapsaný žádný pin — změřeno: 24 přes cache,
 * 11 z jiných registrů, 0 výslovně z Hubu; díra čekala na první použití).
 *
 * Výjimka je povolená jen ZDŮVODNĚNÁ — řádek `# mimo-cache: <důvod>` těsně nad pinem —
 * a smí ji použít jen compose GPU slotu. Vznikla pro obraz, jehož velikost (desítky GB)
 * se nevejde na disk uzlu s cache: pull-through cache drží vrstvy týden a smazat je
 * neumí. Rozhodnutí majitele 2026-10-03: modelové a GPU věci jen na GPU uzlu.
 */
const HUB_VYSLOVNE = /^(?:index\.|registry-1\.)?docker\.io\//;
const jeZHubu = (v: string) => HUB_VYSLOVNE.test(v) || !/^[a-z0-9-]+\.[a-z0-9.-]+\//.test(v);
const DUVOD_MIMO_CACHE = /^# mimo-cache: \S.{15,}$/;
type Pin = { klic: string; hodnota: string; nad: string };
/** Piny `IMAGE_*` s řádkem, který stojí těsně nad nimi. */
const pinyVerzi = (text: string): Pin[] =>
  text.split("\n").flatMap((l, i, vse) => {
    const m = l.match(/^(IMAGE_[A-Z0-9_]+)=(.*)$/);
    return m ? [{ klic: m[1], hodnota: m[2], nad: (vse[i - 1] ?? "").trim() }] : [];
  });
const mimoCache = (text: string) =>
  pinyVerzi(text).filter((p) => !p.hodnota.startsWith("${REGISTRY_PROXY}") && jeZHubu(p.hodnota));
/** Piny z Docker Hubu mimo cache BEZ zdůvodnění — má být prázdné. */
const mimoCacheBezDuvodu = (text: string) =>
  mimoCache(text).filter((p) => !DUVOD_MIMO_CACHE.test(p.nad)).map((p) => `${p.klic}=${p.hodnota}`);
/** Klíče zdůvodněných výjimek. */
const vyjimkyZCache = (text: string) =>
  mimoCache(text).filter((p) => DUVOD_MIMO_CACHE.test(p.nad)).map((p) => p.klic);
const JE_GPU_SLOT = /^docker-compose\.coolify-accel[.-]/;
/** Užití výjimky v compose, který NENÍ compose GPU slotu → `soubor: KLÍČ`. */
const uzitiMimoGpuSlot = (klice: string[], composy: Array<[string, string]>) =>
  composy.flatMap(([soubor, text]) =>
    JE_GPU_SLOT.test(soubor)
      ? []
      : klice.filter((k) => new RegExp(`\\$\\{${k}[:}-]`).test(text)).map((k) => `${soubor}: ${k}`),
  );
const composyCoolify = (): Array<[string, string]> =>
  readdirSync(ROOT)
    .filter((f) => /^docker-compose\.coolify-.*\.ya?ml$/.test(f))
    .map((f) => [f, cti(f)]);

const docasne: string[] = [];
const semena = new Set<string>();

function doktor(obsah: string, extra: string[] = []): Map<string, string[]> {
  const dir = mkdtempSync(path.join(tmpdir(), "aisha-registry-proxy-"));
  docasne.push(dir);
  const envFile = path.join(dir, "env.test");
  writeFileSync(envFile, obsah);
  semena.add(obsah);
  const env: NodeJS.ProcessEnv = { ...process.env, ENV_FILE: envFile };
  // CI má REGISTRY_PROXY z vars — měří se DOMOV repa, ne prostředí runneru.
  delete env.REGISTRY_PROXY;
  delete env.IMAGE_CADDY;
  const r = spawnSync(process.execPath, [DOCTOR, ...extra], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 600_000,
    maxBuffer: 32 * 1024 * 1024,
    env,
  });
  if (r.error || r.signal || !envDoktorDokoncil(r.status)) {
    throw new Error(
      `env-doktor nedoběhl — soubor NENÍ měření: signal=${r.signal ?? "—"} status=${r.status}\n` +
        `${r.stdout ?? ""}${r.stderr ?? ""}`.trimEnd().split("\n").slice(-15).join("\n"),
    );
  }
  const out = new Map<string, string[]>();
  for (const l of readFileSync(envFile, "utf8").split("\n")) {
    const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out.set(m[1], [...(out.get(m[1]) ?? []), m[2]]);
  }
  return out;
}

afterAll(() => {
  for (const d of docasne) rmSync(d, { recursive: true, force: true });
  if (!existsSync(ZALOHY)) return;
  for (const f of readdirSync(ZALOHY)) {
    const p = path.join(ZALOHY, f);
    try {
      if (semena.has(readFileSync(p, "utf8"))) rmSync(p);
    } catch {
      // cizí soubor — nesahat
    }
  }
});

describe("REGISTRY_PROXY: centrální domov a srovnání pinů", () => {
  test("domov je holá pomlčka s neprázdným prefixem (ne `:-`, které nastaví prázdno)", () => {
    expect(IMAGE_VERSIONS).toMatch(/^REGISTRY_PROXY=\$\{REGISTRY_PROXY-[^}]+\/\}\s*$/m);
    expect(IMAGE_VERSIONS).not.toMatch(/^REGISTRY_PROXY=\$\{REGISTRY_PROXY:-/m);
  });

  test("cold-start prefix jen zapisuje — žádné druhé odvození z REGISTRY_DOMAIN", () => {
    const radky = cti("scripts/aisha-cold-start.sh").split("\n").filter((l) => /^REGISTRY_PROXY=/.test(l));
    expect(radky, "heredoc cold-startu musí REGISTRY_PROXY zapsat právě jednou").toHaveLength(1);
    expect(radky[0]).toBe("REGISTRY_PROXY=${REGISTRY_PROXY}");
  });

  test("každý Docker Hub pin nese ${REGISTRY_PROXY} — mimo cache jen s řádkem `# mimo-cache: <důvod>`", () => {
    expect(pinyVerzi(IMAGE_VERSIONS).length, "žádný pin — měřidlo je slepé").toBeGreaterThan(20);
    expect(
      mimoCacheBezDuvodu(IMAGE_VERSIONS),
      "pin z Docker Hubu bez prefixu jde mimo cache — výjimka chce řádek `# mimo-cache: <důvod>` těsně nad pinem",
    ).toEqual([]);
  });

  test("kladná kotva: GPU obraz JE zdůvodněná výjimka — a je jediná", () => {
    // Obraz vLLM přes cache = desítky GB na týden na uzlu s cache (naměřeno 2026-10-02).
    // Počet je kotva, ne strop pro pohodlí: další výjimka z cache je vědomé rozhodnutí,
    // které se sem zapíše i s důvodem — ne tichý vedlejší účinek jiné změny.
    expect(vyjimkyZCache(IMAGE_VERSIONS)).toEqual(["IMAGE_VLLM"]);
  });

  test("výjimka nese výslovné docker.io/ a doktor jí prefix nevrátí", () => {
    // Doktor srovnává piny BEZ registru na domov cache (viz test níž) — výjimka zapsaná
    // krátkým jménem by se při prvním běhu doktora tiše vrátila do cache.
    const vyjimky = mimoCache(IMAGE_VERSIONS).filter((p) => DUVOD_MIMO_CACHE.test(p.nad));
    expect(vyjimky.filter((p) => !HUB_VYSLOVNE.test(p.hodnota)).map((p) => `${p.klic}=${p.hodnota}`)).toEqual([]);
    const po = doktor("REGISTRY_PROXY=\n");
    for (const p of vyjimky) expect(po.get(p.klic)?.[0], `${p.klic} musí doktor zapsat beze změny`).toBe(p.hodnota);
  });

  test("obraz mimo cache smí použít jen compose vrstvy accel (slot gpu)", () => {
    // Kdyby si výjimku vypůjčil stack na sdíleném uzlu, tahal by z Docker Hubu mimo cache
    // (tvar, který shodil MinIO) a model by běžel mimo GPU uzel. Univerzum = všechny
    // docker-compose.coolify-*.yml v kořeni, ne výčet.
    const composy = composyCoolify();
    expect(composy.length, "žádný compose v kořeni — měřidlo je slepé").toBeGreaterThan(10);
    expect(
      uzitiMimoGpuSlot(vyjimkyZCache(IMAGE_VERSIONS), composy),
      "pin mimo cache (GPU obraz) použitý mimo compose vrstvy accel (slot gpu)",
    ).toEqual([]);
  });

  test("mutace: měřidlo výjimky není slepé", () => {
    const radky = IMAGE_VERSIONS.split("\n");
    const i = radky.findIndex((l) => l.startsWith("IMAGE_VLLM="));
    expect(i, "IMAGE_VLLM v image-versions chybí — mutace nemá co měřit").toBeGreaterThan(0);
    // (1) výjimka bez zdůvodnění = červená
    const bezDuvodu = [...radky.slice(0, i - 1), "# jen komentář", ...radky.slice(i)].join("\n");
    expect(mimoCacheBezDuvodu(bezDuvodu)).toEqual([radky[i]]);
    // (2) `docker.io/` u běžného obrazu bez výjimky = červená (díra do 2026-10-03)
    expect(mimoCacheBezDuvodu("IMAGE_CADDY=docker.io/library/caddy:2-alpine")).toEqual([
      "IMAGE_CADDY=docker.io/library/caddy:2-alpine",
    ]);
    // (3) původní pravidlo drží: pin z Hubu bez prefixu = červená; jiný registr ne
    expect(mimoCacheBezDuvodu("IMAGE_NGINX=library/nginx:1.27-alpine")).toHaveLength(1);
    expect(mimoCacheBezDuvodu("IMAGE_KEYCLOAK=quay.io/keycloak/keycloak:26.0")).toEqual([]);
    expect(mimoCacheBezDuvodu("IMAGE_X=ghcr.io/org/obraz:1")).toEqual([]);
    // (4) zdůvodnění musí být řádek výjimky, ne zmínka — a nesmí být prázdné
    expect(DUVOD_MIMO_CACHE.test("# mimo-cache: GPU obraz (desítky GB) — jen na GPU uzlu")).toBe(true);
    expect(DUVOD_MIMO_CACHE.test("# mimo-cache:")).toBe(false);
    expect(DUVOD_MIMO_CACHE.test("# mimo-cache: ano")).toBe(false);
    expect(DUVOD_MIMO_CACHE.test("# Docker Hub → mimo-cache: protože je velký")).toBe(false);
    // (5) týž pin v compose jiného slotu = červená; v compose GPU slotu ne
    const uziti = "    image: ${IMAGE_VLLM}\n";
    expect(uzitiMimoGpuSlot(["IMAGE_VLLM"], [["docker-compose.coolify-core.yml", uziti]])).toEqual([
      "docker-compose.coolify-core.yml: IMAGE_VLLM",
    ]);
    expect(uzitiMimoGpuSlot(["IMAGE_VLLM"], [["docker-compose.coolify-model.yml", "image: ${IMAGE_VLLM:-x}"]])).toHaveLength(1);
    expect(uzitiMimoGpuSlot(["IMAGE_VLLM"], [["docker-compose.coolify-accel.yml", uziti]])).toEqual([]);
    expect(uzitiMimoGpuSlot(["IMAGE_VLLM"], [["docker-compose.coolify-accel-hostfw.yml", uziti]])).toEqual([]);
    expect(uzitiMimoGpuSlot(["IMAGE_VLLM"], [["docker-compose.coolify-core.yml", "image: ${IMAGE_VLLM_JINY}"]])).toEqual([]);
  });

  test("⛔ instance s nedeklarovaným prázdným prefixem a piny bez prefixu se srovná", () => {
    const po = doktor("REGISTRY_PROXY=\nIMAGE_CADDY=library/caddy:2-alpine\n");
    expect(po.get("REGISTRY_PROXY"), "prefix právě jednou, z domova").toEqual([DOMOV]);
    expect(po.get("IMAGE_CADDY")).toEqual([`${DOMOV}library/caddy:2-alpine`]);
  });

  test("kontrolní vzorek: pin z jiného registru prefix nedostane", () => {
    // Vzorek si brána HLEDÁ v image-versions. Natvrdo zapsaný pin se rozbil dvakrát:
    // quay.io/minio/mc (MinIO se od #1072 staví ze zdroje) a ghcr.io element-call
    // (mrtvý pin, tag neexistuje). Bez `$` — rozvinutý pin by se od zápisu lišil.
    const vzorek = IMAGE_VERSIONS.split("\n")
      .map((l) => l.match(/^(IMAGE_[A-Z0-9_]+)=([a-z0-9-]+\.[a-z0-9.-]+\/[^\s$]+)$/))
      .find((m): m is RegExpMatchArray => Boolean(m));
    expect(vzorek, "image-versions nemá pin z jiného registru — vzorek nemá co měřit").toBeTruthy();
    const [, klic, pin] = vzorek as RegExpMatchArray;
    const po = doktor("REGISTRY_PROXY=\n");
    const cizi = po.get(klic)?.[0] ?? "";
    expect(cizi, `${klic} musí doktor zapsat beze změny`).toBe(pin);
    expect(cizi.startsWith(DOMOV)).toBe(false);
  });

  test("--no-external (preflight syncu) prefix ani piny nesoudí — nouzové vypnutí nezablokuje sync", () => {
    const po = doktor("REGISTRY_PROXY=\nIMAGE_CADDY=library/caddy:2-alpine\n", ["--no-external"]);
    expect(po.get("REGISTRY_PROXY")).toEqual([""]);
    expect(po.get("IMAGE_CADDY")).toEqual(["library/caddy:2-alpine"]);
  });
});
