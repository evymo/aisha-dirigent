// Kontrola kontejnerů NA UZLU (kontrakt oprav F1, T4): kontejner proxy serveru
// s publikovanými porty je nález bez ohledu na režim firewallu — a „proxy tu není"
// platí jen s KOTVOU (kontejner firewallu v témže výpisu). Bez kotvy a při rc ≠ 0
// je výsledek NEZMĚŘENO, nikdy ok.
//
// Žádný docker ani SSH: čistá funkce nad textem výpisu, vstřiknutý `docker`,
// u CLI falešný `docker` na PATH. Jména jsou smyšlená, ne data instance.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DRUH_NALEZU_PORTU,
  DRUH_NALEZU_PROXY,
  JMENA_PROXY,
  PRIKAZ_VYPISU,
  STAVY_FIREWALLU,
  cileSsh,
  jeDeklarovanyPort,
  jeLoopback,
  jeProxyServeru,
  jmenoKontejneruFirewallu,
  posudUzel,
  prikazInspekce,
  publikovanePorty,
  rozeberVypis,
  spustDocker,
  stavFirewalluZInspekce,
  zmerUzly,
} from "./kontejnery-uzlu.mjs";

const SKRIPT = fileURLToPath(new URL("./kontejnery-uzlu.mjs", import.meta.url));
const HOSTFW = fileURLToPath(new URL("../../infra/accel/hostfw.sh", import.meta.url));
const STROP_MS = 60_000;

const FW = "vrstva-accel-hostfw";
const radek = (k) =>
  JSON.stringify({ ID: "0123456789ab", Image: "obraz", Names: k.jmeno, Networks: k.site ?? "bridge", Ports: k.porty ?? "", State: k.stav ?? "running", Status: k.status ?? "Up 2 hours" });
const vypis = (...kontejnery) => ({ rc: 0, vystup: `${kontejnery.map(radek).join("\n")}\n`, chyba: "" });
/** Firewall hostitele běží v síti hostitele (network_mode: host) — jediná služba s katalogovým důvodem. */
const KOTVA = { jmeno: FW, site: "host", status: "Up 2 hours (healthy)" };
const JINY = { jmeno: "vrstva-neco-jineho", porty: "9000/tcp" };
/** Proxy tak, jak ji Coolify na serveru spouští: 80, 443 (i UDP pro HTTP/3) a 8080. */
const PROXY = { jmeno: "coolify-proxy", porty: "0.0.0.0:80->80/tcp, [::]:80->80/tcp, 0.0.0.0:443->443/tcp, 0.0.0.0:443->443/udp, 0.0.0.0:8080->8080/tcp" };
/** `docker inspect --format '{{json .State}}'` kontejneru firewallu s posledním výstupem healthchecku. */
const inspekce = (hlaska, { exit = 0, status = "running" } = {}) => ({
  rc: 0,
  chyba: "",
  vystup: `${JSON.stringify({
    Status: status,
    Running: status === "running",
    Health: { Status: exit === 0 ? "healthy" : "unhealthy", Log: [{ ExitCode: 1, Output: "stav STARTUJE: načítám deklarace\n" }, { ExitCode: exit, Output: `${hlaska}\n` }] },
  })}\n`,
});
const posud = (v, i = inspekce("stav VYNUCENO"), meshPort = null, sitHostitele = [FW]) => posudUzel({ slot: "uzel", jmenoFirewallu: FW, vypis: v, inspekce: i, meshPort, sitHostitele });
/** Port meshe ve fixturách — záměrně ne výchozí port NetBirdu, ať výjimka nesedí náhodou. */
const MESH = 40404;

describe("T4: kontejner proxy s publikovanými porty je nález bez ohledu na režim firewallu", () => {
  it("T4: výpis uzlu s proxy, která publikuje porty → NÁLEZ ve VŠECH stavech firewallu; KOTVA: tentýž výpis bez proxy → ok", () => {
    const bezProxy = posud(vypis(KOTVA, JINY));
    expect(bezProxy.vysledek).toBe("ok");
    expect(bezProxy.radky.filter((r) => r.startsWith("✓"))).toHaveLength(1);
    expect(bezProxy.radky.join("\n")).toMatch(/kotva 'vrstva-accel-hostfw'/);

    const stavy = [
      inspekce("stav VYNUCENO"),
      inspekce("stav MERENI"),
      inspekce("stav VRACENO: enforce NEPOTVRZEN do 900 s", { exit: 1 }),
      inspekce("stav CEKA_NA_POTVRZENI: enforce: čekám 900 s", { exit: 1 }),
      { rc: 1, vystup: "", chyba: "Error: No such object" },
      null,
    ];
    for (const i of stavy) {
      const r = posud(vypis(KOTVA, JINY, PROXY), i);
      expect(r.vysledek, `firewall: ${i ? i.vystup || i.chyba : "nečten"}`).toBe("nalez");
      const nalezy = r.radky.filter((x) => x.startsWith("✗"));
      expect(nalezy).toHaveLength(1);
      expect(nalezy[0]).toMatch(/^✗ proxy na uzlu: uzel: kontejner proxy serveru 'coolify-proxy' publikuje 80\/tcp, 443\/tcp, 443\/udp, 8080\/tcp/);
      expect(nalezy[0].startsWith(`✗ ${DRUH_NALEZU_PROXY}: `), "nález nese DRUH (prefix), podle kterého ho doktor pozná").toBe(true);
      expect(nalezy[0]).toMatch(/bez ohledu na režim firewallu/);
      expect(nalezy[0], "hláška říká, že typ v API nestačí").toMatch(/shoda typu v API nestačí/);
      expect(r.radky.some((x) => x.startsWith("✓")), "nález se nesmí tvářit jako shoda").toBe(false);
    }
  });

  it("T4: ve swarmu se proxy jmenuje coolify-proxy_traefik (úloha s příponou) — také nález; cizí jméno s podobným začátkem ne", () => {
    for (const jmeno of ["coolify-proxy_traefik", "coolify-proxy_traefik.1.k3x9q2m5", "/coolify-proxy"]) {
      expect(jeProxyServeru(jmeno), jmeno).toBe(true);
      expect(posud(vypis(KOTVA, { jmeno: jmeno.replace(/^\//, ""), porty: "0.0.0.0:443->443/tcp" })).vysledek, jmeno).toBe("nalez");
    }
    for (const jmeno of ["coolify-proxyx", "moje-coolify-proxy", "coolify", ""]) expect(jeProxyServeru(jmeno), jmeno).toBe(false);
    expect([...JMENA_PROXY]).toEqual(["coolify-proxy", "coolify-proxy_traefik"]);
  });

  it("⛔ T4: bez KOTVY je výsledek NEZMĚŘENO, nikdy ok — prázdný výpis, cizí výpis i výpis s proxy", () => {
    for (const v of [{ rc: 0, vystup: "", chyba: "" }, vypis(JINY), vypis({ jmeno: "cizi-accel-hostfw" }, JINY)]) {
      const r = posud(v);
      expect(r.vysledek).toBe("nemereno");
      expect(r.radky).toHaveLength(1);
      expect(r.radky[0]).toMatch(/^\? uzel: proxy na uzlu NEZMĚŘENA — ve výpisu \(\d+ kontejnerů\) chybí kotva, kontejner firewallu hostitele 'vrstva-accel-hostfw'/);
      expect(r.firewall.stav).toBeNull();
    }
    // Proxy ve výpisu bez kotvy: pořád NEZMĚŘENO (před prvním nasazením firewallu), ale hláška ji přizná.
    const sProxy = posud(vypis(JINY, PROXY));
    expect(sProxy.vysledek).toBe("nemereno");
    expect(sProxy.radky[0]).toMatch(/proxy 'coolify-proxy' ve výpisu JE a publikuje 80\/tcp/);
    // Kontrolní vzorek: s kotvou je tentýž výpis změřený.
    expect(posud(vypis(KOTVA, JINY)).vysledek).toBe("ok");
  });

  it("⛔ T4: rc ≠ 0 výpisu je NEZMĚŘENO s důvodem — i kdyby text vypadal jako čistý výpis s kotvou", () => {
    const cisty = vypis(KOTVA, JINY);
    expect(posud(cisty).vysledek).toBe("ok");
    for (const rc of [1, 124, 127, 255]) {
      const r = posud({ ...cisty, rc, chyba: "ssh: connect to host: Connection refused" });
      expect(r.vysledek, `rc ${rc}`).toBe("nemereno");
      expect(r.radky[0]).toMatch(new RegExp(`výpis kontejnerů uzlu skončil kódem ${rc} \\(ssh: connect to host: Connection refused\\)`));
    }
    expect(posud(undefined).vysledek).toBe("nemereno");
  });

  it("⛔ T4: výpis, kterému nerozumím (není JSON, nemá jméno, stav nebo porty, neznámý zápis portu), je NEZMĚŘENO — nic se tiše nezahodí", () => {
    const vadne = [
      [{ rc: 0, vystup: `${radek(KOTVA)}\nCONTAINER ID   IMAGE   NAMES\n` }, /řádek výpisu není JSON/],
      [{ rc: 0, vystup: `${radek(KOTVA)}\n${JSON.stringify({ Ports: "0.0.0.0:80->80/tcp", State: "running" })}\n` }, /nenese jméno kontejneru \(Names\)/],
      [{ rc: 0, vystup: `${radek(KOTVA)}\n${JSON.stringify({ Names: "coolify-proxy", Ports: "", Status: "Up 2 hours" })}\n` }, /řádek kontejneru 'coolify-proxy' nenese stav \(State\)/],
      [{ rc: 0, vystup: `${radek(KOTVA)}\n${JSON.stringify({ Names: "coolify-proxy", State: "running" })}\n` }, /řádek kontejneru 'coolify-proxy' nenese porty \(Ports\) jako řetězec/],
      // Bez sítí nejde poznat síť hostitele (F1) — chybějící Networks se nedomýšlí.
      [{ rc: 0, vystup: `${radek(KOTVA)}\n${JSON.stringify({ Names: "vllm-x", Ports: "", State: "running" })}\n` }, /řádek kontejneru 'vllm-x' nenese sítě \(Networks\) jako řetězec/],
      [vypis(KOTVA, { jmeno: "coolify-proxy", porty: "0.0.0.0:80=>80" + "->x" }), /zápisu portu '0\.0\.0\.0:80=>80->x' nerozumím/],
      // Neznámý tvar položky portu u KTERÉHOKOLI kontejneru výpisu — ne jen u proxy.
      [vypis(KOTVA, { jmeno: "vrstva-neco-jineho", porty: "0.0.0.0:9000" }), /zápisu portu '0\.0\.0\.0:9000' nerozumím/],
    ];
    for (const [v, duvod] of vadne) {
      const r = posud(v);
      expect(r.vysledek).toBe("nemereno");
      expect(r.radky).toHaveLength(1);
      expect(r.radky[0]).toMatch(/^\? uzel: proxy na uzlu NEZMĚŘENA — výpis kontejnerů uzlu nejde přečíst: /);
      expect(r.radky[0], "důvod jmenuje, co přečíst nešlo").toMatch(duvod);
    }
    // Kontrolní vzorek: tytéž řádky ve tvaru, který docker tiskne, změřené jsou (na
    // loopbacku — publikovaný port mimo loopback je od R1 nález, viz níž).
    expect(posud(vypis(KOTVA, { jmeno: "vrstva-neco-jineho", porty: "127.0.0.1:9000->9000/tcp" })).vysledek).toBe("ok");
    expect(posud(vypis(KOTVA, { jmeno: "vrstva-neco-jineho", porty: "0.0.0.0:9000->9000/tcp" })).vysledek).toBe("nalez");
  });

  it("zastavená proxy (exited, bez portů) je ok; běžící proxy bez portů mimo síť hostitele nic nevystavuje (ok); v síti hostitele = NÁLEZ (F1)", () => {
    expect(posud(vypis(KOTVA, { jmeno: "coolify-proxy", stav: "exited", status: "Exited (0) 3 hours ago", site: "host" })).vysledek, "zastavená nenaslouchá").toBe("ok");
    expect(posud(vypis(KOTVA, { jmeno: "coolify-proxy", stav: "running", site: "coolify" })).vysledek).toBe("ok");
    const host = posud(vypis(KOTVA, { jmeno: "coolify-proxy", stav: "running", site: "host" }));
    expect(host.vysledek).toBe("nalez");
    expect(host.radky.filter((x) => x.startsWith("✗"))).toEqual([expect.stringMatching(/^✗ proxy na uzlu: uzel: kontejner proxy serveru 'coolify-proxy' běží v SÍTI HOSTITELE/)]);
    // Neznámý stav kontejneru se nebere jako „neběží".
    expect(posud(vypis(KOTVA, { jmeno: "coolify-proxy", stav: "cosi", site: "host" })).vysledek).toBe("nalez");
  });
});

describe("R1: KAŽDÝ port publikovaný mimo loopback a mimo deklaraci uzlu je nález — ne podle JMÉNA kontejneru", () => {
  // ⛔ NAMĚŘENO 2026-10-05 (re-recenze d8, R1): tyhle tři případy kontrola dřív pustila jako `ok`.
  const JINE_JMENO = { jmeno: "vrstva-brana", porty: "0.0.0.0:80->80/tcp, [::]:80->80/tcp, 0.0.0.0:443->443/tcp, [::]:443->443/tcp" };
  const APLIKACE = { jmeno: "nekdo-aplikace-x1y2z3", porty: "0.0.0.0:443->443/tcp" };
  const PROXY_DVOJKA = { jmeno: "coolify-proxy-2", porty: "0.0.0.0:80->80/tcp" };
  // UDP kontejneru MIMO Coolify: pravidlo UDP vnější sondy ho nevidí (bere porty z aplikací Coolify).
  const UDP_MIMO_COOLIFY = { jmeno: "cizi-relay", porty: "0.0.0.0:3478->3478/udp, [::]:3478->3478/udp" };

  it("R1: kontejner jiného jména s 0.0.0.0:80,443, aplikace s 0.0.0.0:443, coolify-proxy-2 a UDP mimo Coolify → NÁLEZ ve VŠECH stavech firewallu, druh `port na uzlu`; KOTVA: tytéž kontejnery na loopbacku → ok", () => {
    const pripady = [
      [JINE_JMENO, /^✗ port na uzlu: uzel: kontejner 'vrstva-brana' publikuje 80\/tcp, 443\/tcp na 0\.0\.0\.0, \[::\] mimo loopback a mimo deklaraci/],
      [APLIKACE, /^✗ port na uzlu: uzel: kontejner 'nekdo-aplikace-x1y2z3' publikuje 443\/tcp na 0\.0\.0\.0 /],
      [PROXY_DVOJKA, /^✗ port na uzlu: uzel: kontejner 'coolify-proxy-2' publikuje 80\/tcp /],
      [UDP_MIMO_COOLIFY, /^✗ port na uzlu: uzel: kontejner 'cizi-relay' publikuje 3478\/udp /],
    ];
    const stavy = [inspekce("stav VYNUCENO"), inspekce("stav MERENI"), inspekce("stav VRACENO: enforce NEPOTVRZEN do 900 s", { exit: 1 }), null];
    for (const [kontejner, ocekavam] of pripady) {
      for (const i of stavy) {
        const r = posud(vypis(KOTVA, JINY, kontejner), i, MESH);
        const popis = `${kontejner.jmeno}, firewall: ${i ? i.vystup : "nečten"}`;
        expect(r.vysledek, popis).toBe("nalez");
        const nalezy = r.radky.filter((x) => x.startsWith("✗"));
        expect(nalezy, popis).toHaveLength(1);
        expect(nalezy[0], popis).toMatch(ocekavam);
        expect(nalezy[0].startsWith(`✗ ${DRUH_NALEZU_PORTU}: `), "nález nese DRUH, podle kterého ho doktor pozná").toBe(true);
        expect(nalezy[0]).toMatch(/bez ohledu na režim firewallu i na jméno kontejneru/);
        expect(nalezy[0], "hláška nese deklaraci, proti které se měřilo").toMatch(new RegExp(`jediná výjimka UDP ${MESH} meshe`));
        expect(r.radky.some((x) => x.startsWith("✓")), "nález se nesmí tvářit jako shoda").toBe(false);
      }
      // KOTVA v témže běhu: tytéž porty jen na loopbacku nejsou vystavené.
      const naLoopbacku = { ...kontejner, porty: kontejner.porty.replaceAll("0.0.0.0:", "127.0.0.1:").replaceAll("[::]:", "[::1]:") };
      const kotva = posud(vypis(KOTVA, JINY, naLoopbacku), inspekce("stav VYNUCENO"), MESH);
      expect(kotva.vysledek, `${kontejner.jmeno} na loopbacku`).toBe("ok");
      expect(kotva.radky.at(-1)).toMatch(/^✓ uzel: žádný kontejner proxy serveru .* ani jiný kontejner nepublikuje port mimo loopback a mimo deklaraci/);
    }
  });

  it("R1: všechny nálezy výpisu se vypíší (ne jen první) a proxy si drží svůj druh a hlášku", () => {
    const r = posud(vypis(KOTVA, JINE_JMENO, PROXY, UDP_MIMO_COOLIFY), inspekce("stav VYNUCENO"), MESH);
    expect(r.vysledek).toBe("nalez");
    const nalezy = r.radky.filter((x) => x.startsWith("✗"));
    expect(nalezy.map((x) => x.split(": ")[0])).toEqual([`✗ ${DRUH_NALEZU_PORTU}`, `✗ ${DRUH_NALEZU_PROXY}`, `✗ ${DRUH_NALEZU_PORTU}`]);
    expect(nalezy[1]).toMatch(/^✗ proxy na uzlu: uzel: kontejner proxy serveru 'coolify-proxy' publikuje 80\/tcp, 443\/tcp, 443\/udp, 8080\/tcp — proxy BĚŽÍ/);
  });

  it("R1: jediná deklarovaná výjimka je UDP port meshe — řečeno řádkem `· `; KOTVA: týž port bez platné deklarace, jako TCP, jako rozsah kolem něj nebo jiný UDP port → nález", () => {
    const relay = (porty) => ({ jmeno: "vrstva-netbird", porty });
    const mesh = posud(vypis(KOTVA, relay(`0.0.0.0:${MESH}->${MESH}/udp, [::]:${MESH}->${MESH}/udp`)), inspekce("stav VYNUCENO"), MESH);
    expect(mesh.vysledek, mesh.radky.join("\n")).toBe("ok");
    expect(mesh.radky).toContain(`· uzel: kontejner 'vrstva-netbird' publikuje UDP ${MESH} — deklarovaný port meshe (ACCEL_FW_UDP_MESH_PORT), jediná výjimka: firewall ho propouští v každém režimu`);

    const bezDeklarace = posud(vypis(KOTVA, relay(`0.0.0.0:${MESH}->${MESH}/udp`)), inspekce("stav VYNUCENO"), null);
    expect(bezDeklarace.vysledek).toBe("nalez");
    expect(bezDeklarace.radky.find((x) => x.startsWith("✗"))).toMatch(/deklarace uzlu: žádná výjimka — UDP port meshe \(ACCEL_FW_UDP_MESH_PORT\) nedeklarován, UDP zavřeno/);
    for (const porty of [`0.0.0.0:${MESH}->${MESH}/tcp`, `0.0.0.0:${MESH - 1}-${MESH + 1}->${MESH - 1}-${MESH + 1}/udp`, `0.0.0.0:${MESH + 1}->${MESH + 1}/udp`]) {
      expect(posud(vypis(KOTVA, relay(porty)), inspekce("stav VYNUCENO"), MESH).vysledek, porty).toBe("nalez");
    }
  });

  it("R1: proxy jen na loopbacku nic nevystavuje (ok); proxy v síti hostitele je nález i vedle nálezu jiného kontejneru (vypíšou se oba)", () => {
    expect(posud(vypis(KOTVA, { jmeno: "coolify-proxy", porty: "127.0.0.1:8080->8080/tcp" }), inspekce("stav VYNUCENO"), MESH).vysledek).toBe("ok");
    const obe = posud(vypis(KOTVA, { jmeno: "coolify-proxy", stav: "running", site: "host" }, APLIKACE), inspekce("stav VYNUCENO"), MESH);
    expect(obe.vysledek).toBe("nalez");
    expect(obe.radky.filter((x) => x.startsWith("✗")).map((x) => x.split(": ")[0])).toEqual([`✗ ${DRUH_NALEZU_PROXY}`, `✗ ${DRUH_NALEZU_PORTU}`]);
  });

  it("F1: kontejner v SÍTI HOSTITELE bez portů ve výpisu (`vllm-host`) = NÁLEZ ve všech stavech firewallu; KOTVA: firewall hostitele (sit_hostitele) v síti hostitele = ok; bez výjimky v katalogu je nález i firewall", () => {
    const vllm = { jmeno: "vllm-host", site: "host" };
    for (const i of [inspekce("stav VYNUCENO"), inspekce("stav MERENI"), null]) {
      const r = posud(vypis(KOTVA, vllm), i, MESH);
      expect(r.vysledek, i ? i.vystup : "nečten").toBe("nalez");
      expect(r.radky.filter((x) => x.startsWith("✗"))).toEqual([
        expect.stringMatching(/^✗ port na uzlu: uzel: kontejner 'vllm-host' běží v SÍTI HOSTITELE — naslouchá přímo na rozhraních stroje a výpis porty neukáže; není služba s pojmenovaným důvodem `sit_hostitele`/),
      ]);
    }
    // Kotva: firewall sám (v síti hostitele, výjimka z katalogu) = ok.
    const fw = posud(vypis(KOTVA), inspekce("stav VYNUCENO"), MESH);
    expect(fw.vysledek).toBe("ok");
    expect(fw.radky.at(-1)).toMatch(/v síti hostitele běží jen služby s důvodem sit_hostitele/);
    // Bez výjimky (katalog bez sit_hostitele) by byl nálezem i firewall — výjimka je z katalogu, ne ze jména.
    expect(posud(vypis(KOTVA), inspekce("stav VYNUCENO"), MESH, []).vysledek).toBe("nalez");
    // Sítě oddělené čárkou: host mezi nimi se pozná; jiná síť jménem „host-net" ne.
    expect(posud(vypis(KOTVA, { jmeno: "x", site: "coolify,host" }), inspekce("stav VYNUCENO"), MESH).vysledek).toBe("nalez");
    expect(posud(vypis(KOTVA, { jmeno: "x", site: "host-net" }), inspekce("stav VYNUCENO"), MESH).vysledek).toBe("ok");
  });

  it("výklad: loopback = 127.0.0.0/8 a [::1]; cokoli jiného (i mesh, LAN, [::]) je mimo loopback; deklarovaný je jen UDP port meshe přesně", () => {
    for (const a of ["127.0.0.1", "127.1.2.3", "[::1]"]) expect(jeLoopback(a), a).toBe(true);
    for (const a of ["0.0.0.0", "[::]", "100.64.0.7", "10.0.0.5", "192.0.2.9", [128, 0, 0, 1].join("."), "[::2]"]) expect(jeLoopback(a), a).toBe(false);
    expect(jeDeklarovanyPort({ port: String(MESH), proto: "udp" }, MESH)).toBe(true);
    expect(jeDeklarovanyPort({ port: String(MESH), proto: "tcp" }, MESH)).toBe(false);
    expect(jeDeklarovanyPort({ port: `${MESH}-${MESH + 1}`, proto: "udp" }, MESH)).toBe(false);
    expect(jeDeklarovanyPort({ port: String(MESH), proto: "udp" }, null)).toBe(false);
  });
});

describe("výklad výpisu", () => {
  it("publikované porty: se šipkou ano (IPv4, IPv6 v závorkách, rozsah, UDP), jen vystavené ne", () => {
    expect(publikovanePorty("0.0.0.0:80->80/tcp, [::]:80->80/tcp, [::]:443->443/udp, 8000/tcp, 3000-3002/udp, 127.0.0.1:3000-3002->3000-3002/tcp")).toEqual([
      { adresa: "0.0.0.0", port: "80", proto: "tcp" },
      { adresa: "[::]", port: "80", proto: "tcp" },
      { adresa: "[::]", port: "443", proto: "udp" },
      { adresa: "127.0.0.1", port: "3000-3002", proto: "tcp" },
    ]);
    expect(publikovanePorty("")).toEqual([]);
    expect(publikovanePorty(undefined)).toEqual([]);
  });

  it("⛔ položka portu v tvaru, který docker netiskne, je výjimka — nevykládá se a nezahazuje (ani přepis výpisu do tabulky)", () => {
    const netiskne = [
      "0.0.0.0:80->", // bez cíle a protokolu
      "0.0.0.0:80->80", // bez protokolu
      "0.0.0.0:80→80/tcp", // šipka jiným znakem (přepis do tabulky)
      "[::]:80", // IPv6 dvojče bez cíle (přepis do tabulky)
      "[::]:443/udp", // adresa bez cíle
      ":::443->443/udp", // IPv6 bez závorek
      "0.0.0.0:80->80/TCP", // protokol velkými
      "80->80/tcp", // bez adresy hostitele
      "hostitel:80->80/tcp", // jméno místo adresy
    ];
    for (const kus of netiskne) {
      expect(() => publikovanePorty(kus), kus).toThrow(/nerozumím/);
      // Jedna taková položka mezi platnými shodí celý sloupec — nic se z něj „nezachrání".
      expect(() => publikovanePorty(`0.0.0.0:443->443/tcp, ${kus}`), kus).toThrow(/nerozumím/);
    }
    // Kontrolní vzorek: tytéž porty ve tvaru dockeru projdou.
    expect(publikovanePorty("0.0.0.0:80->80/tcp, [::]:443->443/udp")).toHaveLength(2);
  });

  it("řádek výpisu = kontejner; víc jmen (odkazy) se rozdělí", () => {
    expect(rozeberVypis(`${radek({ jmeno: "a,b/c", porty: "0.0.0.0:1->1/tcp", stav: "Running" })}\n\n`)).toEqual([
      { jmena: ["a", "b/c"], porty: [{ adresa: "0.0.0.0", port: "1", proto: "tcp" }], stav: "running", site: ["bridge"] },
    ]);
    expect(rozeberVypis("")).toEqual([]);
  });

  it("příkazy jsou jen čtení: `ps` a `inspect`", () => {
    expect([...PRIKAZ_VYPISU]).toEqual(["ps", "--all", "--format", "{{json .}}"]);
    expect(prikazInspekce(FW)).toEqual(["inspect", "--type", "container", "--format", "{{json .State}}", FW]);
  });
});

describe("syrový tvar výpisu ze skutečného uzlu (`docker ps -a --format '{{json .}}'`, stav „před“, jen čtení, 2026-10-04)", () => {
  // Fixtura je OPSANÁ ze syrového výstupu uzlu: jeden objekt JSON na řádek se
  // šestnácti klíči. Z měření jsou hodnoty Names, Ports, State a Status (jména
  // Coolify zůstávají, jména cizích kontejnerů jsou zástupná). Hodnoty ostatních
  // klíčů měření neuvádí — fixtura je vyplňuje zástupným textem, parser je nečte.
  // ⛔ Neměřeno proti skutečnosti zůstává `docker inspect` kontejneru firewallu:
  // na uzlu ještě není.
  const KLICE_VYPISU = ["Command", "CreatedAt", "HealthStatus", "ID", "Image", "Labels", "LocalVolumes", "Mounts", "Names", "Networks", "Platform", "Ports", "RunningFor", "Size", "State", "Status"];
  const NEUVEDENO = "zástupná hodnota (měření ji neuvádí)";
  const radekUzlu = ({ Names, State, Status, Ports }) =>
    JSON.stringify(Object.fromEntries(KLICE_VYPISU.map((k) => [k, { Names, State, Status, Ports }[k] ?? NEUVEDENO])));
  const PORTY_PROXY =
    "0.0.0.0:80->80/tcp, [::]:80->80/tcp, 0.0.0.0:443->443/tcp, [::]:443->443/tcp, 0.0.0.0:8080->8080/tcp, [::]:8080->8080/tcp, 0.0.0.0:443->443/udp, [::]:443->443/udp";
  const UZEL_PRED = [
    { Names: "coolify-proxy", State: "running", Status: "Up 16 hours (healthy)", Ports: PORTY_PROXY },
    { Names: "coolify-sentinel", State: "running", Status: "Up 16 hours (healthy)", Ports: "" },
    { Names: "drzak-obrazu-a", State: "created", Status: "Created", Ports: "" },
    { Names: "drzak-obrazu-b", State: "created", Status: "Created", Ports: "" },
    { Names: "drzak-obrazu-c", State: "created", Status: "Created", Ports: "" },
  ];
  const FIREWALL = { Names: FW, State: "running", Status: "Up 2 minutes (healthy)", Ports: "" };
  const vypisUzlu = (...kontejnery) => ({ rc: 0, chyba: "", vystup: `${kontejnery.map(radekUzlu).join("\n")}\n` });

  it("fixtura nese právě klíče syrového výpisu a prázdné porty jako prázdný řetězec", () => {
    for (const radekVypisu of vypisUzlu(...UZEL_PRED).vystup.trim().split("\n")) {
      expect(Object.keys(JSON.parse(radekVypisu))).toEqual(KLICE_VYPISU);
    }
    expect(JSON.parse(radekUzlu(UZEL_PRED[1])).Ports).toBe("");
    expect(JSON.parse(radekUzlu(UZEL_PRED[0])).Ports).toBe(PORTY_PROXY);
  });

  it("porty proxy: IPv4 i IPv6 dvojče se šipkou, cílem a protokolem → 80/tcp, 443/tcp, 8080/tcp, 443/udp", () => {
    const porty = publikovanePorty(PORTY_PROXY);
    expect(porty).toEqual([
      { adresa: "0.0.0.0", port: "80", proto: "tcp" },
      { adresa: "[::]", port: "80", proto: "tcp" },
      { adresa: "0.0.0.0", port: "443", proto: "tcp" },
      { adresa: "[::]", port: "443", proto: "tcp" },
      { adresa: "0.0.0.0", port: "8080", proto: "tcp" },
      { adresa: "[::]", port: "8080", proto: "tcp" },
      { adresa: "0.0.0.0", port: "443", proto: "udp" },
      { adresa: "[::]", port: "443", proto: "udp" },
    ]);
    expect([...new Set(porty.map((x) => `${x.port}/${x.proto}`))]).toEqual(["80/tcp", "443/tcp", "8080/tcp", "443/udp"]);
  });

  it("výklad výpisu: jména, stav z pole State, porty jen u proxy", () => {
    expect(rozeberVypis(vypisUzlu(...UZEL_PRED).vystup).map((k) => [k.jmena, k.stav, k.porty.length])).toEqual([
      [["coolify-proxy"], "running", 8],
      [["coolify-sentinel"], "running", 0],
      [["drzak-obrazu-a"], "created", 0],
      [["drzak-obrazu-b"], "created", 0],
      [["drzak-obrazu-c"], "created", 0],
    ]);
  });

  it("T4 nad naměřeným uzlem: bez kontejneru firewallu → NEZMĚŘENO (kotva chybí) s proxy jmenovanou v hlášce; KOTVA: s kontejnerem firewallu je tentýž výpis NÁLEZ", () => {
    const dnes = posud(vypisUzlu(...UZEL_PRED));
    expect(dnes.vysledek).toBe("nemereno");
    expect(dnes.radky).toHaveLength(1);
    expect(dnes.radky[0]).toMatch(/^\? uzel: proxy na uzlu NEZMĚŘENA — ve výpisu \(5 kontejnerů\) chybí kotva, kontejner firewallu hostitele 'vrstva-accel-hostfw'/);
    expect(dnes.radky[0]).toMatch(/proxy 'coolify-proxy' ve výpisu JE a publikuje 80\/tcp, 443\/tcp, 8080\/tcp, 443\/udp$/);
    expect(dnes.firewall.stav).toBeNull();

    const poNasazeni = posud(vypisUzlu(...UZEL_PRED, FIREWALL));
    expect(poNasazeni.vysledek).toBe("nalez");
    const nalezy = poNasazeni.radky.filter((x) => x.startsWith("✗"));
    expect(nalezy).toHaveLength(1);
    expect(nalezy[0]).toMatch(/^✗ proxy na uzlu: uzel: kontejner proxy serveru 'coolify-proxy' publikuje 80\/tcp, 443\/tcp, 8080\/tcp, 443\/udp — /);
    expect(poNasazeni.radky.some((x) => x.startsWith("✓")), "nález se nesmí tvářit jako shoda").toBe(false);

    // Kontrolní vzorek: bez proxy je týž uzel v pořádku — držáky ve stavu created ani druhý kontejner Coolify nález nedělají.
    const bezProxy = posud(vypisUzlu(...UZEL_PRED.slice(1), FIREWALL));
    expect(bezProxy.vysledek).toBe("ok");
    expect(bezProxy.radky.at(-1)).toMatch(/výpis 5 kontejnerů, kotva 'vrstva-accel-hostfw'/);
  });

  it("⛔ týž uzel v přepisu do tabulky (šipka jiným znakem, IPv6 dvojče bez cíle, stav jen ve sloupci Status) se NEČTE — NEZMĚŘENO s důvodem, i s kotvou", () => {
    const prepisPortu = "0.0.0.0:80→80/tcp, [::]:80, 0.0.0.0:443→443/tcp, [::]:443, 0.0.0.0:443→443/udp, [::]:443/udp, 0.0.0.0:8080→8080/tcp, [::]:8080";
    const sPrepisem = posud(vypisUzlu({ ...UZEL_PRED[0], Ports: prepisPortu }, ...UZEL_PRED.slice(1), FIREWALL));
    expect(sPrepisem.vysledek).toBe("nemereno");
    expect(sPrepisem.radky).toEqual(["? uzel: proxy na uzlu NEZMĚŘENA — výpis kontejnerů uzlu nejde přečíst: zápisu portu '0.0.0.0:80→80/tcp' nerozumím"]);

    const bezPoleState = { rc: 0, chyba: "", vystup: `${JSON.stringify({ Names: "coolify-proxy", Status: "Up 16 hours (healthy)", Ports: PORTY_PROXY })}\n${radekUzlu(FIREWALL)}\n` };
    const bezStavu = posud(bezPoleState);
    expect(bezStavu.vysledek).toBe("nemereno");
    expect(bezStavu.radky[0]).toMatch(/výpis kontejnerů uzlu nejde přečíst: řádek kontejneru 'coolify-proxy' nenese stav \(State\)/);
  });
});

describe("stav firewallu se čte z healthchecku jeho kontejneru (měřený, ne deklarovaný)", () => {
  it("opis stavů = stavy, které hostfw.sh zapisuje (nový stav nesmí zůstat neznámý)", () => {
    const zdroj = readFileSync(HOSTFW, "utf8");
    const zapisovane = [...new Set([...zdroj.matchAll(/\bzapis_stav ([A-Z_]+)\b/g)].map((m) => m[1]))].sort();
    expect(zapisovane.length, "měřidlo: hostfw.sh nějaké stavy zapisuje").toBeGreaterThanOrEqual(5);
    expect([...STAVY_FIREWALLU].sort()).toEqual(zapisovane);
    // Healthcheck vypisuje stav ve tvaru, který se tu čte.
    expect(zdroj).toMatch(/echo "stav \$stav: \$\(cti_stav duvod\)"/);
    expect(zdroj).toMatch(/echo "stav \$stav"/);
  });

  it("každý známý stav se přečte; s důvodem za dvojtečkou i bez", () => {
    for (const s of STAVY_FIREWALLU) {
      expect(stavFirewalluZInspekce(inspekce(`stav ${s}`))).toEqual({ stav: s, duvod: null });
      expect(stavFirewalluZInspekce(inspekce(`stav ${s}: nějaký důvod`, { exit: 1 }))).toEqual({ stav: s, duvod: null });
    }
  });

  it("⛔ co přečíst nejde, je null s důvodem — nikdy odhad", () => {
    const pripady = [
      [null, /nikdo nečetl/],
      [{ rc: 1, vystup: "", chyba: "Error: No such object: x" }, /skončil kódem 1 \(Error: No such object: x\)/],
      [{ rc: 0, vystup: "ne json" }, /není JSON/],
      [{ rc: 0, vystup: "null" }, /nevydal stav/],
      [inspekce("stav VYNUCENO", { status: "exited" }), /neběží \(exited\)/],
      [{ rc: 0, vystup: JSON.stringify({ Status: "running" }) }, /healthcheck kontejneru firewallu ještě neproběhl/],
      [{ rc: 0, vystup: JSON.stringify({ Status: "running", Health: { Log: [] } }) }, /ještě neproběhl/],
      [inspekce("skok z INPUT chybí", { exit: 1 }), /nehlásí známý stav \('skok z INPUT chybí'\)/],
      [inspekce("stav neznámý", { exit: 1 }), /nehlásí známý stav/],
      [inspekce("stav ZAPNUTO"), /nehlásí známý stav \('stav ZAPNUTO'\)/],
      [inspekce("stav VYNUCENOX"), /nehlásí známý stav/],
    ];
    for (const [vstup, duvod] of pripady) {
      const r = stavFirewalluZInspekce(vstup);
      expect(r.stav, JSON.stringify(vstup)).toBeNull();
      expect(r.duvod).toMatch(duvod);
    }
  });

  it("posudek uzlu nese měřený stav firewallu a vypíše ho", () => {
    const r = posud(vypis(KOTVA), inspekce("stav VRACENO: enforce NEPOTVRZEN", { exit: 1 }));
    expect(r.firewall).toEqual({ stav: "VRACENO", duvod: null });
    expect(r.radky[0]).toBe("· uzel: firewall hostitele 'vrstva-accel-hostfw' — stav VRACENO (měřeno: healthcheck kontejneru)");
    const nectelny = posud(vypis(KOTVA), { rc: 1, vystup: "", chyba: "permission denied" });
    expect(nectelny.vysledek, "nečitelný stav firewallu nemění posudek proxy").toBe("ok");
    expect(nectelny.radky[0]).toMatch(/stav NEZMĚŘEN \(docker inspect kontejneru firewallu skončil kódem 1 \(permission denied\)\)/);
  });
});

const SERVERS = { uzel: { hostname: "${UZEL_HOSTNAME}", role: "gpu", coolify_uuid: "${X}", has_gpu: true, proxy: "none", stacks: [] } };
const SLUZBY = {
  "accel-hostfw": { placement: "uzel", provision_when_env: "ACCEL_ENABLED", compose: "docker-compose.coolify-accel-hostfw.yml", sit_hostitele: "Firewall hostitele zapisuje pravidla hostitele (fixtura)." },
};
const cti = (extra = {}) => {
  const e = { ACCEL_ENABLED: "1", ACCEL_OWNER_PREFIX: "vrstva", UZEL_HOSTNAME: "Uzel-GPU", ...extra };
  return (k) => e[k];
};
/** Falešný docker: odpovědi podle cíle a příkazu, volání se zapisují. */
function falesnyDocker(odpovedi) {
  const volani = [];
  const docker = async (cil, argumenty) => {
    volani.push([cil, ...argumenty]);
    const o = odpovedi[cil]?.[argumenty[0]];
    return o ?? { rc: 255, vystup: "", chyba: `ssh: Could not resolve hostname ${cil}` };
  };
  return { docker, volani };
}

describe("kotva a cíl se odvozují z deklarací, nehádají se", () => {
  it("jméno kontejneru firewallu = container_name jeho služby v compose větve nad identitou vrstvy", async () => {
    expect(await jmenoKontejneruFirewallu({ cti: cti(), sluzby: SLUZBY })).toEqual({ jmeno: FW, duvod: null });
  });

  it("⛔ bez identity vrstvy, bez compose v katalogu nebo s nečitelným compose: jméno null s důvodem", async () => {
    const bezIdentity = await jmenoKontejneruFirewallu({ cti: cti({ ACCEL_OWNER_PREFIX: "" }), sluzby: SLUZBY });
    expect(bezIdentity.jmeno).toBeNull();
    expect(bezIdentity.duvod).toMatch(/nejde složit — bez hodnoty: ACCEL_OWNER_PREFIX/);
    expect((await jmenoKontejneruFirewallu({ cti: cti(), sluzby: { "accel-hostfw": { placement: "uzel" } } })).duvod).toMatch(/nevede compose/);
    expect((await jmenoKontejneruFirewallu({ cti: cti(), sluzby: { "accel-hostfw": { compose: "neni.yml" } } })).duvod).toMatch(/nejde přečíst/);
    expect((await jmenoKontejneruFirewallu({ cti: cti({ ACCEL_OWNER_PREFIX: "a b" }), sluzby: SLUZBY })).duvod).toMatch(/není jméno kontejneru/);
  });

  it("cíl SSH = hostname slotu z registru; kandidáti: jak je deklarovaný a malými písmeny", () => {
    expect(cileSsh({ slot: "uzel", servers: SERVERS, cti: cti() })).toEqual({ kandidati: ["Uzel-GPU", "uzel-gpu"], duvod: null });
    expect(cileSsh({ slot: "uzel", servers: SERVERS, cti: cti({ UZEL_HOSTNAME: "uzel" }) }).kandidati).toEqual(["uzel"]);
    expect(cileSsh({ slot: "uzel", servers: SERVERS, cti: cti({ UZEL_HOSTNAME: "" }) })).toEqual({ kandidati: [], duvod: "hostname slotu 'uzel' neznám — bez hodnoty: UZEL_HOSTNAME" });
    for (const vadne of ["-oProxyCommand=x", "a b", "a/b", "uzel;x"]) {
      expect(cileSsh({ slot: "uzel", servers: SERVERS, cti: cti({ UZEL_HOSTNAME: vadne }) }).duvod, vadne).toMatch(/není použitelný jako cíl SSH/);
    }
    expect(cileSsh({ slot: "neni", servers: SERVERS, cti: cti() }).duvod).toMatch(/nemá v registru hostname/);
  });
});

describe("měření uzlů (vstřiknutý docker)", () => {
  it("lane firewallu zavřená: žádný uzel, žádné volání dockeru, kód 0 a výpis to ŘÍKÁ", async () => {
    const { docker, volani } = falesnyDocker({});
    const r = await zmerUzly({ servers: SERVERS, sluzby: SLUZBY, cti: cti({ ACCEL_ENABLED: "false" }), docker });
    expect(r.kod).toBe(0);
    expect(r.radky.join("\n")).toMatch(/nenasazuje/);
    expect(volani).toEqual([]);
  });

  it("T4 (měření): proxy s porty → kód 1; KOTVA: týž uzel bez proxy → kód 0; volá se jen `ps` a `inspect`", async () => {
    const cisty = falesnyDocker({ "Uzel-GPU": { ps: vypis(KOTVA, JINY), inspect: inspekce("stav MERENI") } });
    const ok = await zmerUzly({ servers: SERVERS, sluzby: SLUZBY, cti: cti(), docker: cisty.docker });
    expect(ok.kod, ok.radky.join("\n")).toBe(0);
    expect(ok.uzly.uzel).toEqual({ vysledek: "ok", firewall: { stav: "MERENI", duvod: null } });
    expect(cisty.volani).toEqual([
      ["Uzel-GPU", "ps", "--all", "--format", "{{json .}}"],
      ["Uzel-GPU", "inspect", "--type", "container", "--format", "{{json .State}}", FW],
    ]);

    const sProxy = falesnyDocker({ "Uzel-GPU": { ps: vypis(KOTVA, JINY, PROXY), inspect: inspekce("stav VYNUCENO") } });
    const r = await zmerUzly({ servers: SERVERS, sluzby: SLUZBY, cti: cti(), docker: sProxy.docker });
    expect(r.kod).toBe(1);
    expect(r.uzly.uzel).toEqual({ vysledek: "nalez", firewall: { stav: "VYNUCENO", duvod: null } });
    expect(r.radky.filter((x) => x.startsWith("✗"))).toHaveLength(1);
  });

  it("R1 (měření): deklarace portů uzlu se čte z hodnot instance — UDP port meshe publikovaný kontejnerem → kód 0 s ACCEL_FW_UDP_MESH_PORT, kód 1 bez něj (i s NETBIRD_MESH_PORT — ten firewall nečte); jiný kontejner s 0.0.0.0:443 → kód 1", async () => {
    const meshPublikovan = vypis(KOTVA, { jmeno: "vrstva-netbird", porty: `0.0.0.0:${MESH}->${MESH}/udp` });
    const s = falesnyDocker({ "Uzel-GPU": { ps: meshPublikovan, inspect: inspekce("stav VYNUCENO") } });
    const sDeklaraci = await zmerUzly({ servers: SERVERS, sluzby: SLUZBY, cti: cti({ ACCEL_FW_UDP_MESH_PORT: String(MESH) }), docker: s.docker });
    expect(sDeklaraci.kod, sDeklaraci.radky.join("\n")).toBe(0);
    const bezDeklarace = await zmerUzly({ servers: SERVERS, sluzby: SLUZBY, cti: cti({ NETBIRD_MESH_PORT: String(MESH) }), docker: s.docker });
    expect(bezDeklarace.kod, bezDeklarace.radky.join("\n")).toBe(1);
    const aplikace = falesnyDocker({ "Uzel-GPU": { ps: vypis(KOTVA, { jmeno: "nekdo-aplikace", porty: "0.0.0.0:443->443/tcp" }), inspect: inspekce("stav VYNUCENO") } });
    const r = await zmerUzly({ servers: SERVERS, sluzby: SLUZBY, cti: cti({ ACCEL_FW_UDP_MESH_PORT: String(MESH) }), docker: aplikace.docker });
    expect(r.kod).toBe(1);
    expect(r.radky.filter((x) => x.startsWith(`✗ ${DRUH_NALEZU_PORTU}: `))).toHaveLength(1);
  });

  it("⛔ docker neodpoví žádnému kandidátovi: NEZMĚŘENO (kód 2) a důvod jmenuje oba pokusy; odpoví-li druhý, měří se", async () => {
    const nikdo = falesnyDocker({});
    const r = await zmerUzly({ servers: SERVERS, sluzby: SLUZBY, cti: cti(), docker: nikdo.docker });
    expect(r.kod).toBe(2);
    expect(r.radky).toHaveLength(1);
    expect(r.radky[0]).toMatch(/^\? uzel: proxy na uzlu NEZMĚŘENA — výpis kontejnerů přes `docker -H ssh:\/\/…` neodpověděl — Uzel-GPU: kód 255 .*; uzel-gpu: kód 255/);
    expect(nikdo.volani.map((v) => v[0])).toEqual(["Uzel-GPU", "uzel-gpu"]);

    const druhy = falesnyDocker({ "uzel-gpu": { ps: vypis(KOTVA), inspect: inspekce("stav VYNUCENO") } });
    expect((await zmerUzly({ servers: SERVERS, sluzby: SLUZBY, cti: cti(), docker: druhy.docker })).kod).toBe(0);
  });

  it("⛔ bez hostname slotu nebo bez identity vrstvy se docker NEVOLÁ a výsledek je NEZMĚŘENO s důvodem", async () => {
    for (const [extra, duvod] of [[{ UZEL_HOSTNAME: "" }, /hostname slotu 'uzel' neznám/], [{ ACCEL_OWNER_PREFIX: "" }, /bez hodnoty: ACCEL_OWNER_PREFIX/]]) {
      const { docker, volani } = falesnyDocker({});
      const r = await zmerUzly({ servers: SERVERS, sluzby: SLUZBY, cti: cti(extra), docker });
      expect(r.kod).toBe(2);
      expect(r.radky[0]).toMatch(duvod);
      expect(volani).toEqual([]);
    }
  });
});

describe("CLI nad registrem a katalogem repa (falešný `docker` na PATH, návratový kód procesu)", () => {
  let adresar;
  beforeAll(() => {
    adresar = mkdtempSync(join(tmpdir(), "kontejnery-uzlu-"));
    writeFileSync(
      join(adresar, "docker"),
      [
        "#!/bin/sh",
        'printf \'%s\\n\' "$*" >> "$FALESNY_DOCKER_LOG"',
        '[ "$1" = "-H" ] || exit 64',
        'case "$3" in',
        '  ps) if [ "${FALESNY_DOCKER_PS_RC:-0}" != "0" ]; then echo "ssh: connect to host: Connection timed out" >&2; exit "$FALESNY_DOCKER_PS_RC"; fi',
        '      cat "$FALESNY_DOCKER_PS" ;;',
        '  inspect) cat "$FALESNY_DOCKER_INSPECT" ;;',
        "  *) exit 64 ;;",
        "esac",
        "",
      ].join("\n"),
    );
    chmodSync(join(adresar, "docker"), 0o755);
  });
  afterAll(() => rmSync(adresar, { recursive: true, force: true }));

  function spust({ ps, zdravi = inspekce("stav VYNUCENO"), extra = {}, args = [] }) {
    writeFileSync(join(adresar, "ps.txt"), ps?.vystup ?? "");
    writeFileSync(join(adresar, "inspect.txt"), zdravi.vystup);
    writeFileSync(join(adresar, "docker.log"), "");
    const env = {
      PATH: `${adresar}:${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: adresar,
      FALESNY_DOCKER_LOG: join(adresar, "docker.log"),
      FALESNY_DOCKER_PS: join(adresar, "ps.txt"),
      FALESNY_DOCKER_INSPECT: join(adresar, "inspect.txt"),
      // Lane firewallu = deklarace uzlu (katalog: provision_when_env accel-hostfw), ne ACCEL_ENABLED.
      ACCEL_FW_NODE_OWNER: "vrstva",
      ACCEL_OWNER_PREFIX: "vrstva",
      GPU_HOSTNAME: "uzel-gpu",
      ...extra,
    };
    return new Promise((hotovo) => {
      const p = spawn(process.execPath, [SKRIPT, ...args], { env });
      let out = "";
      let err = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      p.on("close", (kod) => hotovo({ kod, out, err, volani: readFileSync(join(adresar, "docker.log"), "utf8").split("\n").filter(Boolean) }));
    });
  }

  it("T4 (CLI): proxy s publikovanými porty → kód 1 a řádek ✗; KOTVA: tentýž uzel bez proxy → kód 0 a řádek ✓", async () => {
    const kotva = await spust({ ps: vypis(KOTVA, JINY) });
    expect(kotva.kod, kotva.out + kotva.err).toBe(0);
    expect(kotva.out).toMatch(/^✓ gpu: žádný kontejner proxy serveru/m);
    expect(kotva.volani).toEqual([
      "-H ssh://uzel-gpu ps --all --format {{json .}}",
      "-H ssh://uzel-gpu inspect --type container --format {{json .State}} vrstva-accel-hostfw",
    ]);

    const r = await spust({ ps: vypis(KOTVA, JINY, PROXY) });
    expect(r.kod, r.out + r.err).toBe(1);
    expect(r.out).toMatch(/^✗ proxy na uzlu: gpu: kontejner proxy serveru 'coolify-proxy' publikuje/m);
    expect(r.out).not.toMatch(/^✓/m);
    const j = await spust({ ps: vypis(KOTVA, JINY, PROXY), args: ["--json"] });
    expect(JSON.parse(j.out)).toMatchObject({ kod: 1, uzly: { gpu: { vysledek: "nalez", firewall: { stav: "VYNUCENO" } } } });
  }, STROP_MS);

  it("⛔ T4 (CLI): docker selže (rc ≠ 0) nebo kotva chybí → kód 2 a řádek `? `, nikdy 0", async () => {
    const selhal = await spust({ ps: vypis(KOTVA), extra: { FALESNY_DOCKER_PS_RC: "255" } });
    expect(selhal.kod, selhal.out + selhal.err).toBe(2);
    expect(selhal.out).toMatch(/^\? gpu: proxy na uzlu NEZMĚŘENA — výpis kontejnerů přes `docker -H ssh:\/\/…` neodpověděl — uzel-gpu: kód 255 \(ssh: connect to host: Connection timed out\)$/m);
    const bezKotvy = await spust({ ps: vypis(JINY) });
    expect(bezKotvy.kod).toBe(2);
    expect(bezKotvy.out).toMatch(/chybí kotva/);
    expect(bezKotvy.out).not.toMatch(/^✓/m);
  }, STROP_MS);

  it("⛔ docker, který neodpoví do stropu nebo nejde spustit, je kód (124 / 127) s důvodem — ne čekání bez konce a ne výjimka", async () => {
    const pomaly = mkdtempSync(join(tmpdir(), "kontejnery-uzlu-pomaly-"));
    // `exec`: strop zabije přímo spící proces, žádný osiřelý potomek nedrží roury.
    writeFileSync(join(pomaly, "docker"), "#!/bin/sh\nexec sleep 20\n");
    chmodSync(join(pomaly, "docker"), 0o755);
    const puvodni = process.env.PATH;
    try {
      process.env.PATH = `${pomaly}:/usr/bin:/bin`;
      const zacatek = Date.now();
      const r = await spustDocker("uzel-gpu", [...PRIKAZ_VYPISU], { timeoutMs: 300 });
      expect(r.rc).toBe(124);
      expect(r.chyba).toMatch(/bez odpovědi do 300 ms/);
      expect(Date.now() - zacatek, "odpověď nesmí čekat na konec procesu").toBeLessThan(15_000);
      // Posudek z takové odpovědi je NEZMĚŘENO.
      expect(posudUzel({ slot: "uzel", jmenoFirewallu: FW, vypis: r }).vysledek).toBe("nemereno");

      process.env.PATH = join(pomaly, "neni");
      const bez = await spustDocker("uzel-gpu", [...PRIKAZ_VYPISU], { timeoutMs: 5_000 });
      expect(bez.rc).toBe(127);
      expect(bez.chyba).toMatch(/docker nejde spustit/);
    } finally {
      process.env.PATH = puvodni;
      rmSync(pomaly, { recursive: true, force: true });
    }
  }, STROP_MS);

  it("lane zavřená: kód 0, docker se nevolá; neznámý argument: kód 2", async () => {
    // Lane vrstvy otevřená firewall nezapne — zapíná ho jen deklarace uzlu.
    const zavrena = await spust({ ps: vypis(KOTVA), extra: { ACCEL_FW_NODE_OWNER: "", ACCEL_ENABLED: "1" } });
    expect(zavrena.kod).toBe(0);
    expect(zavrena.out).toMatch(/nenasazuje/);
    expect(zavrena.volani).toEqual([]);
    const neznamy = await spust({ ps: vypis(KOTVA), args: ["--nevim"] });
    expect(neznamy.kod).toBe(2);
    expect(neznamy.out).toMatch(/neznámý argument '--nevim'/);
  }, STROP_MS);
});
