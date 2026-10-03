/**
 * Brána: zdravotní sonda služby smí volat jen to, co její obraz má.
 *
 * ⛔ NAMĚŘENO 2026-09-14 v produkci instance, sidecar `ingest-drop-pull` brokeru:
 *
 *     healthcheck   pgrep -f 'mc mirror' >/dev/null || exit 1
 *     Health.Log    /bin/sh: line 1: pgrep: command not found
 *     stav          running (unhealthy) — přitom `mc mirror` běžel a přenos fungoval
 *
 * Sonda se narodila na plovoucím Docker Hub `minio/mc`; po přechodu na připnutý
 * `quay.io/minio/mc` už nemohla zezelenat NIKDY (pgrep, ps, grep, pidof, curl ani
 * wget v něm nebyly).
 *
 * 2026-09-25: MinIO obrazy zmizely z registrů úplně (Docker Hub smazán, quay.io 401).
 * Doprava balíků jede na rclone (IMAGE_RCLONE) a MinIO server i `mc` se staví ze
 * zdroje (docker/minio). Vlastnost zůstává, mění se obrazy: brána proto měří KAŽDÝ
 * obraz, na kterém sondy úložiště a dopravy stojí, se seznamem chybějících nástrojů
 * naměřeným na KONKRÉTNÍM pinu.
 *
 * CO BRÁNA TVRDÍ
 * 1. Sonda služby na změřeném obrazu nevolá nástroj, který v něm chybí.
 * 2. Čte-li sonda soubor (`< /cesta`), entrypoint téže služby ho zapisuje.
 * 3. Seznam platí pro pin, na kterém se měřil. Změní-li se pin, brána spadne a
 *    žádá nové měření:
 *      docker run --rm --user 0 --entrypoint sh <obraz> -c \
 *        'for t in pgrep ps grep pidof curl wget bash jq; do type $t >/dev/null 2>&1 || echo $t; done'
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = process.cwd();
const IMAGE_VERSIONS = readFileSync(join(ROOT, "config/image-versions.env"), "utf-8");
const MINIO_DOCKERFILE = readFileSync(join(ROOT, "docker/minio/Dockerfile"), "utf-8");

/** Nástroje, na které se sondy v praxi odvolávají — měří se jejich PŘÍTOMNOST v obrazu. */
const NASTROJE = ["pgrep", "ps", "grep", "pidof", "curl", "wget", "bash", "jq"];

type Sluzba = {
  image?: string;
  build?: string | { context?: string };
  entrypoint?: unknown;
  command?: unknown;
  healthcheck?: { test?: unknown };
};

interface ZmerenyObraz {
  popis: string;
  /** Pin, jak ho dnes deklaruje domov (null = nenašel se). */
  pin: () => string | null;
  /** Pin, na kterém se `chybi` naměřilo. */
  zmerenyPin: string;
  /** Naměřeno (2026-09-25) — z NASTROJE v obrazu chybí. */
  chybi: string[];
  patri: (s: Sluzba) => boolean;
}

const kontext = (s: Sluzba) => (typeof s.build === "string" ? s.build : s.build?.context);

export const OBRAZY: ZmerenyObraz[] = [
  {
    popis: "rclone (IMAGE_RCLONE)",
    pin: () => IMAGE_VERSIONS.match(/^IMAGE_RCLONE=(.+)$/m)?.[1]?.trim() ?? null,
    zmerenyPin: "${REGISTRY_PROXY}rclone/rclone:1.68",
    chybi: ["curl", "bash", "jq"],
    patri: (s) => typeof s.image === "string" && s.image.startsWith("${IMAGE_RCLONE"),
  },
  {
    popis: "MinIO/mc ze zdroje (docker/minio, běhový základ)",
    pin: () => MINIO_DOCKERFILE.match(/^FROM\s+\$\{REGISTRY_PROXY\}(\S+)\s+AS\s+runtime\s*$/m)?.[1] ?? null,
    zmerenyPin: "curlimages/curl:8.22.0@sha256:58adaa4e8dca9c988bae2aba4ab3434a0bb2da16bbe3f92dec39ec7785166777",
    chybi: ["bash", "jq"],
    patri: (s) => kontext(s) === "docker/minio",
  },
];

export function textSondy(test: unknown): string {
  if (Array.isArray(test)) return test.slice(1).join(" ");
  return typeof test === "string" ? test : "";
}

export function volaneNastroje(sonda: string, nastroje: readonly string[] = NASTROJE): string[] {
  return nastroje.filter((n) => new RegExp(`(^|[\\s;|&(])${n}(\\s|$)`).test(sonda));
}

export function ctenySoubor(sonda: string): string | null {
  const m = sonda.match(/<\s*(\/[^\s;|&]+)/);
  return m ? m[1] : null;
}

/** Plní skript soubor obsahem? Vyprázdnění `: > soubor` se nepočítá — sondě nic nedá. */
export function plniSoubor(skript: string, soubor: string): boolean {
  const cesta = soubor.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`\\b(echo|printf)\\b[^\\n;]*>\\s*${cesta}(\\s|$)`, "m").test(skript);
}

function sluzbyNa(obraz: ZmerenyObraz): { soubor: string; jmeno: string; sluzba: Sluzba }[] {
  const out: { soubor: string; jmeno: string; sluzba: Sluzba }[] = [];
  for (const soubor of readdirSync(ROOT).filter((f) => /^docker-compose.*\.ya?ml$/.test(f)).sort()) {
    const doc = parseYaml(readFileSync(join(ROOT, soubor), "utf-8")) as { services?: Record<string, Sluzba> } | null;
    for (const [jmeno, sluzba] of Object.entries(doc?.services ?? {})) {
      if (sluzba && obraz.patri(sluzba)) out.push({ soubor, jmeno, sluzba });
    }
  }
  return out;
}

describe("sonda volá jen to, co obraz má", () => {
  it.each(OBRAZY.map((o) => [o.popis, o] as const))("%s: pin je ten, na kterém se seznam měřil", (_p, obraz) => {
    expect(obraz.pin(), `změnil se pin (${obraz.popis}) — změř znovu, co v obrazu chybí, a uprav zmerenyPin/chybi`).toBe(
      obraz.zmerenyPin,
    );
  });

  it("brána má co měřit (na každém změřeném obrazu stojí služba se sondou)", () => {
    for (const obraz of OBRAZY) {
      expect(sluzbyNa(obraz).filter((s) => s.sluzba.healthcheck?.test).length, obraz.popis).toBeGreaterThan(0);
    }
  });

  it("žádná sonda nevolá nástroj, který v obrazu chybí, a čtený soubor někdo zapisuje", () => {
    const nalezy: string[] = [];
    for (const obraz of OBRAZY) {
      for (const { soubor, jmeno, sluzba } of sluzbyNa(obraz)) {
        const sonda = textSondy(sluzba.healthcheck?.test);
        if (!sonda) continue;
        const chybi = volaneNastroje(sonda).filter((n) => obraz.chybi.includes(n));
        if (chybi.length) nalezy.push(`${soubor} › ${jmeno}: sonda volá ${chybi.join(", ")} — v ${obraz.zmerenyPin} není, sonda nikdy nezezelená`);
        const cteny = ctenySoubor(sonda);
        const vstup = [sluzba.entrypoint, sluzba.command].flat().filter((x) => typeof x === "string").join("\n");
        if (cteny && !plniSoubor(vstup, cteny)) nalezy.push(`${soubor} › ${jmeno}: sonda čte ${cteny}, ale entrypoint ho nenaplní`);
      }
    }
    expect(nalezy).toEqual([]);
  });
});

describe("parser sondy — sebetest", () => {
  it("chytí původní tvar s pgrep a pustí vestavěné příkazy", () => {
    expect(volaneNastroje("pgrep -f 'mc mirror' >/dev/null || exit 1")).toEqual(["pgrep"]);
    expect(volaneNastroje("curl -fsS http://x || exit 1")).toEqual(["curl"]);
    expect(volaneNastroje("read -r pid < /tmp/mirror.pid && kill -0 $$pid")).toEqual([]);
    expect(volaneNastroje("test -s /tmp/progress")).toEqual([]);
  });

  it("vada se ohlásí jen na obrazu, kterému nástroj chybí", () => {
    const [rclone, minio] = OBRAZY;
    const sonda = "curl -fsS http://localhost:9000/minio/health/live || exit 1";
    expect(volaneNastroje(sonda).filter((n) => rclone!.chybi.includes(n))).toEqual(["curl"]);
    expect(volaneNastroje(sonda).filter((n) => minio!.chybi.includes(n))).toEqual([]);
  });

  it("najde čtený soubor", () => {
    expect(ctenySoubor("read -r pid < /tmp/mirror.pid && kill -0 $$pid")).toBe("/tmp/mirror.pid");
    expect(ctenySoubor("pgrep -f x")).toBeNull();
  });

  it("zápis PID počítá, samotné vyprázdnění ne", () => {
    expect(plniSoubor('echo "$$!" > /tmp/mirror.pid\n: > /tmp/mirror.pid', "/tmp/mirror.pid")).toBe(true);
    expect(plniSoubor('echo "$$!" > /tmp/jiny.pid\n: > /tmp/mirror.pid', "/tmp/mirror.pid")).toBe(false);
    expect(plniSoubor("printf '%s' 1 >/tmp/mirror.pid", "/tmp/mirror.pid")).toBe(true);
  });

  it("text sondy z CMD-SHELL i z řetězce", () => {
    expect(textSondy(["CMD-SHELL", "a && b"])).toBe("a && b");
    expect(textSondy("a")).toBe("a");
  });
});
