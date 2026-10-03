/**
 * edge-vlastni-jmena.mjs — veřejné jméno, které na SVÉM uzlu obsluhuje edge,
 * vlastní edge. Backend na témž uzlu ho neregistruje.
 *
 * ⛔ NAMĚŘENO 2026-09-27 (jednouzlová instance s meshem — server_bindings všech
 * slotů na jeden stroj; cold-start krok 4): edge-proxy má
 * v kontraktu veřejná jména api/auth/mcp/dirigent a tatáž jména registrují
 * i backendy (core `gateway`, keycloak, orchestration `n8n-auth`). Návrh to
 * dovoluje záměrně — „jiný server = jiný Traefik" (fqdn-owners.mjs). Jenže
 * instance měla všechny sloty vázané na JEDEN stroj (`server_bindings`), takže
 * oba routery skončily na jednom Traefiku: FQDN_CONFLICT ×4, APPLY BLOCKED,
 * veřejná jména obsluhovaly backendy MIMO edge (a tedy mimo jeho zámek).
 *
 * Kdo jméno vlastní, rozhoduje DERIVACE (`EDGE_OWNED_HOSTS`, derive-domains.mjs)
 * — zná umístění i vazby slotů na uzly. Tady se to jen UPLATNÍ; stejné pravidlo
 * zrcadlí `set_coolify_domains` v scripts/coolify-deploy-init.sh a brána
 * `edge-vlastni-jmena-na-svem-uzlu` obě roviny spustí nad týmiž vstupy.
 *
 * Mění se jen to, KDO registruje router. Adresy (`*_DOMAIN_DIRECT`, upstreamy
 * edge) zůstávají: edge při zapnutém meshi jde na backend mimo Traefik
 * (`*_UPSTREAM_MESH`), takže vlastnictví jména smyčku nevyrobí.
 *
 * @module
 */
import { extractHost } from "./fqdn-owners.mjs";

/** Jméno služby, která jména VLASTNÍ — její záznam se nikdy nefiltruje. */
export const EDGE_PROXY_SLUZBA = "edge-proxy";

/** EDGE_OWNED_HOSTS (`host,host,…`) → množina holých hostů malými písmeny. */
export function edgeOwnedSet(raw) {
  return new Set(
    String(raw ?? "")
      .split(",")
      .map((host) => extractHost(host))
      .filter(Boolean),
  );
}

/**
 * Sentinel, kterým backend svůj router výslovně UVOLNÍ.
 *
 * Prázdná doména nestačí: Coolify ji s HTTP 200 tiše zahodí a router zůstane
 * (docs/deploy/MESH_BOOTSTRAP_2026_05_03.md). Společný sentinel taky ne —
 * Coolify vede každou doménu jako globálně jedinečnou, takže stejný řetězec
 * u dvou projektů skončí „Domain conflicts detected" a zahodí se CELÝ zápis
 * (viz mesh-router v coolify-domain-doctor.mjs). Proto jméno služby + prefix
 * instance. Schéma `http://`: k routeru se nepřilepí `certresolver=letsencrypt`,
 * takže `.invalid` nepálí rozpočet ACME účtu.
 */
export function releaseSentinel(sluzba, prefix) {
  return `http://${sluzba}-${prefix}.edge-vlastni.invalid:80`;
}

/** Je hodnota domény uvolňovací sentinel (na rozdíl od „služba nemá doménu")? */
export function isReleaseSentinel(domain) {
  return /\.edge-vlastni\.invalid(?::\d+)?(?:\/.*)?$/i.test(String(domain ?? "").trim());
}

/**
 * Hodnota domény služby bez hostů, které vlastní edge.
 *
 *   - `edge-proxy` sám, prázdná množina, nebo žádný host k vyřazení → beze změny
 *   - zbyde aspoň jeden host → jen ti zbylí (pořadí zachováno)
 *   - nezbyde nic → uvolňovací sentinel (viz releaseSentinel)
 */
export function bezJmenEdge(sluzba, domain, owned, prefix) {
  if (sluzba === EDGE_PROXY_SLUZBA || !owned || owned.size === 0) return domain;
  const hosts = String(domain ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  const zbyva = hosts.filter((host) => !owned.has(extractHost(host)));
  if (zbyva.length === hosts.length) return domain;
  if (zbyva.length > 0) return zbyva.join(",");
  if (!prefix) {
    throw new Error(
      `bezJmenEdge: ${sluzba} přijde o všechna jména, ale prefix instance chybí — ` +
        `uvolňovací sentinel bez identity instance by kolidoval s jiným projektem`,
    );
  }
  return releaseSentinel(sluzba, prefix);
}
