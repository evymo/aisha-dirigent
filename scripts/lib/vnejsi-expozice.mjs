#!/usr/bin/env node
/**
 * vnejsi-expozice.mjs — co je na uzlu s firewallem hostitele vidět ZVENKU.
 *
 * Měří se TCP connect z tohoto stanoviště na veřejnou IP uzlu (z Coolify API),
 * ne `ss` na uzlu: naslouchající port za firewallem není expozice a port, který
 * `ss` neukáže (DNAT do kontejneru), expozicí být může.
 *
 * Které uzly: sloty, kam katalog umisťuje firewall hostitele (`accel-hostfw`)
 * a jeho lane je otevřená. Jen pro ně platí očekávání odvozená z jeho deklarací
 * (lib/accel-deklarace.mjs) a z deklarované proxy serveru (lib/sloty-serveru.mjs).
 *
 * TCP porty: 22, 80, 443, 8080, 8000 VŽDY + TCP porty, které aplikace na serveru
 * publikují (`ports_mappings` a `ports:` compose, který Coolify u aplikace drží)
 * + port SSH do CI VM z deklarace instance (ACCEL_CI_VM_SSH_PORT, výklad
 * lib/accel-deklarace.mjs `portCiVm`): nepublikuje ho žádná aplikace, takže bez
 * deklarace by ho sonda nikdy nezkusila. Výslovné `zadna` = na hostiteli žádná
 * CI VM není: port se neměří a výstup to řekne. Chybějící nebo jiná hodnota =
 * NEZMĚŘENO s důvodem, ne tiché vynechání.
 *
 * Očekávání (TCP):
 *   • 22 — podle deklarace uzlu ACCEL_FW_SSH (lib/accel-deklarace.mjs sshFirewallu):
 *     `svet` = SSH hostitele otevřené komukoli (přístup hlídá sshd klíčem), tedy
 *     otevřený odevšad a zavřený je neshoda s deklarací; `sprava` = enforce:
 *     otevřený PRÁVĚ TEHDY, když odchozí IP stanoviště leží v adresách správy
 *     (ACCEL_FW_ADMIN_CIDRS). CI runner odchází přes adresu správy, takže z něj je
 *     22 otevřený LEGITIMNĚ; z cizí sítě zavřený. measure: otevřený smí být
 *     odkudkoli (enforce ještě neběží) — varování, ne nález.
 *   • port SSH do CI VM — otevřený smí být JEN ze stanoviště v adresách správy
 *     (drží ho tabulka CI VM, ne hostfw, takže na režimu firewallu nezáleží);
 *     otevřený odjinud = FAIL.
 *   • vše ostatní — ze stanoviště MIMO správcovské adresy zavřené (odmítnuto nebo
 *     bez odpovědi), otevřený = FAIL. Ze stanoviště VE správcovských adresách smí
 *     být otevřené (deklarace uzlu: všechny ostatní příchozí porty, i publikované
 *     kontejnery, jen ze správy) — vystavení světu z něj změřit nejde, publikované
 *     porty měří kontrola na uzlu. Slot s proxy `none` a otevřeným 80/443 je nález
 *     odkudkoli (proxy serveru pořád běží a odpovídá).
 *
 * UDP se NESONDUJE: ticho zvenku neodliší „zahozeno" od „nedoručeno". Místo sondy
 * platí pravidlo s MĚŘENÝM vstupem (`posudUdpPort`): UDP port, který aplikace na
 * serveru publikuje, je vystavený, kdykoli firewall hostitele nezahazuje — tedy
 * ve stavu MERENI nebo VRACENO (a když nenaběhl vůbec); ve stavu VYNUCENO ne.
 * Jediná výjimka je DEKLAROVANÝ UDP port meshe (ACCEL_FW_UDP_MESH_PORT), který
 * firewall propouští v každém režimu — a výstup ji řekne; bez deklarace výjimka
 * není (UDP na uzlu zavřeno, mesh v1 jede přes relay TCP 443). Stav firewallu se bere MĚŘENÝ na uzlu
 * (lib/kontejnery-uzlu.mjs, healthcheck kontejneru), deklarovaný režim jen
 * doplňuje hlášku; když stav změřit nejde, je to NEZMĚŘENO. Pravidlo bere porty
 * z aplikací COOLIFY — kontejner mimo Coolify nevidí; ten pokrývá kontrola na uzlu.
 *
 * Kontrola kontejnerů na uzlu (lib/kontejnery-uzlu.mjs) běží v téže fázi a jako
 * jediná nevidí „firewall zakrývá, co je publikované" jako zelenou: KAŽDÝ port
 * publikovaný mimo loopback a mimo deklaraci uzlu (jediná výjimka UDP port meshe)
 * je nález bez ohledu na režim firewallu i na jméno kontejneru — TCP i UDP,
 * kontejner proxy serveru i kterýkoli jiný, v Coolify i mimo něj.
 *
 * Stanoviště musí znát svou ODCHOZÍ IP (`--odchozi-ip`, nebo `--echo-url`, které
 * ji vrátí jako text). Bez ní NEMĚŘENO: očekávání pro 22 nejde odvodit a hairpin
 * nejde vyloučit. HAIRPIN = měření z téhož hostitele (CI VM na GPU uzlu odchází
 * přes jeho vlastní veřejnou IP): provoz nejde přes veřejné rozhraní, pravidla
 * INPUT veřejného rozhraní se ho netýkají — výsledek není pohled z cizí sítě,
 * proto se ODMÍTNE (odchozí IP = IP uzlu, nebo IP uzlu na vlastním rozhraní).
 *
 * CLI:
 *   node vnejsi-expozice.mjs [--odchozi-ip <ip> | --echo-url <url>] [--env-soubor <soubor>] [--json]
 *   kód 0 = vše podle očekávání · 1 = nález (expozice) · 2 = NEMĚŘENO · 3 = změřeno jen zčásti
 *   Řádky výstupu: `✓ ` shoda · `✗ ` nález · `? ` neměřeno · `· ` informace.
 */
import { connect, isIP } from "node:net";
import { networkInterfaces } from "node:os";
import { isDirectRun } from "./cli-entry.mjs";
import { DEKLARACE_PORTU_CI_VM, adresaVCidrech, deklaraceFirewallu, portCiVm, udpPortMeshe } from "./accel-deklarace.mjs";
import { ctenarHodnot, nactiKatalog, podminkaSplnena } from "./provision-gate.mjs";
import { klicUuidSlotu, nactiSloty, proxySlotu, uuidSlotu } from "./sloty-serveru.mjs";

export const SLUZBA_FIREWALLU = "accel-hostfw";
export const PORTY_VZDY = Object.freeze([22, 80, 443, 8080, 8000]);

/** Měřený stav firewallu, ve kterém hostfw zbytek ZAHAZUJE (enforce potvrzený, pravidla na místě). */
export const STAV_ZAHAZUJE = "VYNUCENO";
/**
 * Měřené stavy, ve kterých hostfw NEZAHAZUJE nic: measure jen počítá, po návratu
 * z nepotvrzeného enforce jsou vlastní řetězce sundané, po selhání a v náhledu
 * žádná pravidla nejsou. Publikovaný UDP port je v nich vystavený.
 */
export const STAVY_BEZ_ZAHAZOVANI = Object.freeze(["MERENI", "VRACENO", "SELHALO", "NAHLED"]);

/** Rozsahy, ze kterých IP uzlu není pohled z internetu (LAN, CGNAT/mesh, loopback, link-local). */
const NEVEREJNE = Object.freeze([
  "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16",
  "fc00::/7", "fe80::/10", "::1/128",
]);

/** Sloty s firewallem hostitele a otevřenou lane. */
export function slotyFirewallu({ sluzby, cti }) {
  const s = sluzby?.[SLUZBA_FIREWALLU];
  if (!s?.placement || !podminkaSplnena(s.provision_when_env, cti)) return [];
  return [s.placement];
}

/** `ports_mappings` („8080:80,5000:5000/udp,127.0.0.1:9000:9000") → TCP porty na hostiteli. */
export function tcpPortyMapovani(mapovani) {
  const out = [];
  for (const kus of String(mapovani ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    if (/\/udp$/i.test(kus)) continue;
    const casti = kus.replace(/\/tcp$/i, "").split(":");
    if (casti.length < 2) continue;
    out.push(...rozsahPortu(casti[casti.length - 2]));
  }
  return out;
}

function rozsahPortu(t) {
  const m = /^(\d+)(?:-(\d+))?$/.exec(String(t).trim());
  if (!m) return [];
  const od = Number(m[1]);
  const po = Number(m[2] ?? m[1]);
  if (po - od > 64) return [od]; // rozsah stovek portů se neproklepává — stačí jeho začátek jako vzorek nálezu
  return Array.from({ length: po - od + 1 }, (_, i) => od + i);
}

/** Publikované TCP porty compose (nad hodnotami aplikace); služba za vypnutým profilem se nepočítá. */
export async function tcpPortyCompose(text, cti) {
  const { parse } = await import("yaml");
  const { interpoluj } = await import("./dvere-soulad.mjs");
  const dok = parse(text);
  const zapnute = new Set(String(cti("COMPOSE_PROFILES") ?? "").split(",").map((x) => x.trim()).filter(Boolean));
  const out = [];
  for (const s of Object.values(dok?.services ?? {})) {
    const prof = Array.isArray(s?.profiles) ? s.profiles : [];
    if (prof.length && !prof.some((p) => zapnute.has(p))) continue;
    for (const p of s?.ports ?? []) {
      if (typeof p === "string") {
        if (/\/udp$/i.test(p)) continue;
        const casti = interpoluj(p, cti).replace(/\/tcp$/i, "").split(":");
        if (casti.length >= 2) out.push(...rozsahPortu(casti[casti.length - 2]));
      } else if (p && typeof p === "object" && p.protocol !== "udp" && p.published !== undefined) {
        out.push(...rozsahPortu(interpoluj(String(p.published), cti)));
      }
    }
  }
  return out;
}

/** Je aplikace na tomhle serveru? Coolify ji vede na `destination.server(_id)`. */
export function naServeru(app, server) {
  const d = app?.destination;
  if (!d) return null;
  if (d.server?.uuid !== undefined && server.uuid !== undefined) return d.server.uuid === server.uuid;
  if (d.server_id !== undefined && server.id !== undefined) return String(d.server_id) === String(server.id);
  if (d.server?.name !== undefined && server.name !== undefined) return d.server.name === server.name;
  return null;
}

/**
 * Očekávaný stav TCP portu.
 *
 * `smi-otevreno` = otevřený i zavřený je v pořádku (port SSH do CI VM ze
 * stanoviště ve správě: virtuální stroj nemusí běžet, ale správa na něj smí).
 *
 * @param {number} port
 * @param {{ rezim: "measure"|"enforce"|null, ssh?: "svet"|"sprava"|null, odchoziVSprave: boolean, portSshCiVm?: number|null }} kontext
 * @returns {{ ocekavam: "otevreno"|"zavreno"|"libovolne"|"smi-otevreno", proc: string }}
 */
export function ocekavani(port, { rezim, ssh = null, odchoziVSprave, portSshCiVm = null }) {
  if (port === 22) {
    if (rezim === null) return { ocekavam: "libovolne", proc: "deklarace firewallu neplatná — firewall neběží, očekávání pro SSH nejde odvodit" };
    if (ssh === "svet") return { ocekavam: "otevreno", proc: "SSH hostitele je deklarované světu (ACCEL_FW_SSH=svet — přístup hlídá sshd klíčem)" };
    if (odchoziVSprave) return { ocekavam: "otevreno", proc: "odchozí IP stanoviště je v adresách správy" };
    if (rezim === "measure") return { ocekavam: "libovolne", proc: "measure — enforce ještě neběží, SSH smí být otevřený odkudkoli" };
    return { ocekavam: "zavreno", proc: "enforce a stanoviště není v adresách správy" };
  }
  if (portSshCiVm !== null && port === portSshCiVm) {
    // Drží ho tabulka CI VM (DNAT jen z adres správy), ne hostfw — režim firewallu
    // tu nerozhoduje. Bez platných adres správy očekávání odvodit nejde.
    if (rezim === null) return { ocekavam: "libovolne", proc: "port SSH do CI VM — deklarace firewallu neplatná, adresy správy neznám" };
    if (odchoziVSprave) return { ocekavam: "smi-otevreno", proc: "port SSH do CI VM, stanoviště je v adresách správy (odtud otevřený být smí)" };
    return { ocekavam: "zavreno", proc: "port SSH do CI VM smí být otevřený jen z adres správy a stanoviště v nich není" };
  }
  if (rezim !== null && odchoziVSprave) {
    return { ocekavam: "smi-otevreno", proc: "stanoviště je ve správcovských adresách — deklarace uzlu mu pouští každý port; vystavení světu odsud změřit nejde (publikované porty měří kontrola na uzlu)" };
  }
  return { ocekavam: "zavreno", proc: "uzel nic veřejně nevystavuje (vše meshem)" };
}

/**
 * Příchozí UDP port meshe, který firewall hostitele propouští — z deklarace uzlu
 * (ACCEL_FW_UDP_MESH_PORT, výklad má jeden domov: lib/accel-deklarace.mjs udpPortMeshe).
 * Nedeklarovaný nebo vadný = `null`: výjimka se neuplatní (vadnou deklaraci hlásí
 * posudek firewallu — s ní firewall nenaběhne).
 */
export function portMeshe(cti) {
  return udpPortMeshe(cti).port;
}

/**
 * Pravidlo o publikovaném UDP portu (ne sonda): vystavený je, kdykoli firewall
 * hostitele NEZAHAZUJE. Rozhoduje MĚŘENÝ stav firewallu na uzlu; jediná výjimka
 * je port meshe, který firewall propouští v každém režimu. Rozsah je výjimka,
 * jen když je to PRÁVĚ port meshe — širší rozsah kolem něj vystavuje i sousedy.
 *
 * @param {{ od: number, do: number }} rozsah publikované UDP porty na hostiteli
 * @param {{ stavFirewallu: string|null, meshPort: number|null }} kontext
 * @returns {{ druh: "vyjimka"|"zahazuje"|"nalez"|"nemereno" }}
 */
export function posudUdpPort(rozsah, { stavFirewallu, meshPort }) {
  if (meshPort !== null && rozsah.od === meshPort && rozsah.do === meshPort) return { druh: "vyjimka" };
  if (stavFirewallu === STAV_ZAHAZUJE) return { druh: "zahazuje" };
  if (STAVY_BEZ_ZAHAZOVANI.includes(stavFirewallu)) return { druh: "nalez" };
  return { druh: "nemereno" };
}

/** TCP connect: otevreno | odmitnuto | bez-odpovedi | nedosazitelne | chyba. */
export function tcpSonda(host, port, timeoutMs = 4000) {
  return new Promise((ok) => {
    const s = connect({ host, port });
    const hotovo = (v) => {
      s.removeAllListeners();
      s.destroy();
      ok(v);
    };
    s.setTimeout(timeoutMs, () => hotovo("bez-odpovedi"));
    s.once("connect", () => hotovo("otevreno"));
    s.once("error", (e) => {
      if (e.code === "ECONNREFUSED") hotovo("odmitnuto");
      else if (["EHOSTUNREACH", "ENETUNREACH"].includes(e.code)) hotovo("nedosazitelne");
      else if (e.code === "ETIMEDOUT") hotovo("bez-odpovedi");
      else hotovo(`chyba:${e.code ?? e.message}`);
    });
  });
}

function vlastniAdresy() {
  return Object.values(networkInterfaces()).flat().filter(Boolean).map((i) => i.address);
}

/**
 * Změří uzly s firewallem hostitele.
 *
 * Pořadí u každého uzlu: (1) kontrola kontejnerů NA UZLU (`kontrolaUzlu` — proxy
 * s publikovanými porty, měřený stav firewallu); (2) porty aplikací serveru
 * z Coolify (UDP čte jejich jediný domov, lib/dvere-soulad.mjs); (3) pravidlo
 * o UDP nad měřeným stavem firewallu; (4) deklarace portu SSH do CI VM; (5) TCP
 * sonda. Kroky 1–4 odchozí IP stanoviště nepotřebují — proto běží i tehdy, když
 * TCP sondu změřit nejde.
 *
 * @param {{ coolify: (path: string) => Promise<any>, servers: object, sluzby: object,
 *   cti: (k: string) => string|undefined, odchoziIp: string|null, sonda?: typeof tcpSonda,
 *   adresyStanoviste?: string[],
 *   kontrolaUzlu?: ((slot: string) => Promise<{ vysledek: string, radky: string[],
 *     firewall: { stav: string|null, duvod: string|null } }>)|null }} vstup
 * @returns {Promise<{ radky: string[], kod: number }>}
 */
export async function zmerExpozici({
  coolify, servers, sluzby, cti, odchoziIp, sonda = tcpSonda, adresyStanoviste = vlastniAdresy(),
  kontrolaUzlu = null,
}) {
  const radky = [];
  const nalez = (t) => radky.push(`✗ ${t}`);
  const nemereno = (t) => radky.push(`? ${t}`);
  const shoda = (t) => radky.push(`✓ ${t}`);
  const info = (t) => radky.push(`· ${t}`);
  let mereno = 0;
  let nemerenoN = 0;

  const sloty = slotyFirewallu({ sluzby, cti });
  if (sloty.length === 0) {
    info(`firewall hostitele (${SLUZBA_FIREWALLU}) se nenasazuje (lane zavřená) — žádný uzel k vnějšímu měření`);
    return { radky, kod: 0 };
  }
  const fw = deklaraceFirewallu(cti);
  if (fw.rezim === null) nalez(`deklarace firewallu neplatná — firewall NENABĚHNE: ${fw.chyby.join("; ")}`);
  const odchoziZnama = Boolean(odchoziIp) && isIP(odchoziIp) !== 0;
  const meshPort = portMeshe(cti);
  const { udpPortyCompose, udpPortyMapovani } = await import("./dvere-soulad.mjs");

  for (const slot of sloty) {
    // (1) Kontejnery NA UZLU — nezávisle na API i na stanovišti. Stav firewallu
    // odsud čte pravidlo o UDP; bez kontroly je stav NEZMĚŘEN, ne „asi enforce".
    let firewallUzlu = { stav: null, duvod: "kontrola kontejnerů na uzlu neproběhla" };
    if (kontrolaUzlu) {
      try {
        const u = await kontrolaUzlu(slot);
        radky.push(...u.radky);
        if (u.vysledek === "nemereno") nemerenoN++;
        else mereno++;
        firewallUzlu = u.firewall;
      } catch (e) {
        nemereno(`${slot}: proxy na uzlu NEZMĚŘENA — kontrola kontejnerů selhala (${String(e.message).split("\n")[0]})`);
        nemerenoN++;
      }
    }

    const uuid = uuidSlotu(slot, new Proxy({}, { get: (_, k) => (typeof k === "string" ? cti(k) : undefined) }), servers);
    if (!uuid) {
      nemereno(`${slot}: ${klicUuidSlotu(slot)} nenastaveno — server uzlu neznám`);
      nemerenoN++;
      continue;
    }
    let server;
    try {
      server = await coolify(`/servers/${encodeURIComponent(uuid)}`);
    } catch (e) {
      nemereno(`${slot}: server z Coolify nejde přečíst (${String(e.message).split("\n")[0]})`);
      nemerenoN++;
      continue;
    }

    // (2) Porty, které aplikace na serveru publikují — TCP sondě, UDP pravidlu.
    const proxy = proxySlotu(servers[slot], slot).proxy;
    const porty = new Set(PORTY_VZDY);
    const udp = [];
    try {
      const aplikace = await coolify("/applications");
      if (!Array.isArray(aplikace)) throw new Error("výpis aplikací není pole");
      let bezServeru = 0;
      for (const a of aplikace) {
        const tady = naServeru(a, { ...server, uuid });
        if (tady === null) {
          bezServeru++;
          continue;
        }
        if (!tady) continue;
        for (const p of tcpPortyMapovani(a.ports_mappings)) porty.add(p);
        for (const u of udpPortyMapovani(a.ports_mappings)) udp.push({ od: u.od, do: u.do, aplikace: a.name });
        const raw = a.docker_compose_raw ?? a.docker_compose;
        if (a.build_pack === "dockercompose" && typeof raw === "string" && /\bports:/.test(raw)) {
          try {
            let envy = new Map();
            if (/\$\{?[A-Za-z_]/.test(raw)) {
              const { hodnotyZCoolifyEnvs } = await import("./povinne-promenne.mjs");
              envy = hodnotyZCoolifyEnvs(await coolify(`/applications/${a.uuid}/envs`));
            }
            for (const p of await tcpPortyCompose(raw, (k) => envy.get(k))) porty.add(p);
            for (const u of udpPortyCompose(raw, (k) => envy.get(k))) udp.push({ od: u.od, do: u.do, aplikace: a.name });
          } catch (e) {
            nemereno(`${slot}: porty aplikace ${a.name} nezměřeny (${String(e.message).split("\n")[0]})`);
            nemerenoN++;
          }
        }
      }
      if (bezServeru > 0) info(`${slot}: ${bezServeru} aplikací Coolify bez údaje o serveru — jejich porty neznám (měří se pevná sada)`);
    } catch (e) {
      nemereno(`${slot}: aplikace serveru nejdou přečíst (${String(e.message).split("\n")[0]}) — měří se jen pevná sada portů`);
      nemerenoN++;
    }

    // (3) Pravidlo o UDP (ne sonda). Deklarovaný režim jen doplňuje hlášku.
    const deklarovano = `deklarovaný režim ${fw.rezim ?? "neplatný"}`;
    for (const u of udp.sort((a, b) => a.od - b.od || a.do - b.do)) {
      const port = u.od === u.do ? `${u.od}` : `${u.od}-${u.do}`;
      const kdo = `aplikace ${u.aplikace}`;
      const { druh } = posudUdpPort(u, { stavFirewallu: firewallUzlu.stav, meshPort });
      if (druh === "vyjimka") {
        info(`${slot}: UDP ${port} publikuje ${kdo} — deklarovaný port meshe (ACCEL_FW_UDP_MESH_PORT), jediná povolená výjimka: firewall ho propouští v každém režimu`);
      } else if (druh === "zahazuje") {
        mereno++;
        shoda(`${slot}: UDP ${port} publikuje ${kdo} — firewall na uzlu je ve stavu ${firewallUzlu.stav} (měřeno) a zahazuje ho (pravidlo, UDP se nesonduje)`);
      } else if (druh === "nalez") {
        mereno++;
        nalez(`${slot}: UDP ${port} publikuje ${kdo} a firewall na uzlu je ve stavu ${firewallUzlu.stav} (měřeno; ${deklarovano}) — nezahazuje nic, port je vystavený`);
      } else {
        const proc = firewallUzlu.stav ? `stav ${firewallUzlu.stav} je přechodný nebo neznámý` : firewallUzlu.duvod;
        nemereno(`${slot}: UDP ${port} publikuje ${kdo} — stav firewallu na uzlu NEZMĚŘEN (${proc}); ${deklarovano} stav není, nejde říct, zda port zahazuje`);
        nemerenoN++;
      }
    }

    // (4) Port SSH do CI VM se čte z DEKLARACE. Výslovné „žádná CI VM" se řekne
    // a neměří; cokoli, co vyložit nejde, se nevynechá, ale přizná jako NEZMĚŘENO.
    const ciVm = portCiVm(cti);
    if (ciVm.zadna) {
      info(`${slot}: port SSH do CI VM se neměří — ${DEKLARACE_PORTU_CI_VM.klic}=${DEKLARACE_PORTU_CI_VM.bezCiVm} (na hostiteli uzlu žádná CI VM není)`);
    } else if (ciVm.port === null) {
      nemereno(`${slot}: port SSH do CI VM NEZMĚŘEN — ${ciVm.duvod}`);
      nemerenoN++;
    } else {
      porty.add(ciVm.port);
    }

    // (5) TCP sonda — potřebuje odchozí IP stanoviště a veřejnou IP uzlu.
    if (!odchoziZnama) {
      nemereno(`${slot}: odchozí IP stanoviště neznám (--odchozi-ip / --echo-url) — očekávání pro SSH ani hairpin nejde určit`);
      nemerenoN++;
      continue;
    }
    const ip = String(server?.ip ?? "").trim();
    if (!isIP(ip)) {
      nemereno(`${slot}: Coolify u serveru nevede IP adresu ('${ip}')`);
      nemerenoN++;
      continue;
    }
    if (adresaVCidrech(ip, NEVEREJNE)) {
      nemereno(`${slot}: IP uzlu v Coolify není veřejná (${ip}) — pohled z internetu tím nezměřím`);
      nemerenoN++;
      continue;
    }
    if (odchoziIp === ip || adresyStanoviste.includes(ip)) {
      nemereno(`${slot}: HAIRPIN — stanoviště odchází přes IP uzlu (${ip}), měřilo by se zevnitř hostitele, ne z cizí sítě; odmítnuto`);
      nemerenoN++;
      continue;
    }

    const vSprave = fw.rezim !== null && adresaVCidrech(odchoziIp, [...fw.cidrs4, ...fw.cidrs6]);
    info(`${slot}: uzel ${ip}, stanoviště ${odchoziIp} (${vSprave ? "v adresách správy" : "mimo adresy správy"}), režim ${fw.rezim ?? "?"}, SSH ${fw.ssh ?? "?"}, proxy ${proxy ?? "nedeklarována"}`);
    const seznam = [...porty].sort((a, b) => a - b);
    const stavy = await Promise.all(seznam.map((p) => sonda(ip, p)));
    seznam.forEach((port, i) => {
      const stav = stavy[i];
      const { ocekavam, proc } = ocekavani(port, { rezim: fw.rezim, ssh: fw.ssh, odchoziVSprave: vSprave, portSshCiVm: ciVm.port });
      const otevreno = stav === "otevreno";
      if (stav.startsWith("chyba:")) {
        nemereno(`${slot}: TCP ${port} — sonda selhala (${stav})`);
        nemerenoN++;
        return;
      }
      mereno++;
      if (ocekavam === "otevreno" && !otevreno) {
        nalez(`${slot}: TCP ${port} ${stav} — ${proc}, ${port === 22 && fw.ssh === "svet" && !vSprave ? "ale zvenku zavřený (neshoda s deklarací)" : "správa by se NEDOSTALA (zamčeno?)"}`);
      } else if (proxy === "none" && (port === 80 || port === 443) && otevreno) {
        // Odkudkoli, i ze správy: na slotu s proxy `none` nemá na 80/443 co odpovídat.
        nalez(`${slot}: TCP ${port} OTEVŘENÝ na slotu s proxy 'none' — proxy serveru pořád běží a odpovídá${vSprave ? " (stanoviště ve správě)" : " (je veřejná)"}`);
      } else if (ocekavam === "zavreno" && otevreno) {
        nalez(`${slot}: TCP ${port} OTEVŘENÝ zvenku — ${proc}`);
      } else if (ocekavam === "libovolne" && otevreno) {
        radky.push(`? ${slot}: TCP ${port} otevřený — ${proc}`);
      } else if (ocekavam === "smi-otevreno") {
        shoda(`${slot}: TCP ${port} ${stav} — ${proc}`);
      } else {
        shoda(`${slot}: TCP ${port} ${stav} (${ocekavam === "otevreno" ? "otevřený" : "zavřený"} podle očekávání)`);
      }
    });
  }
  const kod = radky.some((r) => r.startsWith("✗")) ? 1 : mereno === 0 ? 2 : nemerenoN > 0 || radky.some((r) => r.startsWith("?")) ? 3 : 0;
  return { radky, kod };
}

/** Odchozí IP: výslovně, nebo z echo služby (vrací adresu jako text). */
export async function odchoziAdresa({ odchoziIp, echoUrl, fetchFn = fetch }) {
  if (odchoziIp) return isIP(odchoziIp) ? odchoziIp : null;
  if (!echoUrl) return null;
  try {
    const r = await fetchFn(echoUrl, { signal: AbortSignal.timeout(10_000) });
    const t = (await r.text()).trim();
    return r.ok && isIP(t) ? t : null;
  } catch {
    return null;
  }
}

if (isDirectRun(import.meta.url)) {
  const argv = process.argv.slice(2);
  const hodnota = (p) => {
    const i = argv.indexOf(p);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const json = argv.includes("--json");
  (async () => {
    const cti = ctenarHodnot(hodnota("--env-soubor"));
    const baseUrl = process.env.COOLIFY_BASE_URL || process.env.COOLIFY_URL;
    const token = process.env.COOLIFY_API_TOKEN || process.env.COOLIFY_API_KEY;
    const sluzby = nactiKatalog();
    const servers = nactiSloty();
    // Bez Coolify se neodchází: kontrola kontejnerů NA UZLU API nepotřebuje a měří se
    // i tak; co na API stojí (IP uzlu, porty aplikací), se přizná jako NEMĚŘENO.
    const { createCoolifyClient } = await import("./coolify-http.mjs");
    const coolify = baseUrl && token
      ? createCoolifyClient({ baseUrl, token, timeoutMs: 30_000, maxRetries: 2 })
      : async () => { throw new Error("chybí COOLIFY_URL nebo COOLIFY_API_TOKEN"); };
    const odchoziIp = await odchoziAdresa({ odchoziIp: hodnota("--odchozi-ip"), echoUrl: hodnota("--echo-url") });
    const { zmerUzel } = await import("./kontejnery-uzlu.mjs");
    const kontrolaUzlu = (slot) => zmerUzel({ slot, servers, sluzby, cti });
    const { radky, kod } = await zmerExpozici({ coolify, servers, sluzby, cti, odchoziIp, kontrolaUzlu });
    if (json) process.stdout.write(`${JSON.stringify({ kod, radky }, null, 2)}\n`);
    else for (const r of radky) console.log(r);
    return kod;
  })().then(
    (kod) => process.exit(kod),
    (e) => {
      console.log(`? vnější expozice NEMĚŘENA: ${e.message}`);
      process.exit(2);
    },
  );
}
