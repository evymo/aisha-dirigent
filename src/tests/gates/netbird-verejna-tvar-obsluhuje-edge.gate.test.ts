/**
 * Veřejnou tvář NetBirdu obsluhuje EDGE a posílá ji na PŘÍMOU tvář.
 *
 * ⛔ NAMĚŘENO 2026-09-16 (guru): `netbird.<public-tld>` bylo zaregistrované
 * u netbird-proxy na uzlu služby. pfSense ale veřejnou zónu posílá na uzel
 * s edge, takže `/`, `/api/users`, `/relay` i gRPC `GetServerKey` vracely 404
 * a tamní Traefik servíroval „TRAEFIK DEFAULT CERT". Přímá tvář téhož proxy
 * přitom odpovídala z edge kontejneru i zvenku (401, grpc-status 0).
 *
 * Výjimka z pravidla „veřejné jde přes edge DO MESHE" (majitel 2026-09-16):
 * NetBird mesh staví, takže v ní být nemůže — edge jde na přímou tvář.
 *
 * ⭐ Brána neměří text šablony, ale VÝSLEDEK: spustí entrypoint edge-proxy
 * přesně tak, jak ho dostane kontejner (po de-escapování `$$` → `$`), a čte
 * Caddyfile, který vznikne. Negativní sondy ověřují, že se trasa bez přímé
 * tváře nevyrobí — edge by jinak směroval na prázdný upstream a Caddy by
 * nenaběhl.
 */
import { describe, expect, test } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";

const ROOT = process.cwd();
const VEREJNA = "netbird.verejna.example.test";
const PRIMA = "inst-netbird.backend.example.test";

function edgeProxy(): { skript: string; deklarovane: string[] } {
  const compose = parse(readFileSync(join(ROOT, "docker-compose.coolify-prebuilt.yml"), "utf8"), { merge: true }) as {
    services: Record<string, { entrypoint?: string[]; environment?: Record<string, unknown> }>;
  };
  const sluzba = compose.services["edge-proxy"];
  const entrypoint = sluzba?.entrypoint;
  if (!Array.isArray(entrypoint) || entrypoint.length < 3) {
    throw new Error("edge-proxy nemá entrypoint ve tvaru [/bin/sh, -c, skript] — brána nemá co spustit");
  }
  // Compose `$$` → shell `$`; tak skript dostane kontejner. Proměnné z
  // `environment` dostane kontejner VŽDY (i prázdné), takže jsou exportované —
  // skript na tom stojí (`printenv` po dosazení upstreamů).
  return { skript: entrypoint[2].split("$$").join("$"), deklarovane: Object.keys(sluzba.environment ?? {}) };
}

function vyrenderujCaddyfile(env: Record<string, string>): { caddyfile: string; log: string } {
  const dir = mkdtempSync(join(tmpdir(), "edge-netbird-"));
  try {
    const bin = join(dir, "bin");
    const caddyDir = join(dir, "caddy");
    mkdirSync(bin);
    for (const name of ["caddy", "ip"]) {
      writeFileSync(join(bin, name), "#!/bin/sh\nexit 0\n");
      chmodSync(join(bin, name), 0o755);
    }
    const { skript, deklarovane } = edgeProxy();
    const prazdne = Object.fromEntries(deklarovane.map((k) => [k, ""]));
    const vysledek = spawnSync("sh", ["-c", skript.split("/etc/caddy").join(caddyDir)], {
      env: { ...prazdne, PATH: `${bin}:${process.env.PATH}`, ...env },
      encoding: "utf8",
      timeout: 20_000,
    });
    const log = `${vysledek.stdout}\n${vysledek.stderr}`;
    const cesta = join(caddyDir, "Caddyfile");
    if (!existsSync(cesta)) throw new Error(`entrypoint Caddyfile nezapsal (rc ${vysledek.status}):\n${log}`);
    return { caddyfile: readFileSync(cesta, "utf8"), log };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ZAKLAD: Record<string, string> = {
  MESH_ENABLED: "false",
  EDGE_DOOR_MODE: "off",
  // Compose ji vyžaduje (`:?`, kontrakt env-doktora static 30) — nasazení ji má vždy.
  EDGE_ACCESS_RETENTION_DAYS: "30",
  MCP_DOMAIN: "mcp.verejna.example.test",
  API_DOMAIN_PUBLIC: "api.verejna.example.test",
  DIRIGENT_DOMAIN: "dirigent.verejna.example.test",
  AUTH_DOMAIN_PUBLIC: "auth.verejna.example.test",
  MCP_UPSTREAM_PUBLIC: "https://inst-mcp.backend.example.test",
  API_UPSTREAM_PUBLIC: "https://inst-api.backend.example.test",
  DIRIGENT_UPSTREAM_PUBLIC: "https://inst-dirigent.backend.example.test",
  AUTH_UPSTREAM_PUBLIC: "https://inst-auth.backend.example.test",
};

/** Blok `@netbird host …` až po jeho uzavírací závorku `handle`. */
function netbirdBlok(caddyfile: string): string | null {
  const m = /@netbird host [^\n]+\n\s*handle @netbird \{[\s\S]*?\n\s{2,}\}\n\s*\}/.exec(caddyfile);
  return m ? m[0] : null;
}

describe("veřejná tvář NetBirdu jde přes edge na přímou tvář", () => {
  test("s oběma jmény edge vyrenderuje trasu veřejné jméno → přímá tvář", () => {
    const { caddyfile, log } = vyrenderujCaddyfile({ ...ZAKLAD, NETBIRD_DOMAIN: VEREJNA, NETBIRD_DOMAIN_DIRECT: PRIMA });
    const blok = netbirdBlok(caddyfile);
    expect(blok, `Caddyfile nemá blok @netbird:\n${caddyfile}\n--- log ---\n${log}`).not.toBeNull();
    expect(blok).toContain(`@netbird host ${VEREJNA}`);
    expect(blok, "upstream je přímá tvář přes HTTPS").toContain(`reverse_proxy https://${PRIMA}`);
    expect(blok, "Host musí odpovídat routeru přímé tváře").toContain(`header_up Host ${PRIMA}`);
    expect(blok, "gRPC streamy a relay WebSocket se nesmí bufferovat").toContain("flush_interval -1");
    expect(blok, "přímá tvář nese veřejný certifikát — ověřuje se").not.toContain("tls_insecure_skip_verify");
  });

  test.each([
    ["bez přímé tváře", { NETBIRD_DOMAIN: VEREJNA, NETBIRD_DOMAIN_DIRECT: "" }],
    ["bez veřejného jména", { NETBIRD_DOMAIN: "", NETBIRD_DOMAIN_DIRECT: PRIMA }],
    ["přímá tvář je sentinel", { NETBIRD_DOMAIN: VEREJNA, NETBIRD_DOMAIN_DIRECT: "netbird-disabled.invalid" }],
    ["veřejné jméno je sentinel", { NETBIRD_DOMAIN: "netbird-disabled.invalid", NETBIRD_DOMAIN_DIRECT: PRIMA }],
    // Jednouzlová topologie (instanční profil, 2026-09-23 fork cheers): obě tváře
    // mají TOTÉŽ jméno. Patří netbird-proxy; trasa na edge by proxovala sama na sebe.
    ["jedno jméno pro obě tváře", { NETBIRD_DOMAIN: PRIMA, NETBIRD_DOMAIN_DIRECT: PRIMA }],
  ])("negativní sonda — %s: trasa nevznikne, Caddyfile ano", (_popis, nb) => {
    const { caddyfile } = vyrenderujCaddyfile({ ...ZAKLAD, ...nb });
    expect(caddyfile, "sonda musí dojít až k zápisu Caddyfile").toContain("@auth host auth.verejna.example.test");
    expect(netbirdBlok(caddyfile)).toBeNull();
    expect(caddyfile).not.toContain("@netbird");
  });
});
