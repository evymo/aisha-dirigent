/**
 * Brána: firewall hostitele GPU uzlu pouští dovnitř PŘESNĚ to, co říká deklarace uzlu
 * (rozhodnutí majitele 2026-10-05) — měřeno CHOVÁNÍM nad vygenerovanou sadou pravidel.
 *
 * Deklarace uzlu (lib/accel-deklarace.mjs, data instance):
 *   (a) SSH hostitele: `ACCEL_FW_SSH=svet` (komukoli — přístup hlídá sshd klíčem, ne
 *       firewall) nebo `sprava` (jen ze správcovských adres). Volba v deklaraci, ne v kódu.
 *   (b) Všechny ostatní příchozí porty jen ze správcovských adres — i porty PUBLIKOVANÉ
 *       kontejnery. Docker je DNATuje a pouští přes FORWARD, mimo INPUT: bez pravidla
 *       pod DOCKER-USER by je INPUT nikdy neviděl.
 *   (c) Odchozí provoz firewall neomezuje: agenti NetBird (443/tcp a 3478/udp na edge
 *       forků, UDP WireGuard) projdou a odpovědi jim pouští ESTABLISHED.
 *
 * ⛔ NAMĚŘENO 2026-10-05 (kontrola „po" rady 7b proti kódu @0aa460018): kód znal jen
 * SSH ze správy + UDP meshe. „Světu" pro SSH nešlo vyjádřit a publikovaný port byl ze
 * správcovské adresy zahozený (FWD nepouštěl nic než mesh) — neshoda s deklarací.
 *
 * JAK SE MĚŘÍ: hostfw.sh vydá plán v DRY_RUN (`--plan`, lib/hostfw-postroj.ts — totéž,
 * co jde do `iptables-restore --noflush` a do skoků). Malý vyhodnocovač níž projde
 * paket vestavěným řetězcem (INPUT, nebo DOCKER-USER pro FORWARD) se skoky hostfw a
 * vlastními řetězci: DROP = zahozen, jinak projde (politika hostitele ACCEPT, Docker
 * publikované porty po DOCKER-USER pouští). Token, kterému vyhodnocovač nerozumí, je
 * CHYBA — nový tvar pravidla nesmí projít jako „nesedí, tedy projde".
 * Každé „zahozen" má v témže běhu kotvu „projde" (správcovská adresa, odpověď).
 * Adresy jsou dokumentační (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24,
 * 2001:db8::/32) — správcovská adresa instance do gitu nepatří.
 */
import { describe, expect, it } from "vitest";
import { MESH_PORT, ROZHRANI, plan, postroj } from "./lib/hostfw-postroj";
import { adresaVCidrech } from "../../../scripts/lib/accel-deklarace.mjs";

type Rodina = "4" | "6";
type Paket = {
  rodina: Rodina;
  /** INPUT = pro hostitele (sshd, služba hostitele); FORWARD = do kontejneru (publikovaný port). */
  cesta: "INPUT" | "FORWARD";
  /** Vstupní rozhraní — výchozí veřejné (provoz zvenku); kontejner ven = most. */
  iif?: string;
  oif?: string;
  src: string;
  proto: "tcp" | "udp";
  dport: number;
  ctstate: "NEW" | "ESTABLISHED";
};
type Verdikt = "projde" | "zahozen";

/** Plán → pravidla po řetězcích a rodinách (restore payload i skoky do vestavěných). */
function retezce(text: string): Record<Rodina, Record<string, string[]>> {
  const out: Record<Rodina, Record<string, string[]>> = { "4": {}, "6": {} };
  let rodina: Rodina | null = null;
  for (const radek of text.split("\n")) {
    const h = /^# --- IPv([46]):/.exec(radek);
    if (h) {
      rodina = h[1] as Rodina;
      continue;
    }
    if (!rodina) continue;
    const a = /^-A (\S+) (.*)$/.exec(radek.trim());
    const i = /^-I (\S+) \d+ (.*)$/.exec(radek.trim());
    const [ret, spec] = a ? [a[1], a[2]] : i ? [i[1], i[2]] : [null, null];
    if (!ret || spec === null) continue;
    (out[rodina][ret] ??= []).push(spec);
  }
  return out;
}

/** Sedí pravidlo na paket? Neznámý token = chyba (žádné tiché „nesedí"). Vrací cíl, nebo null. */
function shoda(spec: string, p: Paket): string | null | "BEZ_CILE" {
  const t = spec.split(/\s+/);
  if (t.length % 2 !== 0) throw new Error(`pravidlo není ve dvojicích přepínač–hodnota: ${spec}`);
  const iif = p.iif ?? ROZHRANI;
  let cil: string | null = null;
  let sedi = true;
  for (let k = 0; k < t.length; k += 2) {
    const v = t[k + 1];
    switch (t[k]) {
      case "-i": sedi &&= v.endsWith("+") ? iif.startsWith(v.slice(0, -1)) : iif === v; break;
      case "-o": sedi &&= p.oif !== undefined && (v.endsWith("+") ? p.oif.startsWith(v.slice(0, -1)) : p.oif === v); break;
      case "-s": sedi &&= adresaVCidrech(p.src, [v]); break;
      case "-p": sedi &&= v === p.proto; break;
      case "--dport": sedi &&= Number(v) === p.dport; break;
      case "--ctstate": sedi &&= v.split(",").includes(p.ctstate); break;
      // Původní cílový port před DNAT = publikovaný port, na který paket přišel.
      case "--ctorigdstport": sedi &&= Number(v) === p.dport; break;
      case "--icmp-type": case "--icmpv6-type": sedi = false; break; // pakety testu nejsou ICMP
      case "-m": if (!["conntrack", "comment"].includes(v)) throw new Error(`modul '${v}' vyhodnocovač nezná: ${spec}`); break;
      case "--comment": break;
      case "-j": cil = v; break;
      default: throw new Error(`token '${t[k]}' vyhodnocovač nezná: ${spec}`);
    }
  }
  if (!sedi) return null;
  return cil ?? "BEZ_CILE";
}

/** Projde paket vestavěným řetězcem (INPUT / DOCKER-USER) se skoky a vlastními řetězci? */
export function verdikt(text: string, p: Paket): Verdikt {
  const r = retezce(text)[p.rodina];
  const vestaveny = p.cesta === "INPUT" ? "INPUT" : "DOCKER-USER";
  const projdiVlastni = (ret: string): "DROP" | "RETURN" => {
    for (const spec of r[ret] ?? []) {
      const c = shoda(spec, p);
      if (c === null || c === "BEZ_CILE") continue;
      if (c === "DROP") return "DROP";
      if (c === "RETURN" || c === "ACCEPT") return "RETURN";
      throw new Error(`cíl '${c}' vyhodnocovač nezná: ${spec}`);
    }
    return "RETURN";
  };
  for (const spec of r[vestaveny] ?? []) {
    const c = shoda(spec, p);
    if (c === null || c === "BEZ_CILE") continue;
    if (!c.startsWith("AISHA-HOSTFW-")) throw new Error(`skok hostfw jinam než do vlastního řetězce: ${spec}`);
    if (projdiVlastni(c) === "DROP") return "zahozen";
  }
  return "projde";
}

// Správcovské adresy fixtury (lib/hostfw-postroj.ts SPRAVA): 192.0.2.10/32, 198.51.100.0/24, 2001:db8:a::/48.
const ZE_SPRAVY: Record<Rodina, string[]> = { "4": ["192.0.2.10", "198.51.100.44"], "6": ["2001:db8:a::5"] };
const ODJINUD: Record<Rodina, string[]> = { "4": ["203.0.113.7", "192.0.2.11"], "6": ["2001:db8:ffff::7"] };
const MOST = ["docker0", "br-1a2b3c4d5e6f"];

type Ocekavani = { popis: string; p: Paket; chci: Verdikt };

/**
 * Celá tabulka očekávání deklarace pro danou volbu SSH (enforce) a deklarovaný UDP port
 * meshe (`udp` = ACCEL_FW_UDP_MESH_PORT, `null` = nedeklarován → UDP zavřeno).
 */
function tabulka(ssh: "svet" | "sprava", udp: string | null = null): Ocekavani[] {
  const o: Ocekavani[] = [];
  for (const rodina of ["4", "6"] as Rodina[]) {
    for (const src of ODJINUD[rodina]) {
      for (const oif of MOST) {
        o.push({ popis: `(b) publikovaný tcp/8000 do ${oif} z ${src}`, p: { rodina, cesta: "FORWARD", oif, src, proto: "tcp", dport: 8000, ctstate: "NEW" }, chci: "zahozen" });
        o.push({ popis: `(b) publikovaný udp/5000 do ${oif} z ${src}`, p: { rodina, cesta: "FORWARD", oif, src, proto: "udp", dport: 5000, ctstate: "NEW" }, chci: "zahozen" });
        // UDP meshe: jen deklarovaný port a jen s deklarací (nejmenší oprávnění).
        o.push({ popis: `mesh udp/${MESH_PORT} do ${oif} z ${src} (${udp === MESH_PORT ? "deklarovaná výjimka" : "nedeklarováno"})`, p: { rodina, cesta: "FORWARD", oif, src, proto: "udp", dport: Number(MESH_PORT), ctstate: "NEW" }, chci: udp === MESH_PORT ? "projde" : "zahozen" });
        o.push({ popis: `udp/${Number(MESH_PORT) + 1} do ${oif} z ${src} (soused deklarovaného portu)`, p: { rodina, cesta: "FORWARD", oif, src, proto: "udp", dport: Number(MESH_PORT) + 1, ctstate: "NEW" }, chci: "zahozen" });
        o.push({ popis: `(c) odpověď udp do ${oif} z ${src} (STUN/WireGuard agenta)`, p: { rodina, cesta: "FORWARD", oif, src, proto: "udp", dport: 51820, ctstate: "ESTABLISHED" }, chci: "projde" });
      }
      o.push({ popis: `(a) SSH hostitele z ${src}`, p: { rodina, cesta: "INPUT", src, proto: "tcp", dport: 22, ctstate: "NEW" }, chci: ssh === "svet" ? "projde" : "zahozen" });
      for (const dport of [80, 443, 8080, 2222]) {
        o.push({ popis: `(b) hostitel tcp/${dport} z ${src}`, p: { rodina, cesta: "INPUT", src, proto: "tcp", dport, ctstate: "NEW" }, chci: "zahozen" });
      }
      o.push({ popis: `(b) hostitel udp/53 z ${src}`, p: { rodina, cesta: "INPUT", src, proto: "udp", dport: 53, ctstate: "NEW" }, chci: "zahozen" });
      o.push({ popis: `hostitel mesh udp/${MESH_PORT} z ${src} (${udp === MESH_PORT ? "deklarovaná výjimka" : "nedeklarováno"})`, p: { rodina, cesta: "INPUT", src, proto: "udp", dport: Number(MESH_PORT), ctstate: "NEW" }, chci: udp === MESH_PORT ? "projde" : "zahozen" });
      o.push({ popis: `(c) odpověď tcp z ${src} (spojení agenta na 443 edge)`, p: { rodina, cesta: "INPUT", src, proto: "tcp", dport: 41234, ctstate: "ESTABLISHED" }, chci: "projde" });
    }
    for (const src of ZE_SPRAVY[rodina]) {
      for (const oif of MOST) {
        o.push({ popis: `(b) publikovaný tcp/8000 do ${oif} ze správy ${src}`, p: { rodina, cesta: "FORWARD", oif, src, proto: "tcp", dport: 8000, ctstate: "NEW" }, chci: "projde" });
        o.push({ popis: `(b) publikovaný udp/5000 do ${oif} ze správy ${src}`, p: { rodina, cesta: "FORWARD", oif, src, proto: "udp", dport: 5000, ctstate: "NEW" }, chci: "projde" });
      }
      o.push({ popis: `(a) SSH hostitele ze správy ${src}`, p: { rodina, cesta: "INPUT", src, proto: "tcp", dport: 22, ctstate: "NEW" }, chci: "projde" });
      o.push({ popis: `(b) hostitel tcp/8080 ze správy ${src}`, p: { rodina, cesta: "INPUT", src, proto: "tcp", dport: 8080, ctstate: "NEW" }, chci: "projde" });
    }
    // (c) odchozí kontejneru: z mostu ven na edge — skok z DOCKER-USER míří jen DO mostů.
    for (const iif of MOST) {
      for (const [proto, dport] of [["tcp", 443], ["udp", 3478], ["udp", 51820]] as const) {
        o.push({ popis: `(c) kontejner z ${iif} ven ${proto}/${dport} (edge forku / WireGuard)`, p: { rodina, cesta: "FORWARD", iif, oif: ROZHRANI, src: rodina === "4" ? "172.17.0.5" : "fd00:d0c::5", proto, dport, ctstate: "NEW" }, chci: "projde" });
      }
    }
  }
  return o;
}

/** Odchylky plánu od deklarace: prázdné = firewall pouští přesně, co deklarace říká. */
function odchylky(text: string, ssh: "svet" | "sprava", udp: string | null = null): string[] {
  return tabulka(ssh, udp)
    .map(({ popis, p, chci }) => ({ popis, chci, je: verdikt(text, p) }))
    .filter((x) => x.je !== x.chci)
    .map((x) => `${x.popis}: ${x.je}, deklarace chce ${x.chci}`);
}

describe("firewall hostitele pouští dovnitř přesně deklaraci uzlu (chování nad plánem z DRY_RUN)", () => {
  const p = postroj();
  const sprava = plan(p, { ACCEL_FW_MODE: "enforce", ACCEL_FW_SSH: "sprava" });
  const svet = plan(p, { ACCEL_FW_MODE: "enforce", ACCEL_FW_SSH: "svet" });
  const measure = plan(p, { ACCEL_FW_MODE: "measure", ACCEL_FW_SSH: "sprava" });
  const sUdp = plan(p, { ACCEL_FW_MODE: "enforce", ACCEL_FW_SSH: "sprava", ACCEL_FW_UDP_MESH_PORT: MESH_PORT });

  it("univerzum: oba plány vydané, obě rodiny, skoky z INPUT i DOCKER-USER; tabulka má obě strany", () => {
    for (const r of [sprava, svet, measure]) expect(r.kod, r.err).toBe(0);
    for (const rod of ["4", "6"] as Rodina[]) {
      const r = retezce(sprava.out)[rod];
      expect(r.INPUT?.length, `IPv${rod}: skok z INPUT`).toBe(1);
      expect(r["DOCKER-USER"]?.length, `IPv${rod}: skoky z DOCKER-USER`).toBe(2);
    }
    const t = tabulka("sprava");
    expect(t.filter((x) => x.chci === "zahozen").length).toBeGreaterThan(20);
    expect(t.filter((x) => x.chci === "projde").length).toBeGreaterThan(20);
  });

  it("(a)+(b)+(c) ACCEL_FW_SSH=sprava: publikovaný port odjinud zahozen, ze správy projde; SSH jen ze správy; odpovědi a odchozí projdou", () => {
    expect(odchylky(sprava.out, "sprava")).toEqual([]);
  });

  it("(a)+(b)+(c) ACCEL_FW_SSH=svet: SSH hostitele projde odkudkoli, VŠE ostatní (i publikované porty) odjinud zahozeno", () => {
    expect(odchylky(svet.out, "svet")).toEqual([]);
    // Kotva obou směrů: plán „světu" nesplní deklaraci „správa" (SSH odjinud projde) a naopak.
    expect(odchylky(svet.out, "sprava").join("\n")).toMatch(/SSH hostitele z 203\.0\.113\.7: projde, deklarace chce zahozen/);
    expect(odchylky(sprava.out, "svet").join("\n")).toMatch(/SSH hostitele z 203\.0\.113\.7: zahozen, deklarace chce projde/);
  });

  it("UDP meshe (nejmenší oprávnění): bez deklarace ACCEL_FW_UDP_MESH_PORT je příchozí UDP meshe z nesprávcovské adresy ZAHOZENO (INPUT i do kontejneru); KOTVA: s deklarací projde PŘESNĚ ten port, soused ne", () => {
    expect(sUdp.kod, sUdp.err).toBe(0);
    expect(odchylky(sUdp.out, "sprava", MESH_PORT)).toEqual([]);
    // Kotva obou směrů: plán s deklarací nesplní „nedeklarováno" a naopak.
    expect(odchylky(sUdp.out, "sprava", null).join("\n")).toMatch(new RegExp(`mesh udp/${MESH_PORT} do docker0 z 203\\.0\\.113\\.7 \\(nedeklarováno\\): projde, deklarace chce zahozen`));
    expect(odchylky(sprava.out, "sprava", MESH_PORT).join("\n")).toMatch(new RegExp(`hostitel mesh udp/${MESH_PORT} z 203\\.0\\.113\\.7 \\(deklarovaná výjimka\\): zahozen, deklarace chce projde`));
  });

  it("measure nezahazuje nic (jen čítá) — kotva, že vyhodnocovač „zahozen“ nevydává sám od sebe", () => {
    const zahozeno = tabulka("sprava").filter(({ p: pk }) => verdikt(measure.out, pk) === "zahozen");
    expect(zahozeno.map((x) => x.popis)).toEqual([]);
  });

  it("(c) firewall do OUTPUT nesahá a do DOCKER-USER skáče jen z veřejného rozhraní DO mostů", () => {
    for (const t of [sprava.out, svet.out]) {
      expect(t).not.toMatch(/OUTPUT/);
      for (const rod of ["4", "6"] as Rodina[]) {
        for (const s of retezce(t)[rod]["DOCKER-USER"] ?? []) expect(s).toMatch(new RegExp(`^-i ${ROZHRANI} -o (docker0|br-\\+) `));
      }
    }
  });

  it("vyhodnocovač: neznámý token pravidla je chyba, ne tiché „nesedí“", () => {
    const vadny = sprava.out.replace(/-A AISHA-HOSTFW-FWD -s 192\.0\.2\.10\/32 /, "-A AISHA-HOSTFW-FWD -m mark --mark 0x1 -s 192.0.2.10/32 ");
    expect(vadny).not.toBe(sprava.out);
    expect(() => odchylky(vadny, "sprava")).toThrow(/modul 'mark' vyhodnocovač nezná/);
    const lichy = sprava.out.replace(/-A AISHA-HOSTFW-FWD -s 192\.0\.2\.10\/32 /, "-A AISHA-HOSTFW-FWD ! -s 192.0.2.10/32 ");
    expect(() => odchylky(lichy, "sprava"), "negace (!) se nevykládá").toThrow(/dvojicích|nezná/);
  });

  describe("mutace plánu — každá musí zčervenat (kontrakt: zelená bez mutace nic nedokazuje)", () => {
    const M: Array<[string, "svet" | "sprava", (t: string) => string, RegExp]> = [
      ["DOCKER-USER chybí (publikované porty jen přes INPUT)", "sprava", (t) => t.replace(/^-I DOCKER-USER [^\n]*\n/gm, ""), /publikovaný tcp\/8000 do docker0 z 203\.0\.113\.7: projde, deklarace chce zahozen/],
      ["pod DOCKER-USER chybí „ze správy“ (publikovaný port správě zahozen)", "sprava", (t) => t.replace(/^-A AISHA-HOSTFW-FWD -s [^\n]*\n/gm, ""), /publikovaný tcp\/8000 do docker0 ze správy 192\.0\.2\.10: zahozen, deklarace chce projde/],
      ["„světu“ omylem i pro jiný port", "svet", (t) => t.replace(/-A AISHA-HOSTFW-IN -p tcp --dport 22 -m comment --comment aisha-hostfw:ssh-svet/g, "-A AISHA-HOSTFW-IN -p tcp -m comment --comment aisha-hostfw:ssh-svet"), /hostitel tcp\/8080 z 203\.0\.113\.7: projde, deklarace chce zahozen/],
      ["„světu“ i do kontejnerů", "svet", (t) => t.replace(/^(-A AISHA-HOSTFW-FWD -m conntrack[^\n]*\n)/gm, "$1-A AISHA-HOSTFW-FWD -p tcp -m comment --comment aisha-hostfw:ssh-svet -j RETURN\n"), /publikovaný tcp\/8000 do docker0 z 203\.0\.113\.7: projde/],
      ["SSH ze správy zahozen (správa bez SSH)", "sprava", (t) => t.replace(/^-A AISHA-HOSTFW-IN -s [^\n]*aisha-hostfw:sprava -j RETURN\n/gm, "").replace(/^-A AISHA-HOSTFW-IN -s [^\n]*ze-spravy -j RETURN\n/gm, ""), /SSH hostitele ze správy 192\.0\.2\.10: zahozen/],
      ["UDP meshe otevřené bez deklarace", "sprava", (t) => t.replace(/^(-A AISHA-HOSTFW-FWD -m comment --comment aisha-hostfw:zbytek)/gm, `-A AISHA-HOSTFW-FWD -p udp -m conntrack --ctorigdstport ${MESH_PORT} -m comment --comment aisha-hostfw:mesh -j RETURN\n$1`), /mesh udp\/40404 do docker0 z 203\.0\.113\.7 \(nedeklarováno\): projde, deklarace chce zahozen/],
      ["odpovědi zahozené (bez ESTABLISHED)", "sprava", (t) => t.replace(/^-A AISHA-HOSTFW-(IN|FWD) -m conntrack --ctstate ESTABLISHED,RELATED [^\n]*\n/gm, ""), /odpověď (tcp|udp) .*: zahozen, deklarace chce projde/],
    ];
    it.each(M)("%s", (_jmeno, ssh, mutace, ocekavano) => {
      const puvodni = ssh === "svet" ? svet.out : sprava.out;
      const zmeneny = mutace(puvodni);
      expect(zmeneny, "mutace se netrefila — měřidlo by testovalo prázdno").not.toBe(puvodni);
      expect(odchylky(zmeneny, ssh).join("\n")).toMatch(ocekavano);
    });
  });
});
