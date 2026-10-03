/**
 * mesh-host.mjs — mesh jméno (`*.internal`) není Coolify doména.
 *
 * Coolify z každé domény staví Traefik router s `certresolver=letsencrypt`.
 * Let's Encrypt pro `.internal` nevydá NIKDY a opakované neúspěchy spálí
 * rozpočet ACME účtu, až odmítne i legitimní hostitele téhož účtu (429).
 * Mesh provoz jde přes WireGuard do mesh-ingressu stacku s certifikátem
 * AISHA PKI, ne přes veřejný Traefik.
 *
 * Totéž pravidlo drží `set_coolify_domains` v scripts/coolify-deploy-init.sh;
 * brána `mesh-jmeno-neni-coolify-domena` hlídá, že obě roviny mluví stejně.
 *
 * @module
 */

/** Je host mesh jméno? Přijímá URL s portem i cestou. */
export function isMeshHost(host) {
  return /\.internal(?::\d+)?(?:\/.*)?$/i.test(String(host || "").trim());
}

/**
 * Hodnota domény bez mesh hostů. Coolify přijímá víc hostů oddělených čárkou,
 * proto se filtruje po jednom; zbydou jen ne-mesh hosté (prázdný řetězec,
 * když žádný).
 */
export function withoutMeshHosts(domain) {
  return String(domain || "")
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host && !isMeshHost(host))
    .join(",");
}
