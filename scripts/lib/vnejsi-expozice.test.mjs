// Vnější sonda doktora: očekávání se odvodí z deklarací firewallu a z ODCHOZÍ IP
// stanoviště; hairpin (měření z téhož hostitele) se odmítne. Proti falešnému
// Coolify a falešné sondě — žádné spojení ven. Adresy jen z dokumentačních rozsahů.
//
// Kontrakt oprav F2 a F3 (T6–T11): pravidlo o UDP nad MĚŘENÝM stavem firewallu
// (vstřiknutá kontrola uzlu) a port SSH do CI VM z DEKLARACE. Každý test, který
// tvrdí „bez nálezu", má v témže běhu kotvu, kde nález je.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEKLARACE_PORTU_CI_VM, portCiVm } from "./accel-deklarace.mjs";
import { udpPortyCompose, udpPortyMapovani } from "./dvere-soulad.mjs";
import {
  STAVY_BEZ_ZAHAZOVANI,
  STAV_ZAHAZUJE,
  naServeru,
  ocekavani,
  odchoziAdresa,
  portMeshe,
  posudUdpPort,
  tcpPortyCompose,
  tcpPortyMapovani,
  tcpSonda,
  zmerExpozici,
} from "./vnejsi-expozice.mjs";

const UZEL = "203.0.113.50";
const SPRAVA = "192.0.2.0/24";
const MESH = 40404;
/**
 * Port SSH do CI VM ve fixtuře (deklarace ACCEL_CI_VM_SSH_PORT). Úmyslně číslo,
 * které v repu nikde jinde není — literál v kódu by ho netrefil.
 */
const KLIC_CI_VM = DEKLARACE_PORTU_CI_VM.klic;
const PORT_CI_VM = 20022;
const SERVERS = { gpu: { hostname: "x", role: "gpu", coolify_uuid: "x", has_gpu: true, proxy: "none", stacks: [] } };
const SLUZBY = { "accel-hostfw": { placement: "gpu", provision_when_env: "ACCEL_ENABLED" } };
const env = (extra = {}) => {
  const e = {
    ACCEL_ENABLED: "1", ACCEL_OWNER_PREFIX: "vrstva", ACCEL_FW_NODE_OWNER: "vrstva",
    ACCEL_FW_MODE: "enforce", ACCEL_FW_SSH: "sprava", ACCEL_FW_ADMIN_CIDRS: SPRAVA, COOLIFY_SERVER_UUID_GPU: "srv-a",
    ACCEL_FW_UDP_MESH_PORT: String(MESH), ACCEL_CI_VM_SSH_PORT: String(PORT_CI_VM), ...extra,
  };
  return (k) => e[k];
};
/** Vstřiknutá kontrola uzlu: proxy v pořádku, firewall v měřeném stavu `stav` (null = nezměřen). */
const uzel = (stav) => async (slot) => ({
  vysledek: "ok",
  radky: [`· ${slot}: firewall hostitele 'vrstva-accel-hostfw' — stav ${stav ?? "NEZMĚŘEN"}`],
  firewall: { stav, duvod: stav ? null : "healthcheck kontejneru firewallu ještě neproběhl" },
});
function falesnyCoolify({ aplikace = [], envy = {}, server = { uuid: "srv-a", name: "Uzel", ip: UZEL } } = {}) {
  const volani = [];
  const coolify = async (cesta) => {
    volani.push(cesta);
    if (cesta === "/servers/srv-a") return server;
    if (cesta === "/applications") return aplikace;
    const m = /^\/applications\/([^/]+)\/envs$/.exec(cesta);
    if (m) return envy[m[1]] ?? [];
    throw new Error(`HTTP 404 ${cesta}`);
  };
  return { coolify, volani };
}
/** Falešná sonda: otevřené porty z mapy, ostatní „bez-odpovedi“ (DROP). */
const sonda = (otevrene) => async (_ip, port) => (otevrene.includes(port) ? "otevreno" : "bez-odpovedi");
const mer = (o) =>
  zmerExpozici({ servers: SERVERS, sluzby: SLUZBY, adresyStanoviste: ["127.0.0.1"], ...o });
const nalezy = (r) => r.radky.filter((x) => x.startsWith("✗"));
const nemerene = (r) => r.radky.filter((x) => x.startsWith("? "));
/** Aplikace na měřeném serveru, která publikuje `ports_mappings`. */
const aplikace = (mapovani, jmeno = "sluzba-s-udp") => ({ uuid: jmeno, name: jmeno, destination: { server: { uuid: "srv-a" } }, ports_mappings: mapovani });

describe("výběr uzlů a předpoklady měření", () => {
  it("lane firewallu zavřená: žádný uzel, žádné volání, kód 0 a výpis to ŘÍKÁ", async () => {
    const { coolify, volani } = falesnyCoolify();
    const r = await mer({ coolify, cti: env({ ACCEL_ENABLED: "false" }), odchoziIp: "192.0.2.7", sonda: sonda([]) });
    expect(r.kod).toBe(0);
    expect(r.radky.join("\n")).toMatch(/nenasazuje/);
    expect(volani).toEqual([]);
  });

  it("⛔ odchozí IP neznámá: NEMĚŘENO (kód 2), ne shoda", async () => {
    const { coolify } = falesnyCoolify();
    const r = await mer({ coolify, cti: env(), odchoziIp: null, sonda: sonda([22]) });
    expect(r.kod).toBe(2);
    expect(r.radky.join("\n")).toMatch(/odchozí IP stanoviště neznám/);
  });

  it("⛔ HAIRPIN: stanoviště odchází přes IP uzlu (CI VM na témže hostiteli) → odmítnuto, nic se neproklepne", async () => {
    const { coolify } = falesnyCoolify();
    let proklepnuto = 0;
    const r = await mer({ coolify, cti: env(), odchoziIp: UZEL, sonda: async () => (proklepnuto++, "otevreno") });
    expect(r.kod).toBe(2);
    expect(r.radky.join("\n")).toMatch(/HAIRPIN/);
    expect(proklepnuto).toBe(0);
  });

  it("⛔ HAIRPIN i tehdy, když IP uzlu je na vlastním rozhraní stanoviště", async () => {
    const { coolify } = falesnyCoolify();
    const r = await mer({ coolify, cti: env(), odchoziIp: "192.0.2.7", adresyStanoviste: [UZEL], sonda: sonda([]) });
    expect(r.radky.join("\n")).toMatch(/HAIRPIN/);
  });

  it("IP uzlu v Coolify neveřejná (LAN): NEMĚŘENO — pohled z internetu tím nezměřím", async () => {
    const { coolify } = falesnyCoolify({ server: { uuid: "srv-a", ip: "10.1.2.3" } });
    const r = await mer({ coolify, cti: env(), odchoziIp: "192.0.2.7", sonda: sonda([]) });
    expect(r.kod).toBe(2);
    expect(r.radky.join("\n")).toMatch(/není veřejná/);
  });

  it("⛔ neplatná deklarace firewallu je nález sama o sobě", async () => {
    const { coolify } = falesnyCoolify();
    const r = await mer({ coolify, cti: env({ ACCEL_FW_ADMIN_CIDRS: "" }), odchoziIp: "192.0.2.7", sonda: sonda([22]) });
    expect(r.kod).toBe(1);
    expect(r.radky.join("\n")).toMatch(/NENABĚHNE/);
  });
});

describe("očekávání podle stanoviště (CI runner odchází přes adresu správy)", () => {
  it("enforce, stanoviště v adresách správy: 22 otevřený = shoda, ostatní zavřené = shoda (kód 0)", async () => {
    const { coolify } = falesnyCoolify();
    const r = await mer({ coolify, cti: env(), odchoziIp: "192.0.2.7", sonda: sonda([22]) });
    expect(r.kod, r.radky.join("\n")).toBe(0);
    // Pevná sada (5) + port SSH do CI VM z deklarace.
    expect(r.radky.filter((x) => x.startsWith("✓"))).toHaveLength(6);
  });

  it("⛔ enforce, stanoviště v adresách správy, 22 zavřený: nález (správa by se nedostala)", async () => {
    const { coolify } = falesnyCoolify();
    const r = await mer({ coolify, cti: env(), odchoziIp: "192.0.2.7", sonda: sonda([]) });
    expect(r.kod).toBe(1);
    expect(r.radky.join("\n")).toMatch(/TCP 22 .*NEDOSTALA/);
  });

  it("⛔ enforce, cizí síť: 22 otevřený = nález", async () => {
    const { coolify } = falesnyCoolify();
    const r = await mer({ coolify, cti: env(), odchoziIp: "198.51.100.9", sonda: sonda([22]) });
    expect(r.kod).toBe(1);
    expect(r.radky.join("\n")).toMatch(/TCP 22 OTEVŘENÝ zvenku/);
  });

  it("measure, cizí síť: 22 otevřený je varování (enforce ještě neběží), ne nález — kód 3", async () => {
    const { coolify } = falesnyCoolify();
    const r = await mer({ coolify, cti: env({ ACCEL_FW_MODE: "measure" }), odchoziIp: "198.51.100.9", sonda: sonda([22]) });
    expect(r.kod).toBe(3);
    expect(r.radky.some((x) => x.startsWith("? ") && x.includes("TCP 22"))).toBe(true);
  });

  it("(a) ACCEL_FW_SSH=svet: z cizí sítě je 22 otevřený SHODA (hlídá sshd), zavřený je neshoda s deklarací; ostatní porty dál zavřené; KOTVA: sprava — týž otevřený 22 je nález", async () => {
    const { coolify } = falesnyCoolify();
    const svet = await mer({ coolify, cti: env({ ACCEL_FW_SSH: "svet" }), odchoziIp: "198.51.100.9", sonda: sonda([22]) });
    expect(nalezy(svet), svet.radky.join("\n")).toEqual([]);
    expect(svet.radky).toContain("✓ gpu: TCP 22 otevreno (otevřený podle očekávání)");
    expect(svet.radky.join("\n")).toMatch(/SSH sv[eě]t|SSH svet/);
    const zavreny = await mer({ coolify, cti: env({ ACCEL_FW_SSH: "svet" }), odchoziIp: "198.51.100.9", sonda: sonda([]) });
    expect(nalezy(zavreny).join("\n")).toMatch(/TCP 22 bez-odpovedi — SSH hostitele je deklarované světu .*neshoda s deklarací/);
    const jinyPort = await mer({ coolify, cti: env({ ACCEL_FW_SSH: "svet" }), odchoziIp: "198.51.100.9", sonda: sonda([22, 8080]) });
    expect(nalezy(jinyPort).join("\n"), "světu platí jen SSH").toMatch(/TCP 8080 OTEVŘENÝ zvenku/);
    const sprava = await mer({ coolify, cti: env({ ACCEL_FW_SSH: "sprava" }), odchoziIp: "198.51.100.9", sonda: sonda([22]) });
    expect(nalezy(sprava).join("\n")).toMatch(/TCP 22 OTEVŘENÝ zvenku/);
  });

  it("(b) stanoviště ve správcovských adresách: ostatní porty smí být otevřené (deklarace jim pouští vše) — shoda, ne nález; KOTVA: z cizí sítě týž port nález", async () => {
    const { coolify } = falesnyCoolify();
    const zeSpravy = await mer({ coolify, cti: env(), odchoziIp: "192.0.2.7", sonda: sonda([22, 8000, 8080]) });
    expect(nalezy(zeSpravy), zeSpravy.radky.join("\n")).toEqual([]);
    expect(zeSpravy.radky.some((x) => /^✓ gpu: TCP 8000 otevreno — stanoviště je ve správcovských adresách/.test(x))).toBe(true);
    const odjinud = await mer({ coolify, cti: env(), odchoziIp: "198.51.100.9", sonda: sonda([8000]) });
    expect(nalezy(odjinud).join("\n")).toMatch(/TCP 8000 OTEVŘENÝ zvenku/);
  });

  it("⛔ deklarace bez volby SSH je nález sama o sobě (firewall nenaběhne)", async () => {
    const { coolify } = falesnyCoolify();
    const r = await mer({ coolify, cti: env({ ACCEL_FW_SSH: "" }), odchoziIp: "198.51.100.9", sonda: sonda([]) });
    expect(nalezy(r).join("\n")).toMatch(/deklarace firewallu neplatná — firewall NENABĚHNE: ACCEL_FW_SSH není deklarovaný/);
  });

  it("⛔ slot s proxy none a otevřeným 80/443: nález pojmenuje proxy", async () => {
    const { coolify } = falesnyCoolify();
    const r = await mer({ coolify, cti: env(), odchoziIp: "192.0.2.7", sonda: sonda([22, 80, 443]) });
    expect(r.kod).toBe(1);
    expect(r.radky.filter((x) => /proxy 'none'/.test(x))).toHaveLength(2);
  });

  it("TCP porty aplikací serveru (ports_mappings i compose) se proklepnou, UDP a cizí server ne — UDP jde pravidlu, ne sondě", async () => {
    const { coolify } = falesnyCoolify({
      aplikace: [
        { uuid: "a1", name: "tady", destination: { server: { uuid: "srv-a" } }, ports_mappings: "9000:9000,5000:5000/udp" },
        { uuid: "a2", name: "tady-compose", build_pack: "dockercompose", destination: { server: { uuid: "srv-a" } },
          docker_compose_raw: "services:\n  x:\n    image: y\n    ports:\n      - \"${PORT_X}:8001\"\n      - \"6000:6000/udp\"\n" },
        { uuid: "a3", name: "jinde", destination: { server: { uuid: "srv-b" } }, ports_mappings: "7777:7777" },
      ],
      envy: { a2: [{ key: "PORT_X", value: "7001", is_preview: false }] },
    });
    const proklepnute = [];
    const r = await mer({
      coolify, cti: env(), odchoziIp: "192.0.2.7", kontrolaUzlu: uzel(STAV_ZAHAZUJE),
      sonda: async (_ip, p) => (proklepnute.push(p), p === 22 ? "otevreno" : "odmitnuto"),
    });
    expect(proklepnute.sort((a, b) => a - b)).toEqual([22, 80, 443, 7001, 8000, 8080, 9000, PORT_CI_VM]);
    expect(r.kod, r.radky.join("\n")).toBe(0);
    // UDP porty obou aplikací serveru pravidlo vidělo (firewall VYNUCENO je zahazuje); cizí server ne.
    expect(r.radky.filter((x) => /^✓ gpu: UDP (5000|6000) /.test(x))).toHaveLength(2);
    expect(r.radky.join("\n")).not.toMatch(/7777/);
  });
});

describe("F2: publikovaný UDP port — pravidlo nad MĚŘENÝM stavem firewallu, ne sonda", () => {
  it("T6: aplikace publikuje 443:443/udp a firewall je ve stavu MERENI nebo VRACENO → NÁLEZ (kód 1), oba stavy; KOTVA: táž aplikace, firewall VYNUCENO → žádný nález k UDP (kód 0)", async () => {
    const apps = { aplikace: [aplikace("443:443/udp")] };
    // Kotva: stejná aplikace, firewall zahazuje. Deklarovaný režim je ve všech bězích TÝŽ (enforce) —
    // rozhoduje měřený stav.
    const kotva = await mer({ ...falesnyCoolify(apps), cti: env(), odchoziIp: "192.0.2.7", sonda: sonda([22]), kontrolaUzlu: uzel(STAV_ZAHAZUJE) });
    expect(kotva.kod, kotva.radky.join("\n")).toBe(0);
    expect(nalezy(kotva)).toEqual([]);
    expect(kotva.radky.filter((x) => /^✓ gpu: UDP 443 publikuje aplikace sluzba-s-udp — firewall na uzlu je ve stavu VYNUCENO \(měřeno\) a zahazuje ho/.test(x))).toHaveLength(1);

    for (const stav of ["MERENI", "VRACENO"]) {
      const r = await mer({ ...falesnyCoolify(apps), cti: env(), odchoziIp: "192.0.2.7", sonda: sonda([22]), kontrolaUzlu: uzel(stav) });
      expect(r.kod, `${stav}:\n${r.radky.join("\n")}`).toBe(1);
      expect(nalezy(r), stav).toHaveLength(1);
      expect(nalezy(r)[0], stav).toMatch(new RegExp(`^✗ gpu: UDP 443 publikuje aplikace sluzba-s-udp a firewall na uzlu je ve stavu ${stav} \\(měřeno; deklarovaný režim enforce\\)`));
    }
  });

  it("T6: pravidlo nepotřebuje odchozí IP stanoviště ani TCP sondu — nález platí i tehdy, když TCP změřit nejde", async () => {
    const r = await mer({ ...falesnyCoolify({ aplikace: [aplikace("443:443/udp")] }), cti: env(), odchoziIp: null, sonda: sonda([]), kontrolaUzlu: uzel("VRACENO") });
    expect(r.kod).toBe(1);
    expect(nalezy(r)).toHaveLength(1);
    expect(r.radky.join("\n")).toMatch(/odchozí IP stanoviště neznám/);
  });

  it("⛔ stav firewallu, který změřit nejde (nebo je přechodný), je NEZMĚŘENO s důvodem — nikdy shoda; firewall, který nenaběhl, je nález", async () => {
    const apps = { aplikace: [aplikace("443:443/udp")] };
    for (const [kontrolaUzlu, duvod] of [
      [uzel(null), /stav firewallu na uzlu NEZMĚŘEN \(healthcheck kontejneru firewallu ještě neproběhl\)/],
      [undefined, /stav firewallu na uzlu NEZMĚŘEN \(kontrola kontejnerů na uzlu neproběhla\)/],
      [uzel("CEKA_NA_POTVRZENI"), /NEZMĚŘEN \(stav CEKA_NA_POTVRZENI je přechodný nebo neznámý\)/],
      [uzel("STARTUJE"), /NEZMĚŘEN \(stav STARTUJE je přechodný nebo neznámý\)/],
      [uzel("COSI"), /NEZMĚŘEN \(stav COSI je přechodný nebo neznámý\)/],
    ]) {
      const r = await mer({ ...falesnyCoolify(apps), cti: env(), odchoziIp: "192.0.2.7", sonda: sonda([22]), kontrolaUzlu });
      expect(r.kod, r.radky.join("\n")).toBe(3);
      const udp = nemerene(r).filter((x) => x.includes("UDP 443"));
      expect(udp).toHaveLength(1);
      expect(udp[0]).toMatch(duvod);
      expect(udp[0], "deklarovaný režim se uvede, ale stav nenahrazuje").toMatch(/deklarovaný režim enforce stav není/);
      expect(r.radky.some((x) => x.startsWith("✓") && x.includes("UDP")), "neměřený stav nesmí dát zelenou").toBe(false);
    }
    for (const stav of ["SELHALO", "NAHLED"]) {
      const r = await mer({ ...falesnyCoolify(apps), cti: env(), odchoziIp: "192.0.2.7", sonda: sonda([22]), kontrolaUzlu: uzel(stav) });
      expect(r.kod, stav).toBe(1);
    }
    expect([...STAVY_BEZ_ZAHAZOVANI]).toEqual(["MERENI", "VRACENO", "SELHALO", "NAHLED"]);
    expect(STAV_ZAHAZUJE).toBe("VYNUCENO");
  });

  it("T7: compose s `protocol: udp` a `published` → port je mezi UDP porty; KOTVA: TCP port z TÉHOŽ compose je mezi TCP porty (a naopak ne)", async () => {
    const compose = [
      "services:",
      "  x:",
      "    image: y",
      "    ports:",
      "      - target: 53",
      "        published: 5353",
      "        protocol: udp",
      "      - target: 443",
      "        published: 8443",
      "        protocol: tcp",
      '      - "6001:6001/udp"',
      '      - "7002:7002"',
      "",
    ].join("\n");
    const cti = () => undefined;
    expect(udpPortyCompose(compose, cti).map((u) => [u.od, u.do])).toEqual([[5353, 5353], [6001, 6001]]);
    expect(await tcpPortyCompose(compose, cti)).toEqual([8443, 7002]);
    expect(udpPortyMapovani("9000:9000,5000:5000/udp").map((u) => u.od)).toEqual([5000]);
    expect(tcpPortyMapovani("9000:9000,5000:5000/udp")).toEqual([9000]);

    // Totéž přes měření: UDP port z compose vidí pravidlo, TCP port z téhož compose sonda.
    const { coolify } = falesnyCoolify({
      aplikace: [{ uuid: "a1", name: "s-compose", build_pack: "dockercompose", destination: { server: { uuid: "srv-a" } }, docker_compose_raw: compose }],
    });
    const proklepnute = [];
    const r = await mer({
      coolify, cti: env(), odchoziIp: "192.0.2.7", kontrolaUzlu: uzel("MERENI"),
      sonda: async (_ip, p) => (proklepnute.push(p), p === 22 ? "otevreno" : "odmitnuto"),
    });
    expect(nalezy(r).map((x) => /UDP (\d+)/.exec(x)?.[1])).toEqual(["5353", "6001"]);
    expect(proklepnute).toEqual(expect.arrayContaining([8443, 7002]));
    expect(proklepnute, "UDP port se TCP sondou neproklepává").not.toEqual(expect.arrayContaining([5353]));
  });

  it("T8: publikovaný UDP port = deklarovaný ACCEL_FW_UDP_MESH_PORT je povolený (jediná výjimka) a výstup to ŘÍKÁ; KOTVA: jiný UDP port v témže běhu → nález", async () => {
    const { coolify } = falesnyCoolify({ aplikace: [aplikace(`${MESH}:${MESH}/udp`, "mesh-agent"), aplikace("5000:5000/udp", "jina-sluzba")] });
    const r = await mer({ coolify, cti: env(), odchoziIp: "192.0.2.7", sonda: sonda([22]), kontrolaUzlu: uzel("MERENI") });
    expect(r.kod).toBe(1);
    expect(nalezy(r)).toHaveLength(1);
    expect(nalezy(r)[0]).toMatch(/^✗ gpu: UDP 5000 publikuje aplikace jina-sluzba/);
    const vyjimka = r.radky.filter((x) => x.includes(`UDP ${MESH} `));
    expect(vyjimka).toEqual([`· gpu: UDP ${MESH} publikuje aplikace mesh-agent — deklarovaný port meshe (ACCEL_FW_UDP_MESH_PORT), jediná povolená výjimka: firewall ho propouští v každém režimu`]);
  });

  it("⛔ T8: výjimka je PRÁVĚ port meshe — ne rozsah kolem něj, ne jiný port, a bez platné deklarace portu meshe žádná", () => {
    const kontext = { stavFirewallu: "MERENI", meshPort: MESH };
    expect(posudUdpPort({ od: MESH, do: MESH }, kontext).druh).toBe("vyjimka");
    expect(posudUdpPort({ od: MESH - 1, do: MESH + 1 }, kontext).druh).toBe("nalez");
    expect(posudUdpPort({ od: MESH + 1, do: MESH + 1 }, kontext).druh).toBe("nalez");
    expect(posudUdpPort({ od: MESH, do: MESH }, { stavFirewallu: "MERENI", meshPort: null }).druh).toBe("nalez");
    expect(posudUdpPort({ od: 443, do: 443 }, { stavFirewallu: "VYNUCENO", meshPort: MESH }).druh).toBe("zahazuje");
    expect(posudUdpPort({ od: 443, do: 443 }, { stavFirewallu: null, meshPort: MESH }).druh).toBe("nemereno");
    // Výjimka se čte z deklarace uzlu (ACCEL_FW_UDP_MESH_PORT), ne z portu řídicí roviny NetBirdu.
    expect(portMeshe((k) => ({ ACCEL_FW_UDP_MESH_PORT: "40404" })[k])).toBe(40404);
    expect(portMeshe((k) => ({ NETBIRD_MESH_PORT: "40404" })[k]), "NETBIRD_MESH_PORT výjimku nedává").toBeNull();
    for (const vadny of [undefined, "", "0", "65536", "0x10", "40404/udp", "-1", "4e4"]) {
      expect(portMeshe((k) => ({ ACCEL_FW_UDP_MESH_PORT: vadny })[k]), String(vadny)).toBeNull();
    }
  });
});

describe("F3: port SSH do CI VM se čte z deklarace a měří se vždy", () => {
  it("T9: port z deklarace CI VM je mezi měřenými — sonda na něj proběhne; KOTVA: port 22 proběhne také; jiná hodnota deklarace = jiný port", async () => {
    for (const port of [PORT_CI_VM, 20023]) {
      const proklepnute = [];
      const r = await mer({
        ...falesnyCoolify(), cti: env({ ACCEL_CI_VM_SSH_PORT: String(port) }), odchoziIp: "192.0.2.7",
        sonda: async (_ip, p) => (proklepnute.push(p), p === 22 ? "otevreno" : "bez-odpovedi"),
      });
      expect(proklepnute, `deklarace ${port}`).toContain(port);
      expect(proklepnute).toContain(22);
      expect(proklepnute.sort((a, b) => a - b)).toEqual([22, 80, 443, 8000, 8080, port]);
      expect(r.kod, r.radky.join("\n")).toBe(0);
    }
  });

  it("T10: stanoviště MIMO adresy správy a port CI VM otevřený → NÁLEZ (enforce i measure); KOTVA: stanoviště VE správě → otevřený je v pořádku", async () => {
    const kotva = await mer({ ...falesnyCoolify(), cti: env(), odchoziIp: "192.0.2.7", sonda: sonda([22, PORT_CI_VM]) });
    expect(kotva.kod, kotva.radky.join("\n")).toBe(0);
    expect(kotva.radky.filter((x) => x.includes(`TCP ${PORT_CI_VM} `))).toEqual([
      `✓ gpu: TCP ${PORT_CI_VM} otevreno — port SSH do CI VM, stanoviště je v adresách správy (odtud otevřený být smí)`,
    ]);

    for (const rezim of ["enforce", "measure"]) {
      const r = await mer({ ...falesnyCoolify(), cti: env({ ACCEL_FW_MODE: rezim }), odchoziIp: "198.51.100.9", sonda: sonda([PORT_CI_VM]) });
      expect(r.kod, `${rezim}:\n${r.radky.join("\n")}`).toBe(1);
      expect(nalezy(r), rezim).toEqual([
        `✗ gpu: TCP ${PORT_CI_VM} OTEVŘENÝ zvenku — port SSH do CI VM smí být otevřený jen z adres správy a stanoviště v nich není`,
      ]);
    }
    // Ze správy smí být i zavřený (virtuální stroj nemusí běžet) — není to nález ani varování.
    const zavreny = await mer({ ...falesnyCoolify(), cti: env(), odchoziIp: "192.0.2.7", sonda: sonda([22]) });
    expect(zavreny.kod).toBe(0);
  });

  /** Jeden běh měření s danou deklarací; vrací výsledek a seznam sondovaných portů. */
  const behSDeklaraci = async (cti) => {
    const proklepnute = [];
    const r = await mer({
      ...falesnyCoolify(), cti, odchoziIp: "192.0.2.7",
      sonda: async (_ip, p) => (proklepnute.push(p), p === 22 ? "otevreno" : "bez-odpovedi"),
    });
    return { r, proklepnute: proklepnute.sort((a, b) => a - b) };
  };

  it("T11: deklarace CI VM chybí nebo není port → NEZMĚŘENO s důvodem (kód 3), port se nesonduje; KOTVA: platná deklarace → měří a `?` není", async () => {
    expect(KLIC_CI_VM, "deklarace má domov: klíč vrstvy").toBe("ACCEL_CI_VM_SSH_PORT");
    const kotva = await behSDeklaraci(env());
    expect(kotva.r.kod).toBe(0);
    expect(nemerene(kotva.r)).toEqual([]);
    expect(kotva.proklepnute).toContain(PORT_CI_VM);

    const NENI = "ACCEL_CI_VM_SSH_PORT není deklarovaný — deklaruj port (1–65535), nebo 'zadna', když na hostiteli uzlu CI VM není";
    const neniPort = (h) => `ACCEL_CI_VM_SSH_PORT='${h}' není port (celé číslo 1–65535) ani 'zadna'`;
    for (const [hodnota, duvod] of [
      [undefined, NENI],
      ["", NENI],
      ["   ", NENI],
      ["ssh", neniPort("ssh")],
      ["0", neniPort("0")],
      ["70000", neniPort("70000")],
      ["0x16", neniPort("0x16")],
      // Výslovné „žádná CI VM" je PRÁVĚ slovo `zadna` — nic podobného se nedomýšlí.
      ["Zadna", neniPort("Zadna")],
      ["žádná", neniPort("žádná")],
      ["none", neniPort("none")],
      ["false", neniPort("false")],
    ]) {
      const { r, proklepnute } = await behSDeklaraci(env({ ACCEL_CI_VM_SSH_PORT: hodnota }));
      expect(nemerene(r), String(hodnota)).toEqual([`? gpu: port SSH do CI VM NEZMĚŘEN — ${duvod}`]);
      expect(r.kod, `hodnota ${hodnota} se nesmí tvářit jako změřená`).toBe(3);
      expect(proklepnute, "pevná sada se měří dál, port CI VM ne").toEqual([22, 80, 443, 8000, 8080]);
    }

    // Výklad sám: port jen jako desetinné číslo 1–65535.
    expect(portCiVm(env())).toEqual({ port: PORT_CI_VM, zadna: false, duvod: null });
    expect(portCiVm(env({ ACCEL_CI_VM_SSH_PORT: " 65535 " })).port).toBe(65535);
    expect(portCiVm(env({ ACCEL_CI_VM_SSH_PORT: "65536" })).port).toBeNull();
  });

  it("T11: výslovné `zadna` = na hostiteli žádná CI VM → port se NEMĚŘÍ a výstup to ŘEKNE řádkem `· ` (ne `? `), kód 0; KOTVA: číslo → port se měří", async () => {
    const kotva = await behSDeklaraci(env());
    expect(kotva.proklepnute).toEqual([22, 80, 443, 8000, 8080, PORT_CI_VM]);
    expect(kotva.r.radky.some((x) => x.includes("se neměří"))).toBe(false);

    const { r, proklepnute } = await behSDeklaraci(env({ ACCEL_CI_VM_SSH_PORT: "zadna" }));
    expect(r.radky.filter((x) => x.includes("port SSH do CI VM"))).toEqual([
      "· gpu: port SSH do CI VM se neměří — ACCEL_CI_VM_SSH_PORT=zadna (na hostiteli uzlu žádná CI VM není)",
    ]);
    expect(nemerene(r), "výslovné „žádná“ není NEZMĚŘENO").toEqual([]);
    expect(r.kod, r.radky.join("\n")).toBe(0);
    expect(proklepnute).toEqual([22, 80, 443, 8000, 8080]);
    expect(portCiVm(env({ ACCEL_CI_VM_SSH_PORT: " zadna " }))).toEqual({ port: null, zadna: true, duvod: null });
  });

  it("⛔ T11: deklarace se přizná i tehdy, když TCP sondu změřit nejde (odchozí IP neznámá)", async () => {
    const r = await mer({ ...falesnyCoolify(), cti: env({ ACCEL_CI_VM_SSH_PORT: "" }), odchoziIp: null, sonda: sonda([]) });
    expect(r.kod).toBe(2);
    expect(nemerene(r).some((x) => x.includes("port SSH do CI VM NEZMĚŘEN"))).toBe(true);
  });
});

describe("kontrola kontejnerů na uzlu je součást měření (T4 ve fázi V)", () => {
  const uzelSProxy = async (slot) => ({
    vysledek: "nalez",
    radky: [`· ${slot}: firewall hostitele 'vrstva-accel-hostfw' — stav VYNUCENO (měřeno: healthcheck kontejneru)`, `✗ proxy na uzlu: ${slot}: kontejner proxy serveru 'coolify-proxy' publikuje 80/tcp`],
    firewall: { stav: "VYNUCENO", duvod: null },
  });

  it("T4 (fáze V): proxy na uzlu publikuje porty a firewall je VYNUCENO, zvenku vše zavřené → přesto NÁLEZ (kód 1); KOTVA: uzel bez proxy → kód 0", async () => {
    const kotva = await mer({ ...falesnyCoolify(), cti: env(), odchoziIp: "192.0.2.7", sonda: sonda([22]), kontrolaUzlu: uzel("VYNUCENO") });
    expect(kotva.kod, kotva.radky.join("\n")).toBe(0);
    const r = await mer({ ...falesnyCoolify(), cti: env(), odchoziIp: "192.0.2.7", sonda: sonda([22]), kontrolaUzlu: uzelSProxy });
    expect(r.kod).toBe(1);
    expect(nalezy(r)).toEqual(["✗ proxy na uzlu: gpu: kontejner proxy serveru 'coolify-proxy' publikuje 80/tcp"]);
    // Zvenku je všechno podle očekávání — nález je JEN z uzlu.
    expect(r.radky.filter((x) => x.startsWith("✓") && x.includes("TCP"))).toHaveLength(6);
  });

  it("⛔ kontrola uzlu NEZMĚŘENA nebo spadne → `?` a kód 3, nikdy 0; běží i bez odchozí IP", async () => {
    const nemerenyUzel = async (slot) => ({ vysledek: "nemereno", radky: [`? ${slot}: proxy na uzlu NEZMĚŘENA — chybí kotva`], firewall: { stav: null, duvod: "chybí kotva" } });
    const r = await mer({ ...falesnyCoolify(), cti: env(), odchoziIp: "192.0.2.7", sonda: sonda([22]), kontrolaUzlu: nemerenyUzel });
    expect(r.kod).toBe(3);
    const spadla = await mer({ ...falesnyCoolify(), cti: env(), odchoziIp: "192.0.2.7", sonda: sonda([22]), kontrolaUzlu: async () => { throw new Error("docker není"); } });
    expect(spadla.kod).toBe(3);
    expect(nemerene(spadla)[0]).toMatch(/proxy na uzlu NEZMĚŘENA — kontrola kontejnerů selhala \(docker není\)/);
    const bezIp = await mer({ ...falesnyCoolify(), cti: env(), odchoziIp: null, sonda: sonda([]), kontrolaUzlu: uzelSProxy });
    expect(bezIp.kod, "nález z uzlu nepotřebuje odchozí IP").toBe(1);
  });
});

describe("pomocné výklady", () => {
  it("ports_mappings → TCP porty hostitele (UDP pryč, IP vazba pryč)", () => {
    expect(tcpPortyMapovani("8080:80,5000:5000/udp,127.0.0.1:9000:9000,3000-3002:3000-3002")).toEqual([8080, 9000, 3000, 3001, 3002]);
    expect(tcpPortyMapovani(null)).toEqual([]);
  });

  it("compose: služba za vypnutým profilem se nepočítá", async () => {
    const t = "services:\n  a:\n    profiles: [dvere]\n    ports: [\"1111:1\"]\n  b:\n    ports:\n      - published: 2222\n        target: 2\n";
    expect(await tcpPortyCompose(t, () => undefined)).toEqual([2222]);
    expect((await tcpPortyCompose(t, (k) => (k === "COMPOSE_PROFILES" ? "dvere" : undefined))).sort()).toEqual([1111, 2222]);
  });

  it("aplikace bez údaje o serveru = neznámo (null), ne „jinde“", () => {
    expect(naServeru({}, { uuid: "s" })).toBeNull();
    expect(naServeru({ destination: { server_id: 4 } }, { id: 4 })).toBe(true);
  });

  it("očekávání: 22 podle správy a režimu, ostatní vždy zavřené", () => {
    expect(ocekavani(22, { rezim: "enforce", odchoziVSprave: true }).ocekavam).toBe("otevreno");
    expect(ocekavani(22, { rezim: "enforce", odchoziVSprave: false }).ocekavam).toBe("zavreno");
    expect(ocekavani(22, { rezim: "measure", odchoziVSprave: false }).ocekavam).toBe("libovolne");
    expect(ocekavani(22, { rezim: null, odchoziVSprave: false }).ocekavam).toBe("libovolne");
    // (b) deklarace uzlu: stanovišti ve správě pouští firewall každý port — otevřený smí být.
    expect(ocekavani(8000, { rezim: "measure", odchoziVSprave: true }).ocekavam).toBe("smi-otevreno");
    expect(ocekavani(8000, { rezim: "enforce", odchoziVSprave: false }).ocekavam).toBe("zavreno");
    expect(ocekavani(8000, { rezim: null, odchoziVSprave: true }).ocekavam, "bez platné deklarace nic").toBe("zavreno");
    // (a) SSH světu: otevřený odevšad, v obou režimech; „světu" nepřelévá na jiný port.
    for (const rezim of ["enforce", "measure"]) {
      expect(ocekavani(22, { rezim, ssh: "svet", odchoziVSprave: false }).ocekavam).toBe("otevreno");
      expect(ocekavani(8080, { rezim, ssh: "svet", odchoziVSprave: false }).ocekavam).toBe("zavreno");
    }
    // Port SSH do CI VM: na režimu firewallu nezáleží, rozhoduje stanoviště.
    for (const rezim of ["enforce", "measure"]) {
      expect(ocekavani(PORT_CI_VM, { rezim, odchoziVSprave: true, portSshCiVm: PORT_CI_VM }).ocekavam).toBe("smi-otevreno");
      expect(ocekavani(PORT_CI_VM, { rezim, odchoziVSprave: false, portSshCiVm: PORT_CI_VM }).ocekavam).toBe("zavreno");
    }
    expect(ocekavani(PORT_CI_VM, { rezim: null, odchoziVSprave: false, portSshCiVm: PORT_CI_VM }).ocekavam).toBe("libovolne");
    expect(ocekavani(22, { rezim: "enforce", odchoziVSprave: false, portSshCiVm: 22 }).ocekavam, "22 je vždy SSH hostitele").toBe("zavreno");
  });

  it("odchozí adresa: výslovná musí být IP; echo vrací text; nesmysl = null", async () => {
    expect(await odchoziAdresa({ odchoziIp: "192.0.2.7" })).toBe("192.0.2.7");
    expect(await odchoziAdresa({ odchoziIp: "nesmysl" })).toBeNull();
    const f = async () => ({ ok: true, text: async () => "198.51.100.4\n" });
    expect(await odchoziAdresa({ echoUrl: "http://echo.invalid", fetchFn: f })).toBe("198.51.100.4");
    expect(await odchoziAdresa({ echoUrl: "http://echo.invalid", fetchFn: async () => ({ ok: true, text: async () => "<html>" }) })).toBeNull();
    expect(await odchoziAdresa({})).toBeNull();
  });

  it("skutečná TCP sonda na loopback: otevřený a odmítnutý port", async () => {
    const srv = createServer((s) => s.end());
    await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
    const port = srv.address().port;
    expect(await tcpSonda("127.0.0.1", port, 2000)).toBe("otevreno");
    await new Promise((ok) => srv.close(ok));
    expect(await tcpSonda("127.0.0.1", port, 2000)).toBe("odmitnuto");
  });
});

describe("CLI: fáze V skládá kontrolu uzlu, pravidlo UDP a deklaraci CI VM (falešný docker a falešné Coolify)", () => {
  const SKRIPT = fileURLToPath(new URL("./vnejsi-expozice.mjs", import.meta.url));
  const FW = "vrstva-accel-hostfw";
  const radek = (jmeno, porty = "") => JSON.stringify({ Names: jmeno, Networks: jmeno === FW ? "host" : "bridge", Ports: porty, State: "running", Status: "Up 2 hours" });
  const zdravi = (stav) => JSON.stringify({ Status: "running", Health: { Log: [{ ExitCode: 0, Output: `stav ${stav}\n` }] } });
  let adresar;
  let http;
  let url;
  beforeAll(async () => {
    adresar = mkdtempSync(join(tmpdir(), "vnejsi-expozice-cli-"));
    writeFileSync(
      join(adresar, "docker"),
      ["#!/bin/sh", '[ "$1" = "-H" ] || exit 64', 'case "$3" in', '  ps) cat "$FALESNY_DOCKER_PS" ;;', '  inspect) cat "$FALESNY_DOCKER_INSPECT" ;;', "  *) exit 64 ;;", "esac", ""].join("\n"),
    );
    chmodSync(join(adresar, "docker"), 0o755);
    http = createHttpServer((req, res) => {
      const cesta = (req.url ?? "").replace(/^\/api\/v1/, "");
      const telo =
        cesta === "/servers/srv-a"
          ? { uuid: "srv-a", name: "Uzel", ip: UZEL }
          : cesta === "/applications"
            ? [{ uuid: "a1", name: "sluzba-s-udp", destination: { server: { uuid: "srv-a" } }, ports_mappings: "443:443/udp" }]
            : null;
      res.writeHead(telo === null ? 404 : 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(telo ?? { message: "neznám" }));
    });
    await new Promise((ok) => http.listen(0, "127.0.0.1", ok));
    url = `http://127.0.0.1:${http.address().port}`;
  });
  afterAll(async () => {
    await new Promise((ok) => http.close(ok));
    rmSync(adresar, { recursive: true, force: true });
  });

  /** Bez --odchozi-ip: TCP sonda se nespustí (žádné spojení ven), měří se uzel a pravidla. */
  function spust({ ps, stav, extra = {} }) {
    writeFileSync(join(adresar, "ps.txt"), `${ps.join("\n")}\n`);
    writeFileSync(join(adresar, "inspect.txt"), `${zdravi(stav)}\n`);
    const prostredi = {
      PATH: `${adresar}:${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: adresar,
      FALESNY_DOCKER_PS: join(adresar, "ps.txt"),
      FALESNY_DOCKER_INSPECT: join(adresar, "inspect.txt"),
      COOLIFY_URL: url,
      COOLIFY_API_TOKEN: "zkusebni-token",
      ACCEL_ENABLED: "1",
      ACCEL_OWNER_PREFIX: "vrstva",
      ACCEL_FW_NODE_OWNER: "vrstva",
      GPU_HOSTNAME: "uzel-gpu",
      ACCEL_FW_MODE: "enforce",
      ACCEL_FW_SSH: "sprava",
      ACCEL_FW_ADMIN_CIDRS: SPRAVA,
      COOLIFY_SERVER_UUID_GPU: "srv-a",
      ACCEL_FW_UDP_MESH_PORT: String(MESH),
      ...extra,
    };
    return new Promise((hotovo) => {
      const p = spawn(process.execPath, [SKRIPT], { env: prostredi });
      let out = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (out += d));
      p.on("close", (kod) => hotovo({ kod, out }));
    });
  }

  it("T4 + T6 + T11 (CLI): proxy publikuje porty a firewall je MERENI → kód 1, nález z uzlu i k UDP; KOTVA: uzel bez proxy a firewall VYNUCENO → žádný ✗; deklarace CI VM se přizná", async () => {
    const kotva = await spust({ ps: [radek(FW)], stav: "VYNUCENO" });
    expect(kotva.out).not.toMatch(/^✗/m);
    expect(kotva.out).toMatch(/^✓ gpu: žádný kontejner proxy serveru/m);
    expect(kotva.out).toMatch(/^✓ gpu: UDP 443 publikuje aplikace sluzba-s-udp — firewall na uzlu je ve stavu VYNUCENO/m);
    // TCP bez odchozí IP a port CI VM bez deklarace jsou NEZMĚŘENO — kód 3, ne 0.
    expect(kotva.out).toMatch(/^\? gpu: odchozí IP stanoviště neznám/m);
    expect(kotva.out).toMatch(/^\? gpu: port SSH do CI VM NEZMĚŘEN — ACCEL_CI_VM_SSH_PORT není deklarovaný/m);
    expect(kotva.kod, kotva.out).toBe(3);

    const r = await spust({ ps: [radek(FW), radek("coolify-proxy", "0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp, 0.0.0.0:443->443/udp")], stav: "MERENI", extra: { ACCEL_CI_VM_SSH_PORT: "zadna" } });
    expect(r.kod, r.out).toBe(1);
    expect(r.out).toMatch(/^· gpu: port SSH do CI VM se neměří — ACCEL_CI_VM_SSH_PORT=zadna/m);
    expect(r.out).toMatch(/^✗ proxy na uzlu: gpu: kontejner proxy serveru 'coolify-proxy' publikuje 80\/tcp, 443\/tcp, 443\/udp/m);
    expect(r.out).toMatch(/^✗ gpu: UDP 443 publikuje aplikace sluzba-s-udp a firewall na uzlu je ve stavu MERENI \(měřeno; deklarovaný režim enforce\)/m);
  }, 60_000);

  it("R1 (CLI): kontejner MIMO Coolify publikuje UDP port a firewall je VYNUCENO → pravidlo UDP ho nevidí, výpis uzlu ano: `✗ port na uzlu` a kód 1; KOTVA: port meshe publikovaný týmž kontejnerem → jen `· ` výjimka, žádný ✗", async () => {
    const mimoCoolify = await spust({ ps: [radek(FW), radek("cizi-relay", "0.0.0.0:3478->3478/udp")], stav: "VYNUCENO", extra: { ACCEL_CI_VM_SSH_PORT: "zadna" } });
    expect(mimoCoolify.kod, mimoCoolify.out).toBe(1);
    expect(mimoCoolify.out).toMatch(/^✗ port na uzlu: gpu: kontejner 'cizi-relay' publikuje 3478\/udp na 0\.0\.0\.0 mimo loopback a mimo deklaraci/m);
    // Pravidlo UDP (porty z aplikací Coolify) o tomhle kontejneru nic neví — mluví jen o své aplikaci.
    expect(mimoCoolify.out).not.toMatch(/^[✓✗] gpu: UDP 3478/m);

    const mesh = await spust({ ps: [radek(FW), radek("cizi-relay", `0.0.0.0:${MESH}->${MESH}/udp`)], stav: "VYNUCENO", extra: { ACCEL_CI_VM_SSH_PORT: "zadna" } });
    expect(mesh.out).not.toMatch(/^✗/m);
    expect(mesh.out).toMatch(new RegExp(`^· gpu: kontejner 'cizi-relay' publikuje UDP ${MESH} — deklarovaný port meshe \\(ACCEL_FW_UDP_MESH_PORT\\)`, "m"));
  }, 60_000);
});
