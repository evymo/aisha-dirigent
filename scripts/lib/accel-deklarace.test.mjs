import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  adresaVCidrech,
  adresySpravy,
  DEKLARACE_PORTU_CI_VM,
  deklaraceFirewallu,
  portCiVm,
  posudAccel,
  posudVlastnika,
  rezimFirewallu,
  sshFirewallu,
  udpPortMeshe,
  vlastnikUzlu,
} from "./accel-deklarace.mjs";
import { kliceVrstvy } from "./derive-accel-uzel.mjs";

// Adresy jen z dokumentačních rozsahů (RFC 5737 / RFC 3849) — žádná data instance.
const SPRAVA = "192.0.2.10/32,2001:db8::/48";
const ctecka = (env) => (k) => env[k];
/** Instance je vlastníkem uzlu (deklarace uzlu) — bez toho firewall nenaběhne. */
const VLASTNIK = { ACCEL_OWNER_PREFIX: "instance-a", ACCEL_FW_NODE_OWNER: "instance-a" };

describe("režim firewallu: známá hodnota platí, cokoli jiného = žádný režim (fail-closed) + chyba", () => {
  it("measure i enforce projdou beze změny", () => {
    expect(rezimFirewallu("measure")).toEqual({ rezim: "measure", chyba: null });
    expect(rezimFirewallu("enforce")).toEqual({ rezim: "enforce", chyba: null });
  });

  it("⛔ neznámá hodnota = ŽÁDNÝ režim (null) — ani measure (otevřeno), ani enforce", () => {
    for (const v of ["Enforce", "on", "1", "enforcee", "drop"]) {
      const r = rezimFirewallu(v);
      expect(r.rezim, v).toBeNull();
      expect(r.chyba).toMatch(/NENABĚHNE/);
    }
  });

  it("⛔ prázdno je taky neznámá hodnota — žádný režim, ne tiché measure", () => {
    const r = rezimFirewallu("");
    expect(r.rezim).toBeNull();
    expect(r.chyba).toMatch(/není deklarovaný/);
  });
});

describe("adresy správy (ACCEL_FW_ADMIN_CIDRS)", () => {
  it("platné IPv4 i IPv6 CIDR projdou", () => {
    expect(adresySpravy(SPRAVA)).toEqual({ cidrs: ["192.0.2.10/32", "2001:db8::/48"], chyby: [] });
  });

  it("⛔ prázdný seznam je fail-closed — cidrs null (nepoužitelné), ne prázdný seznam", () => {
    const r = adresySpravy("  ");
    expect(r.cidrs).toBeNull();
    expect(r.chyby.join()).toMatch(/fail-closed/);
  });

  it("⛔ blok internetu není adresa správy — /0, /1 i cokoli pod /8 (v4) a /16 (v6)", () => {
    for (const v of ["0.0.0.0/0", "0.0.0.0/1", "128.0.0.0/1", "192.0.0.0/7", "::/0", "::/1", "2001::/15"]) {
      const r = adresySpravy(v);
      expect(r.cidrs, v).toBeNull();
      expect(r.chyby.join(), v).toMatch(/blok internetu/);
    }
    expect(adresySpravy("192.0.0.0/8").cidrs).toEqual(["192.0.0.0/8"]);
    expect(adresySpravy("2001:db8::/16").cidrs).toEqual(["2001:db8::/16"]);
  });

  it("adresa bez masky, neplatná IP i přetečená maska jsou chyba — a pak se NEPOUŽIJE nic", () => {
    for (const v of ["192.0.2.10", "192.0.2.300/32", "192.0.2.0/33", "2001:db8::/129", "správa/24"]) {
      const r = adresySpravy(`${v},198.51.100.0/24`);
      expect(r.chyby.length, v).toBe(1);
      expect(r.cidrs, `${v}: polovičatý seznam by zamkl, co chybí`).toBeNull();
    }
  });
});

describe("identita vrstvy (ACCEL_OWNER_PREFIX)", () => {
  it("jméno použitelné pro kontejner i svazek projde", () => {
    expect(posudVlastnika("instance-a")).toBeNull();
    expect(posudVlastnika("a1")).toBeNull();
  });

  it("⛔ prázdná identita se NEODVOZUJE z APP_NAME_PREFIX — je to chyba", () => {
    expect(posudVlastnika("")).toMatch(/NEODVOZUJE/);
  });

  it("velká písmena, podtržítko, pomlčka na kraji a mezera jsou chyba", () => {
    for (const v of ["Instance", "inst_a", "-inst", "inst-", "inst a"]) expect(posudVlastnika(v), v).toMatch(/není použitelné/);
  });
});

describe("posudek firewallu — bez deklarace uzlu bez účinku, s lane firewallu fail-closed", () => {
  it("bez hodnot: žádný nález (instance bez GPU uzlu)", () => {
    expect(posudAccel(ctecka({}))).toEqual([]);
  });

  it("posudek soudí jen firewall: lane vstupu a enginů (klíče z deklarace uzlu) ani zrušené přepínače ho neotevírají; KOTVA: lane firewallu ano", () => {
    // Deklaraci lane vstupu a enginů vykládá a ověřuje lib/accel-uzel.mjs (odvození selže
    // celé, ne po klíčích); posudek vrstvy je jen o proměnných firewallu.
    const laneBezFirewallu = { ACCEL_DEKLARACE_B64: "x", ACCEL_EMBED_1_REPO: "org/model", ACCEL_EMBED_2_REPO: "org/model" };
    expect(posudAccel(ctecka(laneBezFirewallu))).toEqual([]);
    // ACCEL_ENABLED / ACCEL_LANE_ENABLED a sady lane CHAT/EMBED/RERANK už nikdo nečte.
    expect(posudAccel(ctecka({ ACCEL_ENABLED: "1", ACCEL_LANE_ENABLED: "1", ACCEL_CHAT_REVISION: "main", ACCEL_CHAT_GPU_SHARE: "1.5" }))).toEqual([]);
    const sFirewallem = posudAccel(ctecka({ ...laneBezFirewallu, ACCEL_FW_NODE_OWNER: "instance-a" }));
    expect(sFirewallem.some((c) => c.includes("ACCEL_OWNER_PREFIX")), "měřidlo: lane firewallu posudek otevře").toBe(true);
  });

  it("⛔ deklarovaný uzel (lane firewallu z katalogu) bez ostatních deklarací: identita, režim, volba SSH i adresy správy chybí — i se zavřenou lane vrstvy", () => {
    for (const otevre of [{ ACCEL_FW_NODE_OWNER: "instance-a" }, { ACCEL_FW_SSH: "svet" }]) {
      const chyby = posudAccel(ctecka(otevre));
      expect(chyby.some((c) => c.includes("ACCEL_OWNER_PREFIX")), JSON.stringify(otevre)).toBe(true);
      expect(chyby.some((c) => c.includes("ACCEL_FW_MODE")), JSON.stringify(otevre)).toBe(true);
      expect(chyby.some((c) => c.includes("ACCEL_FW_ADMIN_CIDRS")), JSON.stringify(otevre)).toBe(true);
    }
    // Lane firewallu se čte z katalogu (jeden domov), ne z opisu: vstřiknutá jiná lane ji přebije.
    expect(posudAccel(ctecka({ ACCEL_FW_NODE_OWNER: "instance-a" }), { laneFirewallu: "JINY_PREPINAC" })).toEqual([
      expect.stringMatching(/ACCEL_FW_NODE_OWNER není deklarovaný|NENÍ vlastník|ACCEL_OWNER_PREFIX není deklarovaný/),
    ]);
  });

  it("úplná deklarace firewallu projde", () => {
    const env = { ACCEL_OWNER_PREFIX: "instance-a", ACCEL_FW_NODE_OWNER: "instance-a", ACCEL_FW_MODE: "measure", ACCEL_FW_SSH: "sprava", ACCEL_FW_ADMIN_CIDRS: SPRAVA };
    expect(posudAccel(ctecka(env))).toEqual([]);
  });

  it("vyplněná hodnota se posuzuje i bez lane (překlep se ukáže dřív, než se lane zapne)", () => {
    expect(posudAccel(ctecka({ ACCEL_FW_MODE: "enforec" }))).toHaveLength(1);
    // ACCEL_FW_SSH je zároveň přepínač firewallu (lane accel-hostfw v katalogu): vyplněná
    // hodnota firewall zapíná, takže se hlásí i ostatní chybějící deklarace — překlep mezi nimi.
    expect(posudAccel(ctecka({ ACCEL_FW_SSH: "vsem" }))).toContain("ACCEL_FW_SSH='vsem' není svet|sprava — firewall NENABĚHNE, oprav hodnotu");
    expect(posudAccel(ctecka({ ACCEL_FW_ADMIN_CIDRS: "0.0.0.0/0" }))).toHaveLength(1);
  });


});

describe("výklad pro firewall hostitele (spotřebitel accel-hostfw)", () => {
  it("platná deklarace se rozdělí podle rodiny (iptables / ip6tables) a nese volbu SSH uzlu", () => {
    for (const ssh of ["svet", "sprava"]) {
      expect(deklaraceFirewallu(ctecka({ ...VLASTNIK, ACCEL_FW_MODE: "enforce", ACCEL_FW_SSH: ssh, ACCEL_FW_ADMIN_CIDRS: SPRAVA }))).toEqual({
        rezim: "enforce",
        ssh,
        udpMesh: null,
        cidrs4: ["192.0.2.10/32"],
        cidrs6: ["2001:db8::/48"],
        chyby: [],
      });
    }
  });

  it("⛔ volba SSH je v deklaraci uzlu, ne v kódu: chybějící, prázdná nebo neznámá = žádná volba a chyba (fail-closed)", () => {
    expect(sshFirewallu("svet")).toEqual({ ssh: "svet", chyba: null });
    expect(sshFirewallu(" sprava ")).toEqual({ ssh: "sprava", chyba: null });
    for (const v of [undefined, "", "  ", "Svet", "svět", "vsem", "world", "admin", "1"]) {
      const r = sshFirewallu(v);
      expect(r.ssh, String(v)).toBeNull();
      expect(r.chyba, String(v)).toMatch(/ACCEL_FW_SSH.*NENABĚHNE/);
    }
  });

  it("⛔ jedna vadná deklarace = NEPLATÍ NIC — ani režim, ani SSH, ani adresy (polovičatá sada by zamkla správu)", () => {
    for (const env of [
      { ...VLASTNIK, ACCEL_FW_MODE: "enforce", ACCEL_FW_SSH: "sprava", ACCEL_FW_ADMIN_CIDRS: "" },
      { ...VLASTNIK, ACCEL_FW_MODE: "", ACCEL_FW_SSH: "sprava", ACCEL_FW_ADMIN_CIDRS: SPRAVA },
      { ...VLASTNIK, ACCEL_FW_MODE: "measure", ACCEL_FW_SSH: "sprava", ACCEL_FW_ADMIN_CIDRS: "192.0.2.10/32,0.0.0.0/0" },
      { ...VLASTNIK, ACCEL_FW_MODE: "enforce", ACCEL_FW_ADMIN_CIDRS: SPRAVA },
      { ...VLASTNIK, ACCEL_FW_MODE: "enforce", ACCEL_FW_SSH: "vsem", ACCEL_FW_ADMIN_CIDRS: SPRAVA },
      // Cizí identita nebo chybějící vlastník uzlu: platná sada pravidel, ale ne pro tuhle instanci.
      { ACCEL_OWNER_PREFIX: "instance-b", ACCEL_FW_NODE_OWNER: "instance-a", ACCEL_FW_MODE: "enforce", ACCEL_FW_SSH: "sprava", ACCEL_FW_ADMIN_CIDRS: SPRAVA },
      { ACCEL_OWNER_PREFIX: "instance-a", ACCEL_FW_MODE: "enforce", ACCEL_FW_SSH: "sprava", ACCEL_FW_ADMIN_CIDRS: SPRAVA },
    ]) {
      const d = deklaraceFirewallu(ctecka(env));
      expect(d.rezim, JSON.stringify(env)).toBeNull();
      expect(d.ssh, JSON.stringify(env)).toBeNull();
      expect(d.udpMesh, JSON.stringify(env)).toBeNull();
      expect(d.cidrs4).toBeNull();
      expect(d.cidrs6).toBeNull();
      expect(d.chyby.length).toBeGreaterThan(0);
    }
  });

  it("⛔ vlastník uzlu je deklarace uzlu: firewall smí jen instance, jejíž identita vrstvy JE vlastník; cizí, chybějící nebo vadný = STOP s příčinou; KOTVA: vlastník projde", () => {
    expect(vlastnikUzlu(ctecka(VLASTNIK))).toEqual({ smi: true, chyba: null });
    const pripady = [
      [{ ACCEL_OWNER_PREFIX: "instance-b", ACCEL_FW_NODE_OWNER: "instance-a" }, /ACCEL_OWNER_PREFIX='instance-b' NENÍ vlastník uzlu \(ACCEL_FW_NODE_OWNER='instance-a'\).*pravidla se nemění/],
      [{ ACCEL_OWNER_PREFIX: "instance-a" }, /ACCEL_FW_NODE_OWNER není deklarovaný/],
      [{ ACCEL_OWNER_PREFIX: "instance-a", ACCEL_FW_NODE_OWNER: "  " }, /ACCEL_FW_NODE_OWNER není deklarovaný/],
      [{ ACCEL_OWNER_PREFIX: "instance-a", ACCEL_FW_NODE_OWNER: "Instance-A" }, /není jméno identity vrstvy/],
      [{ ACCEL_FW_NODE_OWNER: "instance-a" }, /ACCEL_OWNER_PREFIX není deklarovaný/],
      // Podřetězec, prefix ani velikost písmen nejsou vlastnictví.
      [{ ACCEL_OWNER_PREFIX: "instance", ACCEL_FW_NODE_OWNER: "instance-a" }, /NENÍ vlastník uzlu/],
      [{ ACCEL_OWNER_PREFIX: "instance-a-2", ACCEL_FW_NODE_OWNER: "instance-a" }, /NENÍ vlastník uzlu/],
    ];
    for (const [env, duvod] of pripady) {
      const r = vlastnikUzlu(ctecka(env));
      expect(r.smi, JSON.stringify(env)).toBe(false);
      expect(r.chyba, JSON.stringify(env)).toMatch(duvod);
    }
    // Posudek vrstvy (env-doktor) to řekne dřív, než se nasazuje — jednou, ne dvakrát.
    const zapnuta = { ACCEL_FW_MODE: "measure", ACCEL_FW_SSH: "svet", ACCEL_FW_ADMIN_CIDRS: SPRAVA };
    expect(posudAccel(ctecka({ ...zapnuta, ...VLASTNIK }))).toEqual([]);
    expect(posudAccel(ctecka({ ...zapnuta, ACCEL_OWNER_PREFIX: "instance-b", ACCEL_FW_NODE_OWNER: "instance-a" }))).toEqual([expect.stringMatching(/NENÍ vlastník uzlu/)]);
    expect(posudAccel(ctecka({ ...zapnuta, ACCEL_FW_NODE_OWNER: "instance-a" })).filter((c) => /ACCEL_OWNER_PREFIX/.test(c))).toHaveLength(1);
  });

  it("⛔ UDP port meshe jen VÝSLOVNOU deklarací uzlu: prázdno = zavřeno (bez chyby), port = přesně on, cokoli jiného = chyba a firewall nenaběhne", () => {
    expect(udpPortMeshe(ctecka({}))).toEqual({ port: null, chyba: null });
    expect(udpPortMeshe(ctecka({ ACCEL_FW_UDP_MESH_PORT: "  " }))).toEqual({ port: null, chyba: null });
    expect(udpPortMeshe(ctecka({ ACCEL_FW_UDP_MESH_PORT: "40404" }))).toEqual({ port: 40404, chyba: null });
    expect(udpPortMeshe(ctecka({ ACCEL_FW_UDP_MESH_PORT: "65535" })).port).toBe(65535);
    for (const v of ["0", "65536", "0x10", "2e3", "40404,51820", "-1", "udp"]) {
      const r = udpPortMeshe(ctecka({ ACCEL_FW_UDP_MESH_PORT: v }));
      expect(r.port, v).toBeNull();
      expect(r.chyba, v).toMatch(/ACCEL_FW_UDP_MESH_PORT='.*' není port .*NENABĚHNE/);
    }
    // NETBIRD_MESH_PORT (port řídicí roviny) firewall nepřebírá — žádná výchozí hodnota z jiného klíče.
    expect(udpPortMeshe(ctecka({ NETBIRD_MESH_PORT: "40404" }))).toEqual({ port: null, chyba: null });
    // Výklad pro firewall: bez deklarace udpMesh null, s ní přesně port; vadná = NEPLATÍ NIC.
    const zaklad = { ...VLASTNIK, ACCEL_FW_MODE: "enforce", ACCEL_FW_SSH: "sprava", ACCEL_FW_ADMIN_CIDRS: SPRAVA };
    expect(deklaraceFirewallu(ctecka(zaklad)).udpMesh).toBeNull();
    expect(deklaraceFirewallu(ctecka({ ...zaklad, ACCEL_FW_UDP_MESH_PORT: "40404" })).udpMesh).toBe(40404);
    expect(deklaraceFirewallu(ctecka({ ...zaklad, ACCEL_FW_UDP_MESH_PORT: "70000" })).rezim).toBeNull();
    // Posudek vrstvy: vyplněný a vadný = chyba (i bez lane), prázdný nic.
    expect(posudAccel(ctecka({ ACCEL_FW_UDP_MESH_PORT: "70000" }))).toEqual([expect.stringMatching(/ACCEL_FW_UDP_MESH_PORT='70000'/)]);
    expect(posudAccel(ctecka({ ACCEL_FW_UDP_MESH_PORT: "" }))).toEqual([]);
  });

  it("adresa v CIDR — v rámci jedné rodiny, hranice masky přesně", () => {
    expect(adresaVCidrech("192.0.2.10", ["192.0.2.0/24"])).toBe(true);
    expect(adresaVCidrech("198.51.100.1", ["192.0.2.0/24"])).toBe(false);
    expect(adresaVCidrech("198.51.100.7", ["198.51.100.7/32"])).toBe(true);
    expect(adresaVCidrech("198.51.100.8", ["198.51.100.7/32"])).toBe(false);
    expect(adresaVCidrech("2001:db8:0:1::5", ["2001:db8::/48"])).toBe(true);
    expect(adresaVCidrech("2001:db8:1::5", ["2001:db8::/48"])).toBe(false);
    expect(adresaVCidrech("192.0.2.10", ["2001:db8::/48"]), "jiná rodina nikdy").toBe(false);
    expect(adresaVCidrech("není-adresa", ["192.0.2.0/24"])).toBe(false);
    expect(adresaVCidrech("192.0.2.10", [])).toBe(false);
  });
});

describe("CLI --firewall (čte infra/accel/hostfw.sh v kontejneru)", () => {
  const SKRIPT = fileURLToPath(new URL("./accel-deklarace.mjs", import.meta.url));
  const spust = (env) =>
    spawnSync(process.execPath, [SKRIPT, "--firewall"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", ...env },
    });

  it("platná deklarace: kód 0, režim, volba SSH, UDP port meshe (řádek vždy, prázdný = zavřeno) a CIDR po řádcích", () => {
    const r = spust({ ...VLASTNIK, ACCEL_FW_MODE: "measure", ACCEL_FW_SSH: "svet", ACCEL_FW_ADMIN_CIDRS: SPRAVA });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("rezim=measure\nssh=svet\nudp_mesh=\ncidr4=192.0.2.10/32\ncidr6=2001:db8::/48\n");
    const sUdp = spust({ ...VLASTNIK, ACCEL_FW_MODE: "measure", ACCEL_FW_SSH: "svet", ACCEL_FW_UDP_MESH_PORT: "40404", ACCEL_FW_ADMIN_CIDRS: SPRAVA });
    expect(sUdp.stdout).toBe("rezim=measure\nssh=svet\nudp_mesh=40404\ncidr4=192.0.2.10/32\ncidr6=2001:db8::/48\n");
  });

  it("⛔ bez volby SSH: kód 1 a na stdout NIC (firewall nenaběhne); KOTVA: s volbou kód 0", () => {
    const bez = spust({ ...VLASTNIK, ACCEL_FW_MODE: "enforce", ACCEL_FW_ADMIN_CIDRS: SPRAVA });
    expect(bez.status).toBe(1);
    expect(bez.stdout).toBe("");
    expect(bez.stderr).toMatch(/ACCEL_FW_SSH není deklarovaný/);
    expect(spust({ ...VLASTNIK, ACCEL_FW_MODE: "enforce", ACCEL_FW_SSH: "sprava", ACCEL_FW_ADMIN_CIDRS: SPRAVA }).status).toBe(0);
  });

  it("⛔ --vlastnik: cizí identita = kód 3 a příčina na stderr, na stdout NIC; KOTVA: vlastník = kód 0 a `vlastnik=<identita>`", () => {
    const spustV = (env) => spawnSync(process.execPath, [SKRIPT, "--vlastnik"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env } });
    const cizi = spustV({ ACCEL_OWNER_PREFIX: "instance-b", ACCEL_FW_NODE_OWNER: "instance-a" });
    expect(cizi.status).toBe(3);
    expect(cizi.stdout).toBe("");
    expect(cizi.stderr).toMatch(/ACCEL_OWNER_PREFIX='instance-b' NENÍ vlastník uzlu/);
    expect(spustV({ ACCEL_OWNER_PREFIX: "instance-a" }).status, "nedeklarovaný vlastník uzlu").toBe(3);
    const vlastnik = spustV(VLASTNIK);
    expect(vlastnik.status, vlastnik.stderr).toBe(0);
    expect(vlastnik.stdout).toBe("vlastnik=instance-a\n");
    // --firewall za cizího vlastníka nevydá sadu pravidel ani při jinak platné deklaraci.
    const fwCizi = spust({ ACCEL_OWNER_PREFIX: "instance-b", ACCEL_FW_NODE_OWNER: "instance-a", ACCEL_FW_MODE: "enforce", ACCEL_FW_SSH: "sprava", ACCEL_FW_ADMIN_CIDRS: SPRAVA });
    expect(fwCizi.status).not.toBe(0);
    expect(fwCizi.stdout).toBe("");
  });

  it("⛔ neplatná deklarace: kód 1 a na stdout NIC — spotřebitel nemá z čeho sestavit pravidla", () => {
    const r = spust({ ...VLASTNIK, ACCEL_FW_MODE: "zapnuto", ACCEL_FW_SSH: "sprava", ACCEL_FW_ADMIN_CIDRS: SPRAVA });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/NENABĚHNE/);
  });
});

describe("port SSH do CI VM (ACCEL_CI_VM_SSH_PORT): číslo, výslovné `zadna`, jinak důvod", () => {
  const cti = (hodnota) => ctecka({ ACCEL_CI_VM_SSH_PORT: hodnota });

  it("deklarace má domov: klíč vrstvy a slovo pro „žádná CI VM“", () => {
    expect(DEKLARACE_PORTU_CI_VM).toEqual({ klic: "ACCEL_CI_VM_SSH_PORT", bezCiVm: "zadna" });
  });

  it("číslo 1–65535 je port; `zadna` je výslovně žádná CI VM (bez důvodu, bez portu)", () => {
    expect(portCiVm(cti("20022"))).toEqual({ port: 20022, zadna: false, duvod: null });
    expect(portCiVm(cti("1")).port).toBe(1);
    expect(portCiVm(cti(" 65535 ")).port).toBe(65535);
    expect(portCiVm(cti("zadna"))).toEqual({ port: null, zadna: true, duvod: null });
  });

  it("⛔ chybějící, prázdná a jakákoli jiná hodnota = bez portu, NE „žádná CI VM“, s důvodem", () => {
    for (const h of [undefined, "", "  "]) {
      expect(portCiVm(cti(h)), String(h)).toEqual({ port: null, zadna: false, duvod: expect.stringMatching(/^ACCEL_CI_VM_SSH_PORT není deklarovaný — deklaruj port \(1–65535\), nebo 'zadna'/) });
    }
    for (const h of ["0", "65536", "70000", "22a", "0x16", "2e3", "-22", "22.0", "Zadna", "ZADNA", "žádná", "none", "false", "zadna!"]) {
      expect(portCiVm(cti(h)), h).toEqual({ port: null, zadna: false, duvod: `ACCEL_CI_VM_SSH_PORT='${h}' není port (celé číslo 1–65535) ani 'zadna'` });
    }
  });

  it("posudek vrstvy hlásí jen TVAR vyplněné hodnoty — chybějící deklarace firewall nezastaví (přizná ji až sonda)", () => {
    const vrstva = { ACCEL_OWNER_PREFIX: "instance-a", ACCEL_FW_NODE_OWNER: "instance-a", ACCEL_FW_MODE: "measure", ACCEL_FW_SSH: "sprava", ACCEL_FW_ADMIN_CIDRS: SPRAVA };
    expect(posudAccel(ctecka(vrstva))).toEqual([]);
    expect(posudAccel(ctecka({ ...vrstva, ACCEL_CI_VM_SSH_PORT: "20022" }))).toEqual([]);
    expect(posudAccel(ctecka({ ...vrstva, ACCEL_CI_VM_SSH_PORT: "zadna" }))).toEqual([]);
    expect(posudAccel(ctecka({ ...vrstva, ACCEL_CI_VM_SSH_PORT: "ssh" }))).toEqual(["ACCEL_CI_VM_SSH_PORT='ssh' není port (celé číslo 1–65535) ani 'zadna'"]);
    // I bez zapnuté vrstvy: překlep se ukáže dřív, než se lane otevře.
    expect(posudAccel(ctecka({ ACCEL_CI_VM_SSH_PORT: "Zadna" }))).toHaveLength(1);
  });
});

describe("zapisovatelé klíčů vrstvy: co compose a sonda čtou, dodá deklarace uzlu (nebo obsluha) — a nikdo nic nedosazuje", () => {
  const KOREN = fileURLToPath(new URL("../../", import.meta.url));
  const cti = (cesta) => readFileSync(`${KOREN}${cesta}`, "utf8");
  const DOKTOR = `${KOREN}scripts/aisha-env-doctor.mjs`;
  const IDENTITA_FIXTURY = "zk-zapisovatele";
  // Tvar nasazení se deklaruje (doktor ho nehádá); nic dalšího z prostředí stanoviště se nedědí.
  const PROSTREDI = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", AISHA_PROFILE: "cloud-multi" };
  /** Kontrakt env-doktora zvenčí: `KLÍČ\tdruh` (soubory instance se nečtou). */
  let kontraktZmereny;
  const kontrakt = () => (kontraktZmereny ??= zmerKontrakt());
  const zmerKontrakt = () => {
    const r = spawnSync(process.execPath, [DOKTOR, "--print-contract-keys"], {
      encoding: "utf8",
      env: PROSTREDI,
      maxBuffer: 16 * 1024 * 1024,
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout, "výpis kontraktu musí doletět celý").toMatch(/__CONTRACT_END__/);
    return new Map(r.stdout.split("\n").filter((l) => l.includes("\t")).map((l) => l.split("\t").slice(0, 2)));
  };

  it("kontrakt env-doktora: VŠECHNY klíče vrstvy jsou odvozené z deklarace uzlu (derived, jeden domov), jen port CI VM dodává obsluha (external)", () => {
    const k = kontrakt();
    expect(k.size, "měřidlo: kontrakt má stovky klíčů").toBeGreaterThan(100);
    for (const klic of kliceVrstvy()) expect(k.get(klic), klic).toBe("derived");
    // Kotvy z firewallu: dřív vstupy obsluhy (external) a výchozí hodnoty platformy (static).
    for (const klic of ["ACCEL_OWNER_PREFIX", "ACCEL_FW_NODE_OWNER", "ACCEL_FW_MODE", "ACCEL_FW_SSH", "ACCEL_FW_ADMIN_CIDRS", "ACCEL_FW_CONFIRM_S", "ACCEL_FW_INTERVAL_S"]) {
      expect(kliceVrstvy(), klic).toContain(klic);
    }
    expect(k.get("ACCEL_CI_VM_SSH_PORT"), "kotva: jediný vstup obsluhy vrstvy").toBe("external");
    expect(kliceVrstvy()).not.toContain("ACCEL_CI_VM_SSH_PORT");
    for (const zruseny of ["ACCEL_ENABLED", "ACCEL_LANE_ENABLED"]) expect(k.has(zruseny), zruseny).toBe(false);
    const zdroj = cti("scripts/aisha-env-doctor.mjs");
    // Hodnota z deklarace, žádný literál: platforma okno potvrzení ani periodu nedosazuje.
    expect(zdroj).toMatch(/\.\.\.kliceVrstvy\(\)\.map\(\(k\) => \[k, "derived", hodnotaVrstvyNeboPrazdno\(k\)\]\)/);
    expect(zdroj).not.toMatch(/\["ACCEL_FW_(CONFIRM|INTERVAL)_S", "static"/);
    expect(zdroj).toMatch(/\["ACCEL_CI_VM_SSH_PORT", "external", zaLaneSluzby\("accel-hostfw"\)\]/);
  });

  /** Data instance s deklarací GPU uzlu (accel/uzel.json) — overlay, který doktor čte. */
  const UZEL = {
    verze: 1, vlastnik: IDENTITA_FIXTURY, volne_sloty_blok: "10.99.240.0/21", karta: { kapacita_mib: 97887, rezerva_mib: 9789 },
    firewall: { ssh: "svet", spravci: ["192.0.2.10/32"], rezim: "measure", potvrzeni_s: 300, interval_s: 60 },
    jadro: { podsit: "10.99.0.0/28", vstup_ip: "10.99.0.2" },
    enginy: {
      "embed-1": { druh: "pooling", repo: "org/model", revize: "c".repeat(40), soubor_vah: "w.bin", format_vah: "pytorch", sha256: "d".repeat(64), vram_mib: 2600, max_model_len: 8192, start_mez_s: 600, recept: "pooling=cls" },
    },
    modely: { m1: { engine: "embed-1", dim: 1024 } },
    najemci: {
      a: {
        slot: 1, sit: { podsit: "10.99.1.0/28", vstup_ip: "10.99.1.2", rozsah_klientu: "10.99.1.8/29" },
        klice: [{ otisk_sha256: "a".repeat(64) }], vypnuto: true, trida_duvery: "x", modely: { e: { model: "m1" } },
        kvoty: { rezim: "varovani", okno_s: 60, gpu_ms_za_okno: 30000, soubeh: { dotaz: 2, davka: 1 }, davka_max_vstupu: 32 },
      },
    },
  };

  /**
   * env-doktor v APPLY nad dočasným envem (bez trezoru) a nad daty instance s deklarací uzlu —
   * týž zapisovatel jako redeploy i cold-start. `lane` = klíče, které cold-start exportuje
   * z accel-vrstva-env.sh před doktorem (lane služeb doktor čte z prostředí).
   */
  const zapisDoktoru = (vstup, lane) => {
    const adresar = mkdtempSync(join(tmpdir(), "accel-zapisovatel-"));
    try {
      const env = join(adresar, "vstup.env");
      const overlay = join(adresar, "instance");
      mkdirSync(join(overlay, "accel"), { recursive: true });
      // Deklarovaný overlay bez keycloak/ by doktor (správně) odmítl jako neúplný.
      mkdirSync(join(overlay, "keycloak"));
      writeFileSync(join(overlay, "accel", "uzel.json"), JSON.stringify(UZEL));
      // Identita fixtury je jméno, které v repu nikde není hostitelem — brána
      // hostitel-nesmi-nest-jmeno-instance-natvrdo bere každé `APP_NAME_PREFIX=<x>`
      // ve sledovaných souborech jako deklarovanou instanci.
      writeFileSync(env, `APP_NAME_PREFIX=${IDENTITA_FIXTURY}\n${vstup}`);
      const r = spawnSync(process.execPath, [DOKTOR, "--no-external"], {
        encoding: "utf8",
        env: { ...PROSTREDI, ENV_FILE: env, AISHA_INSTANCE_CONFIG_DIR: overlay, ...lane },
        maxBuffer: 16 * 1024 * 1024,
      });
      const zapsano = readFileSync(env, "utf8");
      const hodnota = (klic) => new RegExp(`^${klic}=(.*)$`, "m").exec(zapsano)?.[1];
      return { rc: r.status, err: r.stderr, hodnota };
    } finally {
      rmSync(adresar, { recursive: true, force: true });
    }
  };

  it("env-doktor zapíše hodnoty z DEKLARACE uzlu a zastaralou hodnotu v envu PŘEPÍŠE (derived); s otevřenou lane vstupu vyrobí klíč jádra; port CI VM nevymyslí", () => {
    // Jeden běh doktoru (v APPLY trvá vteřiny): v envu leží hodnoty z minula, deklarace říká jiné.
    const d = zapisDoktoru("ACCEL_FW_CONFIRM_S=600\nACCEL_FW_MODE=enforce\n", { ACCEL_FW_NODE_OWNER: IDENTITA_FIXTURY, ACCEL_DEKLARACE_B64: "x" });
    expect(d.hodnota("APP_NAME_PREFIX"), `měřidlo: doktor soubor přečetl a zapsal\n${d.err.slice(-300)}`).toBe(IDENTITA_FIXTURY);
    expect(d.hodnota("ACCEL_FW_CONFIRM_S"), "deklarace uzlu přebije hodnotu z minula").toBe("300");
    expect(d.hodnota("ACCEL_FW_INTERVAL_S"), d.err.slice(-300)).toBe("60");
    expect(d.hodnota("ACCEL_FW_MODE")).toBe("measure");
    expect(d.hodnota("ACCEL_OWNER_PREFIX")).toBe(IDENTITA_FIXTURY);
    expect(d.hodnota("ACCEL_EMBED_1_REPO")).toBe("org/model");
    expect(d.hodnota("ACCEL_EMBED_2_REPO"), "slot enginu bez deklarace = zavřená lane").toBe("");
    expect(d.hodnota("ACCEL_DEKLARACE_B64"), "vstup lane nese deklaraci, ne vstřiknutý přepínač").not.toBe("x");
    expect(d.hodnota("ACCEL_DEKLARACE_B64") ?? "").not.toBe("");
    // Tajemství lane vstupu (sdílené VB ↔ enginy) vyrábí doktor, jen když je lane otevřená.
    expect((d.hodnota("ACCEL_JADRO_API_KEY") ?? "").length).toBeGreaterThanOrEqual(20);
    // Vstup obsluhy bez trezoru: doktor ho nevyrobí ani nedosadí.
    expect(d.hodnota("ACCEL_CI_VM_SSH_PORT") ?? "").toBe("");
  }, 120_000);

  it("compose firewallu čte hodnoty HOLÉ a vede je jako povinné za běhu; každá má zapisovatele (kontrakt nebo heredoc cold-startu)", async () => {
    const { parse } = await import("yaml");
    const text = cti("docker-compose.coolify-accel-hostfw.yml");
    const compose = parse(text);
    const povinne = compose["x-aisha-povinne-za-behu"];
    expect(povinne).toEqual(expect.arrayContaining(["ACCEL_OWNER_PREFIX", "ACCEL_FW_NODE_OWNER", "ACCEL_FW_MODE", "ACCEL_FW_SSH", "ACCEL_FW_ADMIN_CIDRS", "ACCEL_FW_CONFIRM_S", "ACCEL_FW_INTERVAL_S"]));
    // UDP port meshe je VOLITELNÝ (prázdno = zavřeno): mezi povinnými není a compose ho čte s prázdnou normalizací.
    expect(povinne).not.toContain("ACCEL_FW_UDP_MESH_PORT");
    expect(povinne, "firewall už port meshe z NETBIRD_MESH_PORT nečte").not.toContain("NETBIRD_MESH_PORT");
    expect(compose.services["accel-hostfw"].environment.ACCEL_FW_UDP_MESH_PORT).toBe("${ACCEL_FW_UDP_MESH_PORT:-}");
    expect(compose.services["accel-hostfw"].environment).not.toHaveProperty("NETBIRD_MESH_PORT");
    // Žádná dosazená hodnota: `${X:-literál}` v compose firewallu není (prázdné `:-` je normalizace).
    expect([...text.matchAll(/\$\{[A-Z][A-Z0-9_]*:-[^}$][^}]*\}/g)].map((m) => m[0])).toEqual([]);
    expect(compose.services["accel-hostfw"].healthcheck.start_period).toBe("${ACCEL_FW_CONFIRM_S}s");

    const k = kontrakt();
    const heredoc = cti("scripts/aisha-cold-start.sh");
    const bezZapisovatele = povinne.filter((klic) => !k.has(klic) && !new RegExp(`^${klic}=`, "m").test(heredoc));
    expect(bezZapisovatele, "povinná hodnota, kterou nikdo nedoručí = nasazení spadne až na uzlu").toEqual([]);
    // Heredoc cold-startu propouští KAŽDÝ klíč vrstvy (odvozený výš z deklarace uzlu) i port
    // CI VM (vstup obsluhy) — prázdné `:-`, žádný literál.
    for (const klic of [...kliceVrstvy(), "ACCEL_CI_VM_SSH_PORT"]) {
      expect(heredoc, klic).toMatch(new RegExp(`^${klic}=\\$\\{${klic}:-\\}$`, "m"));
    }
  });

  it("obraz firewallu deklaruje, kde skript žije; skript ty hodnoty vyžaduje a nedosazuje", () => {
    const dockerfile = cti("Dockerfile.accel-hostfw");
    const skript = cti("infra/accel/hostfw.sh");
    for (const klic of ["HOSTFW_STAV_DIR", "HOSTFW_PROC_NET", "HOSTFW_KROK_S"]) {
      expect(dockerfile, klic).toMatch(new RegExp(`^(ENV )?\\s*${klic}=\\S+`, "m"));
      expect(skript, klic).toMatch(new RegExp(`"\\$\\{${klic}:\\?[^}]+\\}"`));
    }
    // Skript bez deklarace skončí hned, nenulou a s vysvětlením — nic nenasadí.
    const r = spawnSync("sh", [`${KOREN}infra/accel/hostfw.sh`, "--plan"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "" } });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/HOSTFW_STAV_DIR.*deklaruje obraz/);
    expect(r.stdout).toBe("");
  });
});
