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

const ROOT = process.cwd();
const cti = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const IMAGE_VERSIONS = cti("config/image-versions.env");
const DOMOV = domovRegistryProxy(IMAGE_VERSIONS);
const DOCTOR = path.join(ROOT, "scripts/aisha-env-doctor.mjs");
const ZALOHY = path.join(ROOT, ".backup");

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
  if (r.error || r.signal || r.status !== 0) {
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

  test("každý Docker Hub pin v image-versions nese ${REGISTRY_PROXY}", () => {
    const bez = IMAGE_VERSIONS.split("\n")
      .map((l) => l.match(/^(IMAGE_[A-Z0-9_]+)=(.*)$/))
      .filter((m): m is RegExpMatchArray => Boolean(m))
      .filter(([, , v]) => !v.startsWith("${REGISTRY_PROXY}"))
      // jiný registr = první segment s tečkou (quay.io, ghcr.io, dock.mau.dev, …)
      .filter(([, , v]) => !/^[a-z0-9-]+\.[a-z0-9.-]+\//.test(v))
      .map(([, k, v]) => `${k}=${v}`);
    expect(bez, "pin z Docker Hubu bez prefixu jde mimo cache").toEqual([]);
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
