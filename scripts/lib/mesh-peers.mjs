/**
 * mesh-peers.mjs — co z výčtu peerů NetBird managementu plyne. Jeden domov.
 *
 * Výčet peerů (`GET /api/peers`, `netbird-peer-discover.mjs --json`) dosud
 * vykládala KAŽDÁ čtečka po svém — a tři ze čtyř stejně špatně: skládaly ho do
 * mapy podle odvozeného klíče nebo jména a vzaly to, co přišlo POSLEDNÍ.
 *
 * ⛔ NAMĚŘENO 2026-09-15 (instance s meshem, discovery vrátil 29 peerů,
 * `MESH_PEER_IPS` jich neslo 21):
 *
 *   1. KOLIZE KLÍČŮ. `backend-mesh-router` i `experimental-mesh-router` dávaly
 *      po odříznutí prefixu `MESH_ROUTER_MESH_IP`. Mapa jednoho zahodila —
 *      připojený mesh-router druhého stroje v důvěře (GATEWAY_TRUSTED_PROXIES)
 *      chyběl, takže x-forwarded-for z něj se nesmělo číst.
 *   2. DUPLICITNÍ JMÉNO. Po re-enrollmentu NetBird drží staré záznamy téhož
 *      hostname (edge 4×, backend-realtime 4×). Vítěz závisel na pořadí z API:
 *      ráno odpojený edge ze srpna, odpoledne živý. Dvě měření téhož stavu
 *      daly dvě různé hodnoty. Mesh DNS stejnou chybou mířil na mrtvou adresu
 *      („dial 100.112.246.17:3002: no route to host" byl odpojený realtime).
 *
 * ── ROZHODNUTÍ ────────────────────────────────────────────────────────────────
 *
 * DŮVĚRA (`MESH_PEER_IPS`) = IP VŠECH peerů výčtu, i odpojených. Ne jen
 * `connected`:
 *   · NetBird instance je vlastní (netbird-mesh-per-instance-endpoint) — každý
 *     peer výčtu je peer TÉHLE instance, cizí tam není.
 *   · Adresa existujícího peera se nepřiděluje nikomu jinému; uvolní se až
 *     smazáním peera. Důvěřovat jí tedy znamená důvěřovat vlastnímu peeru.
 *   · `MESH_PEER_IPS` se při každém refreshi PŘEPISUJE. Kdyby se braly jen
 *     připojené, peer, který se zrovna při redeployi restartuje, by z důvěry
 *     vypadl — a zůstal venku do dalšího nasazení.
 *   Z důvěry odejde peer, který z managementu zmizí (smazaný) — to je správně.
 *
 * ADRESA SLUŽBY (`<ROLE>_MESH_IP`) = JEDEN peer, vybraný DETERMINISTICKY:
 * připojený > nejnovější `lastSeen` > nižší IP. Pořadí z API nerozhoduje nikdy.
 *
 * NEJEDNOZNAČNÝ KLÍČ (dvě RŮZNÁ jména → týž klíč) se NEVYDÁVÁ. Takový klíč
 * nemá jednu správnou hodnotu; tipnout ji znamená poslat provoz na jiný stroj.
 * Hlásí se volajícímu, ten ho vypíše.
 *
 * ── PREFIXY V JMÉNU PEERA JSOU HISTORICKÉ ──────────────────────────────────────
 *
 * `frontend-`, `backend-`, `experimental-` pro mesh NIC neznamenají. Jsou to
 * pozůstatky směrování přímo na stroje podle jejich role — a `NB_HOSTNAME` je
 * nese jako literál zapečený v compose (mesh-conformance-apply), takže lže,
 * kdykoli profil umístí službu jinam (core má `frontend-core`, katalog
 * `placement: backend`). Odříznutím se z nich stane klíč nezávislý na
 * umístění (`CORE_MESH_IP`) — to je jejich JEDINÉ oprávněné použití tady.
 * Nový kód na nich nesmí stavět žádný význam.
 */

/** Historické prefixy umístění v `NB_HOSTNAME` — viz hlavička. `aisha-` a `build-` jsou totéž z dřívějška. */
export const HISTORICKE_PREFIXY_UMISTENI = Object.freeze(["aisha-", "frontend-", "backend-", "experimental-", "build-"]);

/** Jméno peera — management vrací `hostname` i `name`; hostname má přednost. */
export function jmenoPeera(peer) {
  return String(peer?.hostname || peer?.name || "").trim();
}

/**
 * Klíč adresy služby podle jména peera: odříznou se historické prefixy
 * umístění, zbytek je role (`frontend-core` → `CORE_MESH_IP`).
 */
export function klicMeshIp(jmeno) {
  let role = String(jmeno);
  for (const prefix of HISTORICKE_PREFIXY_UMISTENI) {
    if (role.startsWith(prefix)) role = role.slice(prefix.length);
  }
  return `${role.toUpperCase().replace(/-/g, "_")}_MESH_IP`;
}

function lastSeenMs(peer) {
  const t = Date.parse(peer?.lastSeen ?? peer?.last_seen ?? "");
  return Number.isFinite(t) ? t : 0;
}

/** Porovnání IPv4 po oktetech — „nižší IP" musí být číselně, ne řetězcově. */
function porovnejIp(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 4; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Je `kandidat` lepší adresou pro totéž jméno než `soucasny`?
 * Připojený > nejnovější lastSeen > nižší IP (poslední krok jen kvůli
 * determinismu — dva stejně staré připojené záznamy téhož jména jsou vada
 * managementu, ale výsledek nesmí záviset na pořadí).
 */
export function jeLepsiPeer(soucasny, kandidat) {
  if (!soucasny) return true;
  const kc = Boolean(kandidat.connected);
  if (kc !== Boolean(soucasny.connected)) return kc;
  const d = lastSeenMs(kandidat) - lastSeenMs(soucasny);
  if (d !== 0) return d > 0;
  return porovnejIp(kandidat.ip, soucasny.ip) < 0;
}

/** Použitelný peer má jméno i adresu. */
function pouzitelne(peers) {
  return (Array.isArray(peers) ? peers : []).filter((p) => jmenoPeera(p) && p?.ip);
}

/** jméno → nejlepší peer toho jména (viz `jeLepsiPeer`). */
export function nejlepsiPeerPodleJmena(peers) {
  const mapa = new Map();
  for (const p of pouzitelne(peers)) {
    const jmeno = jmenoPeera(p);
    if (jeLepsiPeer(mapa.get(jmeno), p)) mapa.set(jmeno, p);
  }
  return mapa;
}

/**
 * Adresy služeb: `klic → ip` z nejlepšího peera každého jména.
 * Klíč, na který se zobrazí DVĚ RŮZNÁ jména, se nevydá — vrací se v
 * `nejednoznacne` (klíč → seřazená jména), aby ho volající ohlásil.
 *
 * @returns {{ klice: Map<string,string>, nejednoznacne: Map<string,string[]> }}
 */
export function meshIpKlice(peers) {
  const jmenaPodleKlice = new Map();
  for (const [jmeno, peer] of nejlepsiPeerPodleJmena(peers)) {
    const k = klicMeshIp(jmeno);
    if (!jmenaPodleKlice.has(k)) jmenaPodleKlice.set(k, []);
    jmenaPodleKlice.get(k).push({ jmeno, ip: peer.ip });
  }
  const klice = new Map();
  const nejednoznacne = new Map();
  for (const k of [...jmenaPodleKlice.keys()].sort()) {
    const zaznamy = jmenaPodleKlice.get(k);
    if (zaznamy.length === 1) klice.set(k, zaznamy[0].ip);
    else nejednoznacne.set(k, zaznamy.map((z) => z.jmeno).sort());
  }
  return { klice, nejednoznacne };
}

/**
 * Důvěra: seřazená množina IP VŠECH peerů výčtu (i odpojených — viz hlavička).
 * Nevzniká z klíčů, takže ji kolize ani duplicity nezkrátí.
 * Řazení řetězcově, jako dosud — změna pořadí by na každé instanci vyrobila
 * falešný „drift" odvozených hodnot.
 */
export function mnozinaPeerIps(peers) {
  return [...new Set(pouzitelne(peers).map((p) => String(p.ip).trim()))].sort();
}
