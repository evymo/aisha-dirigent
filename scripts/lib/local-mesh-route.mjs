/**
 * Lokální stack nemá NetBird mesh — mesh-route entrypoint ho NESMÍ vyžadovat.
 *
 * ⛔ NAMĚŘENO 2026-10-08 na čerstvém `local-warmup.sh --preset full-light`:
 * gateway, svc-mcp-knowledge, svc-ai-chat, svc-aitg-probes, openclaw, … v
 * restart smyčce s `/bin/sh: NETBIRD_DNS_IP: parameter not set or null`.
 * Compose soubory těchto služeb začínají entrypoint nepodmíněnou routou do mesh:
 *
 *     ip route replace "$${NETBIRD_PEER_CIDR:?}" via "$${NETBIRD_DNS_IP:?}"
 *
 * Lokálně žádný mesh-router neexistuje (presety: MESH_ENABLED=false, NetBird je
 * mimo rozsah lokálního stacku), takže routa nemá kam vést a `set -eu` shodí
 * kontejner. A `dns: [<NETBIRD_DNS_IP>]` posílá vnější dotazy na mesh resolver,
 * který lokálně není (127.0.0.1 uvnitř kontejneru = nikdo).
 *
 * Lokálně se proto odstraní PRÁVĚ ta nepodmíněná routa (a její echo) a DNS
 * override na mesh resolver. Podmíněné varianty (n8n: `case $MESH_ENABLED`) se
 * nemění — rozhodují samy a lokálně routu přeskočí.
 */

const ROUTE_LINE = /^[ \t]*ip route replace "\$\$\{NETBIRD_PEER_CIDR:\?\}" via "\$\$\{NETBIRD_DNS_IP:\?\}"[ \t]*$/;
const ROUTE_ECHO_LINE = /^[ \t]*echo "\[mesh-route\] \$\$\{NETBIRD_PEER_CIDR\} via \$\$\{NETBIRD_DNS_IP\}"[ \t]*$/;

/**
 * Odstraní nepodmíněnou mesh routu ze shell skriptu entrypointu.
 * @param {string} script
 * @returns {{ script: string, changed: boolean }}
 */
export function stripMeshRoute(script) {
  const lines = String(script).split("\n");
  if (!lines.some((l) => ROUTE_LINE.test(l))) return { script, changed: false };
  const kept = lines.filter((l) => !ROUTE_LINE.test(l) && !ROUTE_ECHO_LINE.test(l));
  return { script: kept.join("\n"), changed: true };
}

function stripInArgv(argv) {
  if (!Array.isArray(argv)) return { argv, changed: false };
  let changed = false;
  const out = argv.map((part) => {
    if (typeof part !== "string") return part;
    const r = stripMeshRoute(part);
    changed ||= r.changed;
    return r.script;
  });
  return { argv: out, changed };
}

/**
 * Lokální úprava jedné služby: entrypoint/command bez nepodmíněné mesh routy,
 * `dns:` bez mesh resolveru. Mutuje `svc`.
 * @param {Record<string, unknown>} svc služba po `docker compose config`
 * @param {{ meshDnsIp?: string }} opts lokální NETBIRD_DNS_IP (mesh resolver)
 * @returns {boolean} zda se služba změnila
 */
export function neutralizeMeshRouteForLocal(svc, { meshDnsIp } = {}) {
  let changed = false;
  for (const key of ["entrypoint", "command"]) {
    const r = stripInArgv(svc[key]);
    if (r.changed) {
      svc[key] = r.argv;
      changed = true;
    }
  }
  if (Array.isArray(svc.dns) && meshDnsIp) {
    const dns = svc.dns.filter((d) => d !== meshDnsIp);
    if (dns.length !== svc.dns.length) {
      changed = true;
      if (dns.length) svc.dns = dns;
      else delete svc.dns;
    }
  }
  return changed;
}
