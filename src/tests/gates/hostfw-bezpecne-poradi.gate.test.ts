/**
 * Brána: hostitelský firewall uzlu `gpu` drží BEZPEČNÉ POŘADÍ a sahá jen na SVÉ.
 *
 * Měří se PLÁN, který hostfw.sh sám vydá v DRY_RUN (`--plan`) nad simulovaným
 * hostitelem (lib/hostfw-postroj.ts) — tedy totéž, co by šlo do
 * `iptables-restore --noflush` a do skoků, ne odhad z textu skriptu.
 *
 * Vlastnosti (každá s mutací, která ji poruší — zelená bez mutace nic nedokazuje):
 *   1. v každém vlastním řetězci: povolení (RETURN/ACCEPT) PŘED jediným DROP na
 *      konci; pořadí lo → ESTABLISHED,RELATED → ICMP → SSH ze správy → (SSH světu) →
 *      cokoli ze správy → (UDP meshe) → zbytek; SSH ze správy PŘED „cokoli ze správy"
 *      (jeho čítač potvrzuje enforce),
 *   2. SSH 22 bez zdroje JEN s deklarací ACCEL_FW_SSH=svet (právě jedno pravidlo, jen
 *      tcp/22, jen IN); pravidel SSH ze správy tolik, kolik je adres správy dané
 *      rodiny; jiné povolení bez zdroje než lo/ESTABLISHED/ICMP/deklarovaný mesh neexistuje
 *      („světu" omylem pro jiný port = vada),
 *   2c. UDP port meshe JEN s deklarací uzlu ACCEL_FW_UDP_MESH_PORT (nejmenší oprávnění,
 *      mesh v1 jede přes relay TCP 443): bez deklarace žádné UDP pravidlo, s ní právě
 *      jedno pro ten port v IN i FWD,
 *   2b. „cokoli ze správy" v IN i FWD (publikované porty kontejnerů jdou přes
 *      DOCKER-USER, mimo INPUT): pravidel tolik, kolik je adres správy dané rodiny,
 *   3. prázdné / vadné adresy správy nebo neznámý režim: plán se NEVYDÁ (kód ≠ 0)
 *      a v něm žádný DROP — fail-closed znamená „nenaběhne", ne „zamkne správu",
 *   4. dvojče IPv6 (packet-too-big, objevování sousedů) i bez veřejné IPv6,
 *   5. jen vlastní řetězce: restore deklaruje a plní jen AISHA-HOSTFW-*, skok z INPUT
 *      jen veřejného rozhraní, do DOCKER-USER jen skok podmíněný dockerovým mostem,
 *   6. ve zdrojáku žádný literál IP ani jméno rozhraní hostitele, restore jen s
 *      `--noflush`, žádné `nft`, žádná jiná tabulka než filter.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { HOSTFW, MESH_PORT, ROZHRANI, plan, postroj } from "./lib/hostfw-postroj";

const VLASTNI = ["AISHA-HOSTFW-IN", "AISHA-HOSTFW-FWD"];
const POVOLENI = /-j (RETURN|ACCEPT)$/;

type Sekce = { rodina: "4" | "6"; restore: string[]; skoky: string[] };

/** Plán → sekce po rodinách (restore payload a skoky). */
function sekce(text: string): Sekce[] {
  const out: Sekce[] = [];
  let cur: Sekce | null = null;
  let cast: "restore" | "skoky" = "restore";
  for (const radek of text.split("\n")) {
    const h = /^# --- IPv([46]): (\S+)/.exec(radek);
    if (h) {
      const rodina = h[1] as "4" | "6";
      if (!cur || cur.rodina !== rodina) {
        cur = { rodina, restore: [], skoky: [] };
        out.push(cur);
      }
      cast = h[2].startsWith("iptables-restore") ? "restore" : "skoky";
      continue;
    }
    if (!cur || !radek.trim() || radek.startsWith("[hostfw]")) continue;
    cur[cast].push(radek.trim());
  }
  return out;
}

/** Porušení vlastností 1, 2, 4, 5 v plánu. Prázdné = plán je bezpečný. */
export function posudPlan(
  text: string,
  spravy: { "4": number; "6": number },
  rezim: "measure" | "enforce",
  sshVolba: "svet" | "sprava" = "sprava",
  udpMesh: string | null = null,
): string[] {
  const vady: string[] = [];
  const s = sekce(text);
  for (const rod of ["4", "6"] as const) {
    if (!s.some((x) => x.rodina === rod)) vady.push(`IPv${rod}: plán nemá sekci (dvojče chybí)`);
  }
  for (const { rodina, restore, skoky } of s) {
    const kde = `IPv${rodina}`;
    if (restore[0] !== "*filter" || restore.at(-1) !== "COMMIT") vady.push(`${kde}: restore není jediná tabulka filter s COMMIT`);
    for (const r of restore) {
      if (r.startsWith("*") && r !== "*filter") vady.push(`${kde}: restore sahá na tabulku ${r}`);
      const dekl = /^:(\S+)/.exec(r);
      if (dekl && !VLASTNI.includes(dekl[1])) vady.push(`${kde}: restore deklaruje (= vyprázdní) cizí řetězec ${dekl[1]}`);
      const a = /^-([AIDFXPN]) (\S+)/.exec(r);
      if (a && !VLASTNI.includes(a[2])) vady.push(`${kde}: restore píše do cizího řetězce ${a[2]}: ${r}`);
      if (/^-[DFXPN] /.test(r)) vady.push(`${kde}: restore maže/mění řetězec: ${r}`);
    }
    for (const ret of VLASTNI) {
      const pr = restore.filter((r) => r.startsWith(`-A ${ret} `));
      if (pr.length === 0) {
        vady.push(`${kde}: ${ret} je prázdný`);
        continue;
      }
      const drop = pr.map((r, i) => (/-j DROP$/.test(r) ? i : -1)).filter((i) => i >= 0);
      if (rezim === "measure" && drop.length) vady.push(`${kde}: ${ret} má v režimu measure DROP`);
      if (rezim === "enforce" && (drop.length !== 1 || drop[0] !== pr.length - 1)) {
        vady.push(`${kde}: ${ret} nemá DROP jako jediné a poslední pravidlo`);
      }
      const posledni = pr.at(-1)!;
      if (!/--comment aisha-hostfw:zbytek -j (DROP|RETURN)$/.test(posledni)) vady.push(`${kde}: ${ret} nekončí pravidlem zbytku`);
      pr.slice(0, -1).forEach((r) => {
        if (!POVOLENI.test(r)) vady.push(`${kde}: ${ret} má před koncem pravidlo, které nepovoluje: ${r}`);
      });
      const idx = (re: RegExp) => pr.findIndex((r) => re.test(r));
      const est = idx(/--ctstate ESTABLISHED,RELATED/);
      const icmp = idx(/-p (ipv6-)?icmp /);
      const ssh = idx(/--dport 22 /);
      const mesh = idx(/aisha-hostfw:mesh/);
      // 2c: UDP pravidla (mesh) jen s deklarací, právě jedno, právě ten port.
      const udpPr = pr.filter((r) => /-p udp /.test(r));
      if (udpMesh === null && udpPr.length) vady.push(`${kde}: ${ret} pouští UDP bez deklarace ACCEL_FW_UDP_MESH_PORT: ${udpPr.join(" | ")}`);
      if (udpMesh !== null) {
        const ocekavany = ret === "AISHA-HOSTFW-IN" ? `-p udp --dport ${udpMesh} ` : `-p udp -m conntrack --ctorigdstport ${udpMesh} `;
        if (udpPr.length !== 1 || !udpPr[0].includes(ocekavany)) vady.push(`${kde}: ${ret} nemá právě jedno UDP pravidlo pro deklarovaný port ${udpMesh} (má: ${udpPr.join(" | ") || "nic"})`);
      }
      const zeSpravy = pr.filter((r) => /--comment aisha-hostfw:ze-spravy -j RETURN$/.test(r));
      // Povolení BEZ zdrojové adresy smí být jen tyto třídy — cokoli jiného je port otevřený světu.
      const bezZdroje = pr.slice(0, -1).filter((r) => !/ -s \S+ /.test(r));
      const dovolenoBezZdroje = (r: string) =>
        /^-A \S+ -i lo /.test(r) ||
        /--ctstate ESTABLISHED,RELATED /.test(r) ||
        /-p (ipv6-)?icmp /.test(r) ||
        (udpMesh !== null && /aisha-hostfw:mesh -j RETURN$/.test(r) && new RegExp(`-p udp (--dport|-m conntrack --ctorigdstport) ${udpMesh} `).test(r)) ||
        (ret === "AISHA-HOSTFW-IN" && sshVolba === "svet" && /^-A AISHA-HOSTFW-IN -p tcp --dport 22 -m comment --comment aisha-hostfw:ssh-svet -j RETURN$/.test(r));
      for (const r of bezZdroje.filter((x) => !dovolenoBezZdroje(x))) vady.push(`${kde}: ${ret} povolení bez zdrojové adresy (port otevřený světu): ${r}`);
      if (zeSpravy.length !== spravy[rodina]) {
        vady.push(`${kde}: ${ret} nepouští ostatní porty ze správcovských adres (${zeSpravy.length} pravidel, adres ${spravy[rodina]})${ret === "AISHA-HOSTFW-FWD" ? " — publikované porty kontejnerů jdou přes DOCKER-USER, mimo INPUT" : ""}`);
      }
      if (zeSpravy.some((r) => /--dport|-p /.test(r))) vady.push(`${kde}: ${ret} „cokoli ze správy" omezené na port/protokol`);
      if (est < 0) vady.push(`${kde}: ${ret} nepropouští navázaná spojení`);
      if (icmp < 0) vady.push(`${kde}: ${ret} nepropouští ICMP (PMTU)`);
      // F2: první pravidlo nese identitu vlastníka uzlu — jen podle ní pozná firewall jiného forku cizí řetězce.
      const vlastnici = pr.map((r) => /--comment aisha-hostfw:vlastnik:([a-z0-9-]+) /.exec(r)?.[1]).filter(Boolean);
      if (vlastnici.length !== 1 || !/--comment aisha-hostfw:vlastnik:/.test(pr[0])) vady.push(`${kde}: ${ret} nenese identitu vlastníka uzlu v prvním pravidle (právě jednou)`);
      if (ret === "AISHA-HOSTFW-IN") {
        if (!/^-A AISHA-HOSTFW-IN -i lo /.test(pr[0])) vady.push(`${kde}: IN nezačíná lo`);
        if (!(est < icmp && (ssh < 0 || icmp < ssh) && (mesh < 0 || ((ssh < 0 || ssh < mesh) && icmp < mesh)))) {
          vady.push(`${kde}: IN nedrží pořadí lo → ESTABLISHED → ICMP → SSH → mesh → zbytek`);
        }
        const sshPr = pr.filter((r) => /--dport 22\b/.test(r));
        const sshSvet = sshPr.filter((r) => !/ -s \S+ /.test(r));
        const sshSprava = sshPr.filter((r) => / -s \S+ /.test(r) && /--comment aisha-hostfw:sprava -j RETURN$/.test(r));
        if (sshVolba === "sprava" && sshSvet.length) vady.push(`${kde}: SSH 22 bez zdrojové adresy (z celého internetu), ačkoli deklarace říká jen ze správy`);
        if (sshVolba === "svet" && sshSvet.length !== 1) vady.push(`${kde}: deklarace SSH světu, ale pravidel SSH bez zdroje je ${sshSvet.length} (má být právě jedno)`);
        if (sshSprava.length !== spravy[rodina]) vady.push(`${kde}: ${sshSprava.length} pravidel SSH ze správy, adres správy ${spravy[rodina]}`);
        const posledniSshSpravy = pr.map((r, i) => (sshSprava.includes(r) ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
        const prvniZeSpravy = pr.findIndex((r) => zeSpravy.includes(r));
        if (prvniZeSpravy >= 0 && posledniSshSpravy > prvniZeSpravy) {
          vady.push(`${kde}: SSH ze správy až za „cokoli ze správy" — čítač potvrzení enforce by nerostl a firewall by se vrátil`);
        }
        if (udpMesh !== null && pr.some((r) => new RegExp(`--dport ${udpMesh}\\b`).test(r) && !/-p udp/.test(r))) vady.push(`${kde}: port meshe povolen jinak než UDP`);
      } else {
        if (pr.some((r) => /--dport 22\b/.test(r))) vady.push(`${kde}: FWD propouští SSH do kontejnerů`);
        if (pr.some((r) => /ssh-svet/.test(r))) vady.push(`${kde}: „SSH světu" v FWD — světu smí jen SSH hostitele, ne port kontejneru`);
        if (!(est < icmp && (mesh < 0 || icmp < mesh))) vady.push(`${kde}: FWD nedrží pořadí ESTABLISHED → ICMP → mesh → zbytek`);
      }
      if (rodina === "6") {
        if (!pr.some((r) => /packet-too-big/.test(r))) vady.push(`${kde}: ${ret} bez packet-too-big (PMTU IPv6)`);
        if (ret === "AISHA-HOSTFW-IN" && !pr.some((r) => /neighbour-solicitation/.test(r))) vady.push(`${kde}: IN bez objevování sousedů`);
      }
    }
    const zIn = skoky.filter((k) => / INPUT /.test(` ${k} `));
    const zDu = skoky.filter((k) => / DOCKER-USER /.test(` ${k} `));
    if (zIn.length !== 1 || !new RegExp(`^-I INPUT 1 -i ${ROZHRANI} .*-j AISHA-HOSTFW-IN$`).test(zIn[0] ?? "")) {
      vady.push(`${kde}: skok z INPUT není právě jeden, z veřejného rozhraní do AISHA-HOSTFW-IN`);
    }
    if (zDu.length === 0) vady.push(`${kde}: chybí skok z DOCKER-USER`);
    for (const k of zDu) {
      if (!/ -o (docker0|br-\+) /.test(` ${k} `)) vady.push(`${kde}: skok z DOCKER-USER bez podmínky dockerového mostu: ${k}`);
      if (!/-j AISHA-HOSTFW-FWD$/.test(k)) vady.push(`${kde}: DOCKER-USER skáče jinam než do AISHA-HOSTFW-FWD: ${k}`);
    }
    for (const k of skoky) {
      if (!/^-I (INPUT|DOCKER-USER) 1 /.test(k)) vady.push(`${kde}: skok do řetězce, který hostfw nesmí: ${k}`);
    }
  }
  return vady;
}

const SPRAVY = { "4": 2, "6": 1 }; // lib/hostfw-postroj.ts SPRAVA: dvě IPv4, jedna IPv6

describe("hostfw: bezpečné pořadí a jen vlastní řetězce (plán z DRY_RUN)", () => {
  const p = postroj();
  const enforce = plan(p, { ACCEL_FW_MODE: "enforce" });
  const measure = plan(p, { ACCEL_FW_MODE: "measure" });
  const svet = plan(p, { ACCEL_FW_MODE: "enforce", ACCEL_FW_SSH: "svet" });
  const sUdp = plan(p, { ACCEL_FW_MODE: "enforce", ACCEL_FW_UDP_MESH_PORT: MESH_PORT });

  it("univerzum: plán se vydal pro obě rodiny a oba režimy; identita vlastníka uzlu je ta z deklarace", () => {
    expect(enforce.out.match(/aisha-hostfw:vlastnik:vrstva-a /g)?.length, "IN + FWD × IPv4 + IPv6").toBe(4);
    expect(enforce.kod, enforce.err).toBe(0);
    expect(measure.kod, measure.err).toBe(0);
    expect(sekce(enforce.out).map((s) => s.rodina)).toEqual(["4", "6"]);
    expect(enforce.out).toMatch(/-j DROP$/m);
  });

  it("enforce: povolení před DROP, pořadí, SSH jen ze správy, dvojče v6, jen vlastní řetězce", () => {
    expect(posudPlan(enforce.out, SPRAVY, "enforce")).toEqual([]);
  });

  it("SSH světu (deklarace uzlu): právě jedno SSH bez zdroje, jen tcp/22, jen IN; zbytek beze změny; KOTVA: sprava ho nemá", () => {
    expect(svet.kod, svet.err).toBe(0);
    expect(posudPlan(svet.out, SPRAVY, "enforce", "svet")).toEqual([]);
    expect(svet.out.match(/aisha-hostfw:ssh-svet/g)?.length, "IPv4 i IPv6").toBe(2);
    expect(enforce.out).not.toMatch(/ssh-svet/);
    // Kotva obou směrů: plán „světu" posuzovaný jako „správa" je vada, a naopak.
    expect(posudPlan(svet.out, SPRAVY, "enforce", "sprava").join("\n")).toMatch(/SSH 22 bez zdrojové adresy/);
    expect(posudPlan(enforce.out, SPRAVY, "enforce", "svet").join("\n")).toMatch(/pravidel SSH bez zdroje je 0/);
  });

  it("UDP meshe jen s deklarací uzlu: bez ACCEL_FW_UDP_MESH_PORT žádné UDP pravidlo (IN ani FWD, obě rodiny); KOTVA: s deklarací právě ten port v IN i FWD", () => {
    expect(enforce.out, "bez deklarace žádné UDP pravidlo").not.toMatch(/-p udp/);
    expect(enforce.out).not.toMatch(/aisha-hostfw:mesh/);
    expect(enforce.err + enforce.out).toMatch(/udp-mesh=zavřeno/);
    expect(sUdp.kod, sUdp.err).toBe(0);
    expect(posudPlan(sUdp.out, SPRAVY, "enforce", "sprava", MESH_PORT)).toEqual([]);
    expect(sUdp.out.match(new RegExp(`-A AISHA-HOSTFW-IN -p udp --dport ${MESH_PORT} `, "g"))?.length, "IN, IPv4 i IPv6").toBe(2);
    expect(sUdp.out.match(new RegExp(`-A AISHA-HOSTFW-FWD -p udp -m conntrack --ctorigdstport ${MESH_PORT} `, "g"))?.length, "FWD, IPv4 i IPv6").toBe(2);
    expect(sUdp.out.match(/-p udp/g)?.length, "žádné jiné UDP").toBe(4);
    // Kotva obou směrů: plán s UDP posuzovaný jako bez deklarace je vada, a naopak.
    expect(posudPlan(sUdp.out, SPRAVY, "enforce").join("\n")).toMatch(/pouští UDP bez deklarace ACCEL_FW_UDP_MESH_PORT/);
    expect(posudPlan(enforce.out, SPRAVY, "enforce", "sprava", MESH_PORT).join("\n")).toMatch(/nemá právě jedno UDP pravidlo pro deklarovaný port/);
  });

  it("measure: tatáž sada, ale ŽÁDNÝ DROP (jen čítač zbytku)", () => {
    expect(posudPlan(measure.out, SPRAVY, "measure")).toEqual([]);
    expect(measure.out).not.toMatch(/-j DROP/);
  });

  it("⛔ prázdné nebo vadné adresy správy a neznámý režim: plán se NEVYDÁ a nikde DROP", () => {
    const vstupy: Array<Record<string, string>> = [
      { ACCEL_FW_ADMIN_CIDRS: "" },
      { ACCEL_FW_ADMIN_CIDRS: "  " },
      { ACCEL_FW_ADMIN_CIDRS: "0.0.0.0/0" },
      { ACCEL_FW_ADMIN_CIDRS: "192.0.2.10/32,nesmysl" },
      { ACCEL_FW_MODE: "" },
      { ACCEL_FW_MODE: "Enforce" },
      { ACCEL_FW_SSH: "" },
      { ACCEL_FW_SSH: "Svet" },
      { ACCEL_FW_SSH: "vsem" },
      // Cizí vlastník uzlu (nebo nedeklarovaný): žádný plán — firewall na cizím uzlu nesmí ani plánovat.
      { ACCEL_FW_NODE_OWNER: "vrstva-b" },
      { ACCEL_FW_NODE_OWNER: "" },
      { ACCEL_OWNER_PREFIX: "vrstva-b" },
      // UDP port meshe vyplněný a vadný = nenaběhne (prázdný je platný stav: UDP zavřeno).
      { ACCEL_FW_UDP_MESH_PORT: "70000" },
      { ACCEL_FW_UDP_MESH_PORT: "0" },
      { ACCEL_FW_UDP_MESH_PORT: "mesh" },
    ];
    for (const extra of vstupy) {
      const r = plan(p, { ACCEL_FW_MODE: "enforce", ...extra });
      expect(r.kod, JSON.stringify(extra)).not.toBe(0);
      expect(r.out, JSON.stringify(extra)).not.toMatch(/DROP/);
    }
    // Cizí vlastník: příčina jménem, a ani řádek plánu.
    const cizi = plan(p, { ACCEL_FW_MODE: "enforce", ACCEL_OWNER_PREFIX: "vrstva-b" });
    expect(cizi.err).toMatch(/ACCEL_OWNER_PREFIX='vrstva-b' NENÍ vlastník uzlu \(ACCEL_FW_NODE_OWNER='vrstva-a'\)/);
    expect(cizi.out).not.toMatch(/^-[AI] /m);
  });

  it("⛔ dvě veřejná rozhraní (v4 a v6 jinudy) neumí — plán se nevydá", () => {
    const r = plan(p, { FALESNA_TRASA6: "default via 2001:db8::1 dev jine0 metric 1024" });
    expect(r.kod).not.toBe(0);
    expect(r.err).toMatch(/dvě veřejná rozhraní/);
  });

  describe("mutace plánu — každá vlastnost musí zčervenat", () => {
    const M: Array<[string, (t: string) => string, RegExp]> = [
      ["DROP před SSH", (t) => t.replace(/(-A AISHA-HOSTFW-IN -s 192\.0\.2\.10\/32)/, "-A AISHA-HOSTFW-IN -j DROP\n$1"), /DROP jako jediné a poslední|nepovoluje/],
      ["SSH bez zdroje", (t) => t.replace(/-A AISHA-HOSTFW-IN -s 192\.0\.2\.10\/32 /, "-A AISHA-HOSTFW-IN "), /SSH 22 bez zdrojové adresy/],
      ["SSH před ESTABLISHED", (t) => t.replace(/(-A AISHA-HOSTFW-IN -m conntrack[^\n]*\n)((?:-A AISHA-HOSTFW-IN -p icmp[^\n]*\n)+)(-A AISHA-HOSTFW-IN -s [^\n]*\n)/, "$3$1$2"), /pořadí/],
      ["chybí ICMP", (t) => t.replace(/^-A AISHA-HOSTFW-FWD -p icmp[^\n]*\n/gm, ""), /ICMP/],
      ["restore vyprázdní DOCKER-USER", (t) => t.replace(":AISHA-HOSTFW-FWD - [0:0]", ":AISHA-HOSTFW-FWD - [0:0]\n:DOCKER-USER - [0:0]"), /cizí řetězec DOCKER-USER/],
      ["pravidlo do FORWARD", (t) => t.replace(/^COMMIT$/m, "-A FORWARD -i verejne0 -j DROP\nCOMMIT"), /cizího řetězce FORWARD/],
      ["skok do DOCKER-USER bez mostu", (t) => t.replace(/ -o docker0 /, " "), /bez podmínky dockerového mostu/],
      ["skok z INPUT bez rozhraní", (t) => t.replace(/-I INPUT 1 -i verejne0 /, "-I INPUT 1 "), /skok z INPUT/],
      ["tabulka nat", (t) => t.replace("*filter", "*nat"), /tabulka filter|tabulku \*nat/],
      ["bez dvojčete v6", (t) => t.slice(0, t.indexOf("# --- IPv6")), /IPv6: plán nemá sekci/],
      ["v6 bez packet-too-big", (t) => t.replace(/^-A AISHA-HOSTFW-IN -p ipv6-icmp --icmpv6-type packet-too-big[^\n]*\n/m, ""), /packet-too-big/],
      ["bez identity vlastníka (F2)", (t) => t.split("aisha-hostfw:vlastnik:vrstva-a").join("aisha-hostfw"), /nenese identitu vlastníka uzlu/],
      ["UDP meshe bez deklarace", (t) => t.replace(/^(-A AISHA-HOSTFW-IN -m comment --comment aisha-hostfw:zbytek)/m, `-A AISHA-HOSTFW-IN -p udp --dport ${MESH_PORT} -m comment --comment aisha-hostfw:mesh -j RETURN\n$1`), /pouští UDP bez deklarace/],
      ["FWD bez správcovských adres (publikované porty jen INPUT)", (t) => t.replace(/^-A AISHA-HOSTFW-FWD -s [^\n]*ze-spravy[^\n]*\n/gm, ""), /FWD nepouští ostatní porty ze správcovských adres/],
      ["IN bez „cokoli ze správy“", (t) => t.replace(/^-A AISHA-HOSTFW-IN -s [^\n]*ze-spravy[^\n]*\n/gm, ""), /IN nepouští ostatní porty ze správcovských adres/],
      ["„cokoli ze správy“ bez zdroje", (t) => t.replace(/-A AISHA-HOSTFW-FWD -s 192\.0\.2\.10\/32 -m comment --comment aisha-hostfw:ze-spravy/, "-A AISHA-HOSTFW-FWD -m comment --comment aisha-hostfw:ze-spravy"), /povolení bez zdrojové adresy/],
      ["čítač: „cokoli ze správy“ před SSH ze správy", (t) => t.replace(/(-A AISHA-HOSTFW-IN -s 192\.0\.2\.10\/32 -p tcp --dport 22 [^\n]*\n)/, "-A AISHA-HOSTFW-IN -s 192.0.2.10/32 -m comment --comment aisha-hostfw:ze-spravy -j RETURN\n$1"), /čítač potvrzení/],
    ];
    it.each(M)("%s", (_jmeno, mutace, ocekavano) => {
      const zmeneny = mutace(enforce.out);
      expect(zmeneny, "mutace se netrefila — měřidlo by testovalo prázdno").not.toBe(enforce.out);
      expect(posudPlan(zmeneny, SPRAVY, "enforce").join("\n")).toMatch(ocekavano);
    });

    const M_SVET: Array<[string, (t: string) => string, RegExp]> = [
      ["„světu“ omylem i pro jiný port (bez --dport)", (t) => t.replace(/-A AISHA-HOSTFW-IN -p tcp --dport 22 -m comment --comment aisha-hostfw:ssh-svet/, "-A AISHA-HOSTFW-IN -p tcp -m comment --comment aisha-hostfw:ssh-svet"), /povolení bez zdrojové adresy/],
      ["„světu“ omylem pro jiný port (8080)", (t) => t.replace(/-A AISHA-HOSTFW-IN -p tcp --dport 22 -m comment --comment aisha-hostfw:ssh-svet/, "-A AISHA-HOSTFW-IN -p tcp --dport 8080 -m comment --comment aisha-hostfw:ssh-svet"), /povolení bez zdrojové adresy|pravidel SSH bez zdroje je 0/],
      ["„světu“ i do kontejnerů (FWD)", (t) => t.replace(/^(-A AISHA-HOSTFW-FWD -m conntrack[^\n]*\n)/m, "$1-A AISHA-HOSTFW-FWD -p tcp --dport 22 -m comment --comment aisha-hostfw:ssh-svet -j RETURN\n"), /SSH světu" v FWD|FWD propouští SSH/],
    ];
    it.each(M_SVET)("SSH světu: %s", (_jmeno, mutace, ocekavano) => {
      const zmeneny = mutace(svet.out);
      expect(zmeneny, "mutace se netrefila — měřidlo by testovalo prázdno").not.toBe(svet.out);
      expect(posudPlan(zmeneny, SPRAVY, "enforce", "svet").join("\n")).toMatch(ocekavano);
    });
  });
});

describe("hostfw.sh: zdroják bez literálů instance a bez cizích zásahů", () => {
  const zdroj = readFileSync(HOSTFW, "utf8");
  const kod = zdroj
    .split("\n")
    .filter((r) => !/^\s*#/.test(r))
    .join("\n");

  /** Porušení vlastnosti 6 nad textem skriptu. */
  function posudZdroj(text: string): string[] {
    const k = text.split("\n").filter((r) => !/^\s*#/.test(r)).join("\n");
    const vady: string[] = [];
    if (/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(k)) vady.push("literál IPv4 adresy");
    if (/\b[0-9a-f]{1,4}(:[0-9a-f]{0,4}){2,7}\b/i.test(k.replace(/\$\{?[A-Za-z_]+\}?/g, ""))) vady.push("literál IPv6 adresy");
    if (/\b(eth|ens|enp|eno|wlan|bond)\d/.test(k)) vady.push("literál jména rozhraní hostitele");
    // Každé volání zvlášť — až do konce příkazu (`;`, `|`, `&`, konec řádku), ne do konce řádku:
    // dvě volání na jednom řádku by jinak jedno `--noflush` „půjčilo" druhému.
    for (const m of k.matchAll(/-restore"?([^;|&\n]*)/g)) if (!/--noflush/.test(m[1])) vady.push(`restore bez --noflush: ${m[0]}`);
    if (/(^|[\s;|&(])nft\s/m.test(k)) vady.push("volá nft (tabulky CI VM jsou cizí)");
    if (/-t (nat|mangle|raw|security)\b/.test(k)) vady.push("jiná tabulka než filter");
    if (/ -P (INPUT|FORWARD|OUTPUT)\b/.test(k)) vady.push("mění politiku vestavěného řetězce");
    for (const m of k.matchAll(/ -([FX]) ("?\$?[A-Za-z_-]+"?)/g)) if (!/RETEZ_|\$ret\b|"\$ret"/.test(m[2])) vady.push(`-${m[1]} na ${m[2]}`);
    return vady;
  }

  it("zdroják je čistý", () => {
    expect(kod.length).toBeGreaterThan(1000);
    expect(posudZdroj(zdroj)).toEqual([]);
  });

  const MUTACE_ZDROJE: Array<[string, (t: string) => string, RegExp]> = [
    ["literál IP", (t: string) => t.replace('ZNACKA="aisha-hostfw"', 'ZNACKA="aisha-hostfw"\nSPRAVA_NAVIC="192.0.2.77"'), /IPv4/],
    ["literál rozhraní", (t: string) => t.replace('ROZHRANI="$r4"', 'ROZHRANI="eth0"'), /rozhraní/],
    ["restore bez --noflush", (t: string) => t.replace('"iptables-$BACKEND-restore" --noflush -w', '"iptables-$BACKEND-restore" -w'), /noflush/],
    ["flush cizího", (t: string) => t.replace('ipt "$r" -F "$ret" || ok=1', 'ipt "$r" -F DOCKER-USER || ok=1'), /-F na DOCKER-USER/],
    ["volání nft", (t: string) => t.replace("v6_v_jadre() {", "v6_v_jadre() { nft list ruleset >/dev/null;"), /nft/],
  ];
  it.each(MUTACE_ZDROJE)("mutace zdrojáku: %s → červená", (_j, mutace, ocekavano) => {
    const z = mutace(zdroj);
    expect(z).not.toBe(zdroj);
    expect(posudZdroj(z).join("\n")).toMatch(ocekavano);
  });
});
