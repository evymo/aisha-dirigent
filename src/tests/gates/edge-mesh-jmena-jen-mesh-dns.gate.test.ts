/**
 * Brána: edge-proxy překládá mesh jména upstreamů JEN mesh DNS.
 *
 * ⛔ NAMĚŘENO 2026-10-02 (revize d-ii <fork> Detail firmy, kolo 2; e2e
 * skript nad SKUTEČNÝM startovním skriptem
 * edge-proxy): vestavěné DNS Dockeru (127.0.0.11) dává PŘEDNOST aliasům ze sítí
 * kontejneru — i ze sdílené `coolify`, kde jsou kontejnery ostatních nájemníků
 * hostitele. Cizí kontejner s aliasem `<prefix>-api.mesh.<tld>` tak přebil mesh
 * DNS a veřejná trasa `api.*` vrátila JEHO obsah („SQUATTER“). Routa do rozsahu
 * peerů nepomůže, adresa leží na sdílené síti.
 *
 * Proto Caddy u každého upstreamu z proměnné (mesh lane, ve veřejném režimu
 * veřejné jméno — obojí mesh DNS přeloží, ostatní jména předává dál) používá
 * `transport http { resolvers ${NETBIRD_DNS_IP} }`: snippet `(mesh_dns)`, u https
 * upstreamu přímo ve vlastním transportu.
 *
 * Výslovné výjimky (nejsou mesh jména):
 *   · `reverse_proxy https://%s` netbird — řídicí rovina meshe, přímá tvář
 *     (bootstrap: mesh ji potřebuje, aby vůbec vznikla);
 *   · `reverse_proxy http://extranet-auth:4180` — kontejner TÉŽE aplikace.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = process.cwd();

/** Startovní skript edge-proxy tak, jak ho nese compose (s `$$`). */
function skriptEdgeProxy(): string {
  const doc = parse(readFileSync(join(ROOT, "docker-compose.coolify-prebuilt.yml"), "utf8")) as {
    services?: Record<string, { entrypoint?: unknown; command?: unknown }>;
  };
  const s = doc.services?.["edge-proxy"];
  const vstup = Array.isArray(s?.entrypoint) ? (s!.entrypoint as unknown[]) : [];
  return String(vstup[2] ?? [s?.command ?? ""].flat().join("\n"));
}

/**
 * Upstreamy z proměnné, které NEJDOU přes mesh DNS. Vrací popisy nálezů.
 * Měří dva tvary, jimiž skript Caddyfile skládá:
 *   1. heredoc: `reverse_proxy $${X_UPSTREAM} { … }`
 *   2. printf:  `reverse_proxy %s { … }` (cíl dosazený za běhu)
 */
export function upstreamyBezMeshDns(skript: string): { nalezy: string[]; zmereno: number } {
  const nalezy: string[] = [];
  let zmereno = 0;
  for (const m of skript.matchAll(/reverse_proxy \$\$\{([A-Z_]+_UPSTREAM)\} \{([\s\S]*?)\n\s*\}/g)) {
    zmereno += 1;
    if (!/import mesh_dns|\$\$\{(api|auth)_tls\}/.test(m[2])) nalezy.push(`heredoc ${m[1]}`);
  }
  for (const m of skript.matchAll(/(\w+_block)=.*?reverse_proxy %s \{((?:(?!\\n {4}\}).)*)\\n {4}\}/g)) {
    zmereno += 1;
    if (!/import mesh_dns/.test(m[2])) nalezy.push(`printf ${m[1]}`);
  }
  // api_tls/auth_tls: výchozí = snippet, https větev = resolvers ve vlastním transportu.
  for (const jmeno of ["api_tls", "auth_tls"]) {
    const vychozi = new RegExp(`${jmeno}=\\$\\$\\(printf '\\\\n\\s*import mesh_dns'\\)`).test(skript);
    const https = new RegExp(`https://\\*\\) ${jmeno}=\\$\\$\\(printf '[^']*resolvers %s`).test(skript);
    if (!vychozi) nalezy.push(`${jmeno}: výchozí transport bez mesh DNS`);
    if (!https) nalezy.push(`${jmeno}: https transport bez resolvers`);
  }
  return { nalezy, zmereno };
}

describe("edge-proxy: mesh jména upstreamů jen přes mesh DNS", () => {
  const skript = skriptEdgeProxy();

  it("snippet (mesh_dns) stojí na ověřeném NETBIRD_DNS_IP a je v Caddyfile", () => {
    expect(skript, "kontrolní vzorek: skript edge-proxy se nenašel").toContain("cat > /etc/caddy/Caddyfile <<CADDY");
    expect(skript, "NETBIRD_DNS_IP se neověřuje jako IPv4 (jde do konfigurace Caddy)").toMatch(
      /case "\$\$\{NETBIRD_DNS_IP\}" in\s*\n\s*""\|\*\[!0-9\.\]\*/,
    );
    expect(skript).toMatch(/mesh_dns=\$\$\(printf '\(mesh_dns\) \{\\n {2}transport http \{\\n {4}resolvers %s/);
    expect(skript, "snippet se do Caddyfile nevkládá").toMatch(/<<CADDY\n\s*\$\$\{global_block\}\n\s*\$\$\{mesh_dns\}/);
  });

  it("každý upstream z proměnné jde přes mesh DNS (univerzum ≥ 12 bloků)", () => {
    const { nalezy, zmereno } = upstreamyBezMeshDns(skript);
    expect(zmereno, "měřidlo osiřelo — skript skládá upstreamy jinak, než brána čte").toBeGreaterThanOrEqual(12);
    expect(
      nalezy,
      "Tyhle upstreamy edge-proxy se překládají vestavěným DNS Dockeru — cizí kontejner\n" +
        "s aliasem mesh jména na sdílené síti `coolify` by veřejnou trasu přesměroval na sebe.\n" +
        "Přidej `import mesh_dns` (https: `resolvers` do vlastního transportu).",
    ).toEqual([]);
  });

  it("negativní sonda: blok bez importu se chytí, výjimky (netbird, extranet-auth) ne", () => {
    const blok = (telo: string) =>
      `live_block=$$(printf '@live host %s\\n  handle @live {\\n    reverse_proxy %s {\\n      header_up Host %s${telo}\\n    }\\n  }' "a" "b" "c")`;
    expect(upstreamyBezMeshDns(blok("")).nalezy).toContain("printf live_block");
    expect(upstreamyBezMeshDns(blok("\\n      import mesh_dns")).nalezy).not.toContain("printf live_block");
    const vyjimky =
      `netbird_block=$$(printf '@netbird host %s\\n  handle @netbird {\\n    reverse_proxy https://%s {\\n      flush_interval -1\\n    }\\n  }' a b)\n` +
      `extranet_block=$$(printf '@extranet host %s\\n  handle @extranet {\\n    reverse_proxy http://extranet-auth:4180 {\\n      header_up X-Forwarded-Proto https\\n    }\\n  }' a)`;
    expect(upstreamyBezMeshDns(vyjimky).zmereno).toBe(0);
    const heredoc = "            reverse_proxy $${MCP_UPSTREAM} {\n              header_up Host {http.request.host}\n            }";
    expect(upstreamyBezMeshDns(heredoc).nalezy).toContain("heredoc MCP_UPSTREAM");
  });
});
