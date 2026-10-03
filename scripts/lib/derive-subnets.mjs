/**
 * Instanční subnety odvozené z identity — jediný domov výpočtu.
 *
 * Žije zvlášť od generate-secrets.mjs, protože ten se při importu SPUSTÍ (čte
 * soubory, emituje env, umí skončit `process.exit`). Čistou funkci tedy nešlo
 * otestovat, a brána wp-3-4-docker-netseg přitom tvrdila, že „determinismus,
 * disjunktnost a RFC1918 jsou ověřeny u ZDROJE" — takový test nikdy neexistoval.
 * (Táž třída jako vada, kterou dnes opravujeme jinde: deklarace bez ověření.)
 */

import crypto from 'node:crypto';

/**
 * Vyhrazený pool 10.176.0.0/12.
 *
 * PROČ zrovna tenhle rozsah — uvnitř RFC1918 (10/8), ale záměrně vysoko:
 *   - mimo běžné firemní LAN 10.0.x / 10.1.x,
 *   - mimo Docker default bridge 172.17.0.0/16,
 *   - mimo NetBird CGNAT 100.64.0.0/10,
 *   - mimo 192.168/16.
 * /12 = 1024 bloků po /22.
 */
export const POOL_BASE_OCTETS = [10, 176];
export const POOL_CIDR = '10.176.0.0/12';
export const POOL_BLOCKS = 1024;

/**
 * Rozsah, ze kterého NetBird přiděluje adresy peerům (CGNAT, RFC 6598).
 *
 * Je to vlastnost NetBirdu, ne volba instance — proto konstanta a ne odvození.
 * JEDINÝ DOMOV té hodnoty: pool výše se jí vyhýbá a edge si přes ni staví
 * routu do mesh (`docker-compose.coolify-prebuilt.yml`, edge-proxy → mesh-router).
 * Kdyby se management někdy konfiguroval na jiný rozsah, mění se TADY a
 * generate-secrets to vydá jako NETBIRD_PEER_CIDR; compose rozsah neopisuje.
 */
export const NETBIRD_PEER_CIDR = '100.64.0.0/10';

/**
 * RFC1918 jako VÝČET. `isRfc1918` níž je predikát — odpoví „patří sem?“, ale
 * neumí ty rozsahy VYJMENOVAT, a kdo je posílá dál (gateway), potřebuje seznam.
 * Bez tohohle exportu si je každý konzument opsal znovu a rozešly by se.
 */
export const RFC1918_CIDRS = Object.freeze([
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
]);

/**
 * Prvky, přes které k nám klient PROCHÁZÍ. Gateway bere adresu z
 * `x-forwarded-for` ZPRAVA a zastaví se na prvním, kdo tu není — ten je pro ni
 * klient.
 *
 * ⛔ NAMĚŘENO 2026-08-31: mesh rozsah tu CHYBĚL, protože seznam byl kódový
 * default v `services/gateway/src/config.ts` a znal jen docker sítě. Poslední
 * skok před bránou je ale mesh peer, takže se sám tvářil jako klient:
 * `ip=100.126.250.10 verdikt=closed` u KAŽDÉHO požadavku z internetu.
 * Dva živé následky: (1) v `enforce` by se zavřelo přede VŠEMI včetně nás —
 * zaťukání zapíše naši adresu, brána by se ptala po adrese mesh skoku;
 * (2) rate-limit klíčuje toutéž adresou, takže celý internet sdílel JEDEN
 * kbelík 200 req/min.
 *
 * Podvržení tím nevzniká: co si klient do hlavičky napíše sám, zůstane VLEVO
 * od adresy, kterou dopsal edge — a chůze zprava se k tomu nedostane.
 */
export const TRUSTED_PROXY_CIDRS = Object.freeze([...RFC1918_CIDRS, '127.0.0.1']);

/**
 * ⛔ ROZSAH ROUTY NENÍ ROZSAH DŮVĚRY (naměřeno 2026-09-02).
 *
 * Do dneška tu jako poslední položka stál `NETBIRD_PEER_CIDR`, tedy
 * `100.64.0.0/10`. Jeden export sloužil dvěma protichůdným otázkám: routa chce
 * být ŠIROKÁ (ať trefí každého peera), důvěra ÚZKÁ (ať nepohltí klienty).
 *
 * 100.64/10 je RFC 6598 CGNAT — TÝŽ rozsah, který operátoři dávají mobilům.
 * Chůze zprava pak přeskočí i adresu SAMOTNÉHO KLIENTA a za klienta se prohlásí
 * to, co si napsal vlevo. Ověřeno proti `clientIpFrom` s přesně nasazeným seznamem:
 *
 *   198.51.100.143, <router>, <mesh>              -> 198.51.100.143   OK
 *   100.90.5.5, <router>, <mesh>   (mobil/CGNAT)  -> null   = NEZAŤUKÁ NIKDY
 *   1.2.3.4, 100.90.5.5, <router>, <mesh>         -> 1.2.3.4 = CIZÍ ADRESA
 *
 * Komentář o pár řádků výš přitom tvrdí „Podvržení tím nevzniká". Platí to jen
 * pro klienta MIMO důvěryhodný rozsah; pro klienta UVNITŘ něj je to naopak.
 * Tvrzení bylo NAPSANÉ, ne změřené — a brána `dvere-veri-mesh-skoku` ten /10
 * dokonce VYŽADOVALA, takže vadu držela.
 *
 * ⭐ PROČ VÝČET A NE UŽŠÍ ROZSAH
 * Docker adresy se mění při každém přenasazení, proto se pokrývají CIDR. Mesh
 * adresa peera je naopak STABILNÍ — NetBird ji peerovi drží. Dvě různé povahy,
 * dvě různé odpovědi. Peery navíc nemusíme hádat: `netbird-peer-discover.mjs`
 * je VYJMENUJE a `aisha-redeploy.mjs` je doručí jako `MESH_PEER_IPS`.
 *
 * ⛔ ŽÁDNÝ FALLBACK. Prázdný vstup = prázdný mesh podíl. Dveře na neznámého
 * klienta zavřou (`clientIpFrom` vrátí null) a gateway to ohlásí při startu.
 * Tiše dosadit rozsah by znamenalo vrátit přesně tuhle vadu.
 */
export function trustedProxies(meshPeerIps) {
  const seznam = (Array.isArray(meshPeerIps) ? meshPeerIps : String(meshPeerIps ?? '').split(','))
    .map((v) => String(v).trim())
    .filter(Boolean);
  for (const ip of seznam) {
    if (ip.includes('/')) {
      throw new Error(
        `MESH_PEER_IPS má nést ADRESY peerů, ne rozsah — dostal '${ip}'. ` +
          'Rozsah v seznamu důvěry je přesně ta vada, kterou tenhle tvar odstraňuje.',
      );
    }
  }
  return Object.freeze([...TRUSTED_PROXY_CIDRS, ...seznam]);
}

/** Čárkový tvar pro `GATEWAY_TRUSTED_PROXIES`; jeden zdroj, dva tvary. */
export function gatewayTrustedProxies(meshPeerIps) {
  return trustedProxies(meshPeerIps).join(',');
}

/**
 * Smí doktor přepsat uložený `GATEWAY_TRUSTED_PROXIES` odvozenou hodnotou?
 *
 * ⛔ NAMĚŘENO 2026-09-13. Doktor srovnává odvozené klíče s uloženými a rozdíl
 * považuje za drift. Pojistka proti přepsání je `odvozeno !== ""` — jenže
 * `gatewayTrustedProxies('')` prázdné NIKDY není, vždycky v něm zůstanou
 * dockerové CIDR. Když tedy chybí `MESH_PEER_IPS`, derivace vyjde „neprázdně",
 * liší se od uloženého seznamu s peery, a doktor ho PŘEPÍŠE seznamem bez peerů
 * se štítkem „drift opraven". Reprodukováno: 27 položek (23 peerů) → 4.
 *
 * Na core a edge by tím klientská adresa za mesh skokem přestala jít spočítat —
 * a to je PŘESNĚ ta cesta, kterou dveře a gateway rozhodují o přístupu.
 *
 * ⭐ ROZDÍL NENÍ DRIFT, KDYŽ CHYBÍ VSTUP. Odvozená hodnota je funkcí peerů, a bez
 * nich doktor správnou hodnotu NEZNÁ — nemá tedy z čeho usoudit, že uložená je
 * špatná. Premisa „srovnat je bezpečné, protože je to odvozené" platí jen
 * tehdy, když derivace vidí všechny své vstupy.
 *
 * Tři případy bez vstupu, protože každý znamená něco jiného:
 *   · uloženo nic       → zapsat derivaci bez peerů: stav před vznikem meshe
 *                          (dveře na neznámého zavřou, gateway to ohlásí),
 *   · uloženo s rozsahem → zapsat derivaci bez peerů: zakázaný rozsah je vada
 *                          (CGNAT — viz `trustedProxies`), kterou nesmí zakonzervovat
 *                          ani to, že discovery ještě neběžel,
 *   · uloženo platně    → PONECHAT: doktor neví víc než uložená hodnota.
 *
 * @param {{ existujici?: string, meshPeerIps?: string }} vstup
 * @returns {{ akce: 'zapsat' | 'ponechat', hodnota: string, duvod: string }}
 */
export function srovnaniTrustedProxies({ existujici, meshPeerIps }) {
  const peery = String(meshPeerIps ?? '').trim();
  if (peery) {
    return { akce: 'zapsat', hodnota: gatewayTrustedProxies(peery), duvod: 'odvozeno z MESH_PEER_IPS' };
  }
  const bezPeeru = gatewayTrustedProxies('');
  const ulozeno = String(existujici ?? '').trim();
  if (!ulozeno) {
    return { akce: 'zapsat', hodnota: bezPeeru, duvod: 'bez MESH_PEER_IPS — stav před vznikem meshe' };
  }
  const povolene = new Set(TRUSTED_PROXY_CIDRS);
  const zakazaneRozsahy = ulozeno
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.includes('/') && !povolene.has(v));
  if (zakazaneRozsahy.length) {
    return {
      akce: 'zapsat',
      hodnota: bezPeeru,
      duvod:
        `odstraněn zakázaný rozsah (${zakazaneRozsahy.join(', ')}); ` +
        'MESH_PEER_IPS chybí — spusť discovery, jinak mesh podíl zůstane prázdný',
    };
  }
  return {
    akce: 'ponechat',
    hodnota: ulozeno,
    duvod: 'MESH_PEER_IPS chybí — správnou hodnotu nejde odvodit, uložená se ponechává',
  };
}

// ⛔ Konstanta `GATEWAY_TRUSTED_PROXIES` tu BÝVALA a nesla mesh rozsah. Hodnota
// se nedá spočítat bez znalosti peerů, takže je z ní FUNKCE (výš). Kdo ji chce,
// musí říct, koho zná — a tím se vada „důvěřuj celému /10" nedá napsat omylem.

/** Počet /24 zón v jednom instančním /22 (frontend, backend, data, mesh-dns). */
export const ZONES = ['frontend', 'backend', 'data', 'meshDns'];

/**
 * Klíče, jejichž hodnota se POČÍTÁ, nikdy nedědí — jeden domov toho seznamu.
 *
 * Tady, protože tady vznikají. Kdo potřebuje vědět „smí tahle hodnota přežít
 * wipe?", ptá se odvození, ne katalogu opsaného někde jinde.
 *
 * ── K ČEMU TO JE ──────────────────────────────────────────────────────────────
 * Vault (`.env-prod-backup`) je trezor TAJEMSTVÍ: hodnot, které se po wipu už
 * nedají vyrobit (šifrovací klíče, identita validátoru). Odvozená hodnota je
 * pravý opak — vyrobí se znovu kdykoli, z identity instance. Zpětná synchronizace
 * takového klíče do vaultu tedy nic nezachraňuje a jen zakonzervuje minulost:
 *
 *   generate-secrets → Coolify → coolify-pull-envs → vault → prostředí → „override"
 *
 * NAMĚŘENO 2026-08-13: přesně takhle přežil ve vaultu mesh-DNS rozsah, který na
 * hostiteli mezitím zabral cizí nájemník. `docker network create` padal na
 * „Pool overlaps" a mesh na tom uzlu nevstal — zatímco odvozený rozsah byl volný.
 *
 * Brána vault-reverse-sync tu vlastnost hlídala už dřív, ale měřila ji VZORKEM
 * šesti ručně vypsaných jmen; tenhle seznam ji nechá měřit celou rodinu.
 */
export const DERIVED_NETWORK_KEYS = Object.freeze([
  'MESH_DNS_SUBNET',
  'MESH_DNS_RESOLVER_IP',
  'NETBIRD_DNS_IP',
  'NETSEG_FRONTEND_SUBNET',
  'NETSEG_BACKEND_SUBNET',
  'NETSEG_DATA_SUBNET',
]);

/**
 * Deterministické per-instance subnety z identity (deployPrefix).
 *
 * Každá instance dostane JEDEN /22 (index = 10 bitů z SHA-256 identity),
 * rozdělený na 4 sousední /24. Tím jsou čtyři sítě jedné instance zaručeně
 * disjunktní a dvě různé identity dostanou různý /22 — leda při kolizi na
 * 10 bitech, kterou řeší override v instančním manifestu. Živý překryv s cizí
 * sítí na hostiteli chytá `docker network create` (warmup ho hlásí i s příčinou).
 *
 * Bez stavu, bez fallbacku, čistě z identity: táž identita ⇒ týž rozsah, takže
 * hodnotu NENÍ potřeba nikde zachovávat. (Zachovávání jen udržovalo při životě
 * zděděné hodnoty — naměřeno 2026-08-11: aisha nesla z backupu 10.99.0.0/24,
 * který už na hostu držel jiný nájemník, a odvozený volný rozsah se ke slovu
 * nikdy nedostal.)
 *
 * @param {string} deployPrefix identita instance (APP_NAME_PREFIX)
 * @returns {{frontend:string, backend:string, data:string, meshDns:string, meshDnsResolver:string}}
 */
export function deriveSubnets(deployPrefix) {
  const id = String(deployPrefix ?? '');
  if (!id.trim()) {
    // Prázdná identita by dala VŠEM instancím týž blok — přesně ta kolize,
    // které se celý mechanismus vyhýbá. Odmítnout, ne dosadit.
    throw new Error('deriveSubnets: prázdná identita instance — rozsah nelze odvodit z ničeho.');
  }
  const h = crypto.createHash('sha256').update(id).digest();
  const blockIndex = ((h[0] << 8) | h[1]) & (POOL_BLOCKS - 1);        // 0..1023
  const poolBase = (POOL_BASE_OCTETS[0] << 24) | (POOL_BASE_OCTETS[1] << 16);
  const base = poolBase + blockIndex * 1024;                          // /22 pro tuhle instanci
  const dotted = (int, suffix) => {
    const a = (int >>> 24) & 0xff, b = (int >>> 16) & 0xff, c = (int >>> 8) & 0xff;
    return `${a}.${b}.${c}.${suffix}`;
  };
  return {
    frontend: dotted(base + 0, '0/24'),
    backend: dotted(base + 256, '0/24'),
    data: dotted(base + 512, '0/24'),
    meshDns: dotted(base + 768, '0/24'),
    meshDnsResolver: dotted(base + 768, '250'), // .250 host, mimo dynamickou alokaci
  };
}

/**
 * `<a.b.c>.0/24` → `<a.b.c>.250` — resolver uvnitř TÉŽE sítě.
 * (Konkrétní adresa se sem nepíše ani jako příklad: brána no-hardcoded-network
 * hlídá celý strom a komentář je pro ni týž text jako kód. Právem — takhle se
 * infra adresy do repa dostávají.)
 */
export function resolverFor(cidr) {
  return String(cidr).replace(/\.\d+\/\d+$/, '.250');
}

/**
 * true, když IPv4 adresa leží UVNITŘ daného CIDR bloku.
 *
 * Existuje, aby šlo odlišit OVERRIDE od ZDĚDĚNÉ HODNOTY. Adresa mimo rozsah není
 * volba operátora — je to setrvačnost po změně rozsahu, a Docker ji odmítne až
 * při startu kontejneru ("invalid endpoint settings"), tedy dávno po tom, co ji
 * kdokoli mohl spojit s příčinou.
 */
export function ipInCidr(ip, cidr) {
  const im = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(String(ip).trim());
  const cm = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/.exec(String(cidr).trim());
  if (!im || !cm) return false;
  const prefix = Number(cm[5]);
  if (prefix < 0 || prefix > 32) return false;
  const toInt = (a, b, c, d) => ((a << 24) >>> 0) + (b << 16) + (c << 8) + d;
  const octets = (m) => [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if ([...octets(im), ...octets(cm)].some((o) => o < 0 || o > 255)) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (((toInt(...octets(im)) & mask) >>> 0) === ((toInt(...octets(cm)) & mask) >>> 0));
}

/** true, když je CIDR uvnitř RFC1918 (10/8, 172.16/12, 192.168/16). */
export function isRfc1918(cidr) {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/.exec(String(cidr));
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  const prefix = Number(m[5]);
  if (prefix < 8 || prefix > 32) return false;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}
