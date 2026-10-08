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
import { isMeshHost } from "./mesh-host.mjs";

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
 * Hodnota domény, kterou služba SKUTEČNĚ registruje v Coolify — jeden domov
 * pravidla pro doktora (coolify-domain-doctor.mjs) i deploy-init
 * (`domena_pro_coolify` v scripts/coolify-deploy-init.sh).
 *
 * Vyřadí se:
 *   - mesh jména (`*.internal`) — obsluhuje je mesh-ingress, ne veřejný Traefik
 *     (Let's Encrypt pro ně nevydá nikdy a spálí rozpočet ACME, viz mesh-host.mjs);
 *   - jména, která vlastní edge (EDGE_OWNED_HOSTS) — veřejné jde jen přes edge.
 *
 * ⛔ NAMĚŘENO 2026-10-02 (průzkum bočních vstupů): když po vyřazení NEZBYDE NIC,
 * obě roviny dřív neposlaly NIC — doktor proto, že Coolify prázdný PATCH tiše
 * ignoruje, deploy-init celou položku přeskočil vzorem `*.internal`. Jenže tím
 * v Coolify ZŮSTAL starý router: n8n-auth dál registroval veřejné mcp/dirigent
 * na backendovém Traefiku, mimo edge — a redeploy po fast-forwardu forku by to
 * nikdy nesrovnal. Uvolňovací sentinel router výslovně ZRUŠÍ.
 *
 *   - nic se nevyřadilo            → beze změny
 *   - zbyde aspoň jeden host       → jen ti zbylí (pořadí zachováno)
 *   - nezbyde nic                  → uvolňovací sentinel (releaseSentinel)
 */
export function domenaProCoolify(sluzba, domain, owned, prefix) {
  const hosts = String(domain ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  const vlastniEdge = sluzba === EDGE_PROXY_SLUZBA ? new Set() : (owned ?? new Set());
  const zbyva = hosts.filter((host) => !isMeshHost(host) && !vlastniEdge.has(extractHost(host)));
  if (zbyva.length === hosts.length) return domain;
  if (zbyva.length > 0) return zbyva.join(",");
  if (!prefix) {
    throw new Error(
      `domenaProCoolify: ${sluzba} nemá co registrovat a starý router je třeba uvolnit, ale prefix ` +
        `instance chybí — uvolňovací sentinel bez identity instance by kolidoval s jiným projektem`,
    );
  }
  return releaseSentinel(sluzba, prefix);
}
