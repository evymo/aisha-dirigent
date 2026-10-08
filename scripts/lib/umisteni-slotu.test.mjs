import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nactiSloty, vyzadujeVyslovnouVazbu } from "./sloty-serveru.mjs";
import { kodZNalezu, overManifest, overUmisteniSlotu, parsujMapuManifestu } from "./umisteni-slotu.mjs";

// Smí služba bydlet na slotu, kam ji topologie posílá? Kontrakty d8 U5/U6/U8 a 0c C2/O8.
const KOREN = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOUHLASI = join(KOREN, "scripts/lib/umisteni-souhlasi.sh");
const MANIFEST = join(KOREN, "coolify/manifests/aisha.manifest");
const servers = nactiSloty(KOREN);

const HLAVNI_MESH = "environment:\n  NB_SETUP_KEY: ${NETBIRD_STACK_KEY_EXPERIMENTAL}\n";
const BEZ_MESHE = "services:\n  svc:\n    image: x\n";
const compose = (mapa) => (soubor) => (soubor in mapa ? mapa[soubor] : null);

describe("overUmisteniSlotu — pravidla", () => {
  it("registr: slot gpu nese has_gpu (U5) — jinak by pravidla 2 a 3 neměla na čem stát", () => {
    expect(vyzadujeVyslovnouVazbu(servers.gpu)).toBe(true);
  });

  it("neznámé umístění = NEMĚŘENO (2), ne výchozí server (U6/M5); kotva: slot registru projde", () => {
    const n = overUmisteniSlotu({ model: { placement: "tpu", compose: "a.yml" } }, { servers, cteniCompose: compose({ "a.yml": BEZ_MESHE }) });
    expect(n).toEqual([expect.objectContaining({ kod: 2, id: "model" })]);
    expect(n[0].zprava).toMatch(/'tpu'.*nezná/);
    expect(overUmisteniSlotu({ model: { placement: "experimental", compose: "a.yml" } }, { servers, cteniCompose: compose({ "a.yml": BEZ_MESHE }) })).toEqual([]);
  });

  it("na GPU slotu nic z hlavního meshe: klíč stacku = rozpor (1); kotva: týž compose mimo GPU slot projde", () => {
    const cti = compose({ "m.yml": HLAVNI_MESH });
    const n = overUmisteniSlotu({ x: { placement: "gpu", compose: "m.yml" } }, { servers, cteniCompose: cti });
    expect(n).toEqual([expect.objectContaining({ kod: 1, id: "x" })]);
    expect(n[0].zprava).toContain("${NETBIRD_STACK_KEY_EXPERIMENTAL}");
    expect(n[0].zprava).toMatch(/HLAVNÍHO meshe/);
    expect(overUmisteniSlotu({ x: { placement: "experimental", compose: "m.yml" } }, { servers, cteniCompose: cti })).toEqual([]);
  });

  it("služba s tenkým compose pro GPU slot (compose_gpu) smí na něm JEN ten; kotva: tenký projde, mimo GPU slot původní projde", () => {
    const cti = compose({ "cpu.yml": BEZ_MESHE, "tenky.yml": BEZ_MESHE });
    const katalog = { model: { compose: "cpu.yml", compose_gpu: "tenky.yml" } };
    const n = overUmisteniSlotu({ model: { placement: "gpu", compose: "cpu.yml" } }, { servers, cteniCompose: cti, katalog });
    expect(n).toEqual([expect.objectContaining({ kod: 1, id: "model" })]);
    expect(n[0].zprava).toMatch(/JEN tenký compose tenky\.yml/);
    expect(overUmisteniSlotu({ model: { placement: "gpu", compose: "tenky.yml" } }, { servers, cteniCompose: cti, katalog })).toEqual([]);
    expect(overUmisteniSlotu({ model: { placement: "experimental", compose: "cpu.yml" } }, { servers, cteniCompose: cti, katalog })).toEqual([]);
    // týž výklad i pro manifest (story-init zakládá podle něj)
    expect(kodZNalezu(overManifest([{ id: "model", slot: "gpu", compose: "cpu.yml" }], { servers, cteniCompose: cti, katalog }))).toBe(1);
    expect(kodZNalezu(overManifest([{ id: "model", slot: "gpu", compose: "tenky.yml" }], { servers, cteniCompose: cti, katalog }))).toBe(0);
  });

  it("síť resolveru hlavního meshe (MESH_DNS_NETWORK) na GPU slotu = rozpor; kotva: compose bez stop projde", () => {
    const cti = compose({ "d.yml": "networks:\n  mesh-dns:\n    name: ${MESH_DNS_NETWORK}\n", "c.yml": BEZ_MESHE });
    expect(overUmisteniSlotu({ x: { placement: "gpu", compose: "d.yml" } }, { servers, cteniCompose: cti })[0]?.kod).toBe(1);
    expect(overUmisteniSlotu({ x: { placement: "gpu", compose: "c.yml" } }, { servers, cteniCompose: cti })).toEqual([]);
  });

  it("síť sdílená mezi forky (coolify) na GPU slotu = rozpor (0c c); kotva: mimo GPU slot a bez té sítě projde", () => {
    const sCoolify = "services:\n  svc:\n    image: x\n    networks: [ven]\nnetworks:\n  ven:\n    external: true\n    name: coolify\n";
    const cti = compose({ "v.yml": sCoolify, "c.yml": BEZ_MESHE });
    const n = overUmisteniSlotu({ x: { placement: "gpu", compose: "v.yml" } }, { servers, cteniCompose: cti });
    expect(n).toEqual([expect.objectContaining({ kod: 1, id: "x" })]);
    expect(n[0].zprava).toMatch(/sdílené mezi forky \(coolify: svc/);
    expect(overUmisteniSlotu({ x: { placement: "backend", compose: "v.yml" } }, { servers, cteniCompose: cti })).toEqual([]);
    expect(overUmisteniSlotu({ x: { placement: "gpu", compose: "c.yml" } }, { servers, cteniCompose: cti })).toEqual([]);
  });

  it("veřejná tvář na GPU slotu = rozpor (U8); kotva: bez veřejné tváře projde", () => {
    const cti = compose({ "c.yml": BEZ_MESHE });
    const verejna = { placement: "gpu", compose: "c.yml", urls: { public: [{ url: "model.example" }] } };
    expect(overUmisteniSlotu({ x: verejna }, { servers, cteniCompose: cti })).toEqual([expect.objectContaining({ kod: 1, id: "x" })]);
    expect(overUmisteniSlotu({ x: { ...verejna, urls: { public: [] } } }, { servers, cteniCompose: cti })).toEqual([]);
  });

  it("N1: network_mode host nebo container: na GPU slotu = rozpor; kotva: service: uvnitř stacku a host mimo GPU slot projdou", () => {
    const sluzba = (rezim) => `services:\n  svc:\n    image: x\n    network_mode: "${rezim}"\n`;
    const cti = compose({ "h.yml": sluzba("host"), "k.yml": sluzba("container:fork-model--netbird"), "s.yml": sluzba("service:netbird-agent") });
    for (const f of ["h.yml", "k.yml"]) {
      const n = overUmisteniSlotu({ x: { placement: "gpu", compose: f } }, { servers, cteniCompose: cti });
      expect(n, f).toEqual([expect.objectContaining({ kod: 1, id: "x" })]);
      expect(n[0].zprava).toMatch(/obchází síť stacku/);
    }
    expect(overUmisteniSlotu({ x: { placement: "gpu", compose: "s.yml" } }, { servers, cteniCompose: cti })).toEqual([]);
    expect(overUmisteniSlotu({ x: { placement: "backend", compose: "h.yml" } }, { servers, cteniCompose: cti })).toEqual([]);
  });

  it("O-7: síť hostitele jen pro službu s pojmenovaným důvodem v katalogu; container: ani tak; kotva: bez důvodu rozpor", () => {
    const sluzba = (rezim) => `services:\n  fw:\n    image: x\n    network_mode: "${rezim}"\n`;
    const cti = compose({ "h.yml": sluzba("host"), "k.yml": sluzba("container:x") });
    const katalog = { "accel-hostfw": { sit_hostitele: "Firewall hostitele zapisuje pravidla hostitele.", compose: "h.yml" } };
    expect(overUmisteniSlotu({ "accel-hostfw": { placement: "gpu", compose: "h.yml" } }, { servers, cteniCompose: cti, katalog })).toEqual([]);
    expect(overUmisteniSlotu({ "accel-hostfw": { placement: "gpu", compose: "k.yml" } }, { servers, cteniCompose: cti, katalog })[0]?.kod).toBe(1);
    expect(overUmisteniSlotu({ model: { placement: "gpu", compose: "h.yml" } }, { servers, cteniCompose: cti, katalog })[0]?.kod).toBe(1);
    // Výjimka patří obsahu z katalogu, ne jménu: cizí compose pod jménem accel-hostfw = rozpor.
    const cizi = compose({ "h.yml": sluzba("host"), "cizi.yml": sluzba("host") });
    expect(kodZNalezu(overManifest([{ id: "accel-hostfw", slot: "gpu", compose: "cizi.yml" }], { servers, cteniCompose: cizi, katalog }))).toBe(1);
    expect(overManifest([{ id: "accel-hostfw", slot: "gpu", compose: "h.yml" }], { servers, cteniCompose: cizi, katalog }), "kotva: compose z katalogu").toEqual([]);
  });

  it("výjimku sítě hostitele má v katalogu PRÁVĚ operátorský firewall uzlu (accel-hostfw)", () => {
    const k = JSON.parse(readFileSync(join(KOREN, "config/services.json"), "utf8")).services;
    expect(Object.entries(k).filter(([, s]) => s?.sit_hostitele !== undefined).map(([id]) => id)).toEqual(["accel-hostfw"]);
  });

  it("N2: stopa hlavního meshe bez závorek ($NETBIRD_STACK_KEY_…, $MESH_DNS_NETWORK) = rozpor", () => {
    const cti = compose({ "a.yml": "environment:\n  NB_SETUP_KEY: $NETBIRD_STACK_KEY_EXPERIMENTAL\n", "b.yml": "networks:\n  d:\n    name: $MESH_DNS_NETWORK\n" });
    for (const f of ["a.yml", "b.yml"]) expect(overUmisteniSlotu({ x: { placement: "gpu", compose: f } }, { servers, cteniCompose: cti })[0]?.kod, f).toBe(1);
  });

  it("cesty na hostitele na GPU slotu: pid/ipc/userns host, privileged, socket Dockeru = 1; ${VAR} = 2; kotva čisté", () => {
    const s = (radky) => `services:\n  svc:\n    image: x\n${radky}\n`;
    const cti = compose({
      "pid.yml": s("    pid: host"),
      "ipc.yml": s("    ipc: host"),
      "ns.yml": s("    userns_mode: host"),
      "priv.yml": s("    privileged: true"),
      "sock.yml": s("    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock"),
      "sock2.yml": s("    volumes:\n      - type: bind\n        source: /run/docker.sock\n        target: /s"),
      "promenna.yml": s("    network_mode: ${REZIM}"),
      "svazek.yml": s("    volumes:\n      - ${ZDROJ}:/data"),
      "ok.yml": s("    volumes:\n      - data:/data\n    cap_add: [NET_ADMIN]"),
    });
    const kod = (f) => kodZNalezu(overUmisteniSlotu({ x: { placement: "gpu", compose: f } }, { servers, cteniCompose: cti }));
    for (const f of ["pid.yml", "ipc.yml", "ns.yml", "priv.yml", "sock.yml", "sock2.yml"]) expect(kod(f), f).toBe(1);
    for (const f of ["promenna.yml", "svazek.yml"]) expect(kod(f), f).toBe(2);
    expect(kod("ok.yml"), "kotva: vlastní svazek a NET_ADMIN ve vlastním netns").toBe(0);
    // mimo GPU slot se nic z toho neměří (jiná třída problému)
    expect(overUmisteniSlotu({ x: { placement: "backend", compose: "priv.yml" } }, { servers, cteniCompose: cti })).toEqual([]);
  });

  // Revize accel-1, 3. kolo: revizent změřil kód 0 u všech těchto obejití pravidla
  // „socket Dockeru / hostitel“ — podmínka před prvním tenkým stackem forku na gpu.
  it("obejití 3. kola: nadřazený adresář socketu, /, containerd, container:, volumes_from, cgroup/uts, SYS_ADMIN, unconfined, /dev/mem, DOCKER_HOST = 1", () => {
    const s = (radky) => `services:\n  svc:\n    image: x\n${radky}\n`;
    const pripady = {
      "/var/run:/hostrun": s("    volumes:\n      - /var/run:/hostrun"),
      "/run:/hostrun": s("    volumes:\n      - /run:/hostrun"),
      "/:/host": s("    volumes:\n      - /:/host:ro"),
      "/var/lib/docker": s("    volumes:\n      - type: bind\n        source: /var/lib/docker/volumes\n        target: /v"),
      "containerd.sock": s("    volumes:\n      - /run/containerd/containerd.sock:/c.sock"),
      "jiný soket": s("    volumes:\n      - /srv/podman/podman.sock:/p.sock"),
      "/proc": s("    volumes:\n      - /proc:/hostproc"),
      "pid container:": s('    pid: "container:cizi"'),
      "ipc container:": s('    ipc: "container:cizi"'),
      "volumes_from": s('    volumes_from: ["container:cizi"]'),
      "cgroup host": s("    cgroup: host"),
      "uts host": s("    uts: host"),
      "cgroup_parent": s("    cgroup_parent: /"),
      "SYS_ADMIN": s("    cap_add: [SYS_ADMIN]"),
      "CAP_SYS_PTRACE": s("    cap_add: [CAP_SYS_PTRACE]"),
      "ALL": s("    cap_add: [ALL]"),
      "SYS_TIME (hodiny hostitele)": s("    cap_add: [SYS_TIME]"),
      "SYS_RESOURCE": s("    cap_add: [SYS_RESOURCE]"),
      "NET_RAW": s("    cap_add: [NET_RAW]"),
      "ports": s('    ports: ["8000:8000"]'),
      "ports jen na lokální adrese": s('    ports: ["127.0.0.1:8000:8000"]'),
      "ports z proměnné": s('    ports: ["${PORT}:8000"]'),
      "seccomp unconfined": s('    security_opt: ["seccomp:unconfined"]'),
      "apparmor unconfined": s('    security_opt: ["apparmor=unconfined"]'),
      "label disable": s('    security_opt: ["label:disable"]'),
      "/dev/mem": s('    devices: ["/dev/mem:/dev/mem"]'),
      "device_cgroup_rules": s('    device_cgroup_rules: ["a *:* rwm"]'),
      "DOCKER_HOST mapa": s("    environment:\n      DOCKER_HOST: tcp://10.0.0.1:2375"),
      "DOCKER_HOST seznam": s('    environment:\n      - "DOCKER_HOST=tcp://10.0.0.1:2375"'),
      "svazek driver_opts na /var/lib/docker": `${s("    volumes:\n      - v:/v")}volumes:\n  v:\n    driver_opts:\n      type: none\n      o: bind\n      device: /var/lib/docker\n`,
    };
    const cti = compose(pripady);
    for (const nazev of Object.keys(pripady)) {
      const n = overUmisteniSlotu({ x: { placement: "gpu", compose: nazev } }, { servers, cteniCompose: cti });
      expect(kodZNalezu(n), nazev).toBe(1);
    }
  });

  it("jiný bind z hostitele, svazek external / s pevným jménem, secrets ze souboru, ${VAR} v zařízení = NEZMĚŘENO (2)", () => {
    const s = (radky) => `services:\n  svc:\n    image: x\n${radky}\n`;
    const pripady = {
      "absolutní": s("    volumes:\n      - /data/modely:/m"),
      "relativní": s("    volumes:\n      - ./data:/d"),
      "domovská": s("    volumes:\n      - ~/x:/x"),
      "driver_opts jinam": `${s("    volumes:\n      - v:/v")}volumes:\n  v:\n    driver_opts:\n      type: none\n      o: bind\n      device: /data/v\n`,
      "external": `${s("    volumes:\n      - v:/v")}volumes:\n  v:\n    external: true\n    name: uzel-accel-deklarace\n`,
      "pevné jméno": `${s("    volumes:\n      - v:/v")}volumes:\n  v:\n    name: uzel-accel-clenstvi\n`,
      "jméno z identity s výchozí hodnotou": `${s("    volumes:\n      - v:/v")}volumes:\n  v:\n    name: \${APP_NAME_PREFIX:-CIZI}-vahy\n`, // výchozí hodnota velkými: tvar `:-` bez jména instance (instance-identity-fail-closed)
      "external i se jménem z identity": `${s("    volumes:\n      - v:/v")}volumes:\n  v:\n    external: true\n    name: \${APP_NAME_PREFIX:?id}-vahy\n`,
      "secrets file": `${s("    secrets: [k]")}secrets:\n  k:\n    file: ./klic.txt\n`,
      "zařízení z proměnné": s('    devices: ["${ZARIZENI}:/dev/x"]'),
      "schopnost z proměnné": s("    cap_add: [${CAP}]"),
    };
    const cti = compose(pripady);
    for (const nazev of Object.keys(pripady)) {
      expect(kodZNalezu(overUmisteniSlotu({ x: { placement: "gpu", compose: nazev } }, { servers, cteniCompose: cti })), nazev).toBe(2);
    }
  });

  it("svazek pojmenovaný z identity instance nebo vlastníka (holé nebo povinné rozbalení) je vlastní = 0", () => {
    const s = (jmeno) => `services:\n  svc:\n    image: x\n    volumes:\n      - v:/v\nvolumes:\n  v:\n    name: ${jmeno}\n`;
    const pripady = { instance: s("${APP_NAME_PREFIX:?identita instance}-model-vahy"), vlastnik: s("${ACCEL_OWNER_PREFIX}-accel-vahy") };
    const cti = compose(pripady);
    for (const nazev of Object.keys(pripady)) {
      expect(overUmisteniSlotu({ x: { placement: "gpu", compose: nazev } }, { servers, cteniCompose: cti }), nazev).toEqual([]);
    }
  });

  it("pojmenovaná výjimka cesty (cesty_hostitele) platí jen s compose z katalogu a nikdy pro kritickou cestu", () => {
    const s = (zdroj) => `services:\n  svc:\n    image: x\n    volumes:\n      - ${zdroj}:/m:ro\n`;
    const cti = compose({ "k.yml": s("/data/modely"), "cizi.yml": s("/data/modely"), "krit.yml": s("/var/run") });
    const katalog = { sluzba: { compose: "k.yml", cesty_hostitele: { "/data/modely": "Váhy modelů předstažené operátorem na lokální disk uzlu.", "/var/run": "Takovou výjimku katalog otevřít nesmí ani s důvodem." } } };
    const kod = (f) => kodZNalezu(overUmisteniSlotu({ sluzba: { placement: "gpu", compose: f } }, { servers, cteniCompose: cti, katalog }));
    expect(kod("k.yml"), "pojmenovaná cesta s compose z katalogu").toBe(0);
    expect(kod("cizi.yml"), "táž cesta s cizím compose").toBe(2);
    katalog.sluzba.compose = "krit.yml";
    expect(kod("krit.yml"), "kritická cesta zůstane rozporem i s výjimkou").toBe(1);
  });

  it("kotvy: firewall uzlu z A2-2 (host + NET_ADMIN/NET_RAW, /run jen tmpfs) a tvar tenkého stacku (/dev/net/tun, CDI, service:) projdou", () => {
    const hostfw = [
      "services:",
      "  accel-hostfw:",
      "    build: { context: ., dockerfile: Dockerfile.accel-hostfw }",
      "    container_name: ${ACCEL_OWNER_PREFIX}-accel-hostfw",
      "    network_mode: host",
      "    cap_drop: [ALL]",
      "    cap_add: [NET_ADMIN, NET_RAW]",
      '    security_opt: ["no-new-privileges:true"]',
      "    read_only: true",
      "    tmpfs:",
      "      - /run:size=1m,mode=0755",
      "      - /tmp:size=4m,mode=1777",
      "",
    ].join("\n");
    const tenky = [
      "services:",
      "  model-mesh-agent:",
      "    image: x",
      "    cap_add: [NET_ADMIN]",
      '    devices: ["/dev/net/tun:/dev/net/tun"]',
      "    volumes: [model-mesh-data:/var/lib/netbird]",
      "  svc-model:",
      "    image: y",
      '    network_mode: "service:model-mesh-agent"',
      "    cap_drop: [ALL]",
      '    security_opt: ["no-new-privileges:true"]',
      "  engine:",
      "    image: z",
      '    devices: ["nvidia.com/gpu=all"]',
      "volumes:",
      "  model-mesh-data: {}",
      "",
    ].join("\n");
    const cti = compose({ "docker-compose.coolify-accel-hostfw.yml": hostfw, "t.yml": tenky });
    const katalog = { "accel-hostfw": { compose: "docker-compose.coolify-accel-hostfw.yml", sit_hostitele: "Firewall hostitele zapisuje pravidla do řetězců INPUT a DOCKER-USER.", schopnosti: { NET_RAW: "iptables-legacy (backend, ve kterém drží Docker hostitele DOCKER-USER) potřebuje raw socket." } } };
    expect(overUmisteniSlotu({ "accel-hostfw": { placement: "gpu", compose: "docker-compose.coolify-accel-hostfw.yml" } }, { servers, cteniCompose: cti, katalog })).toEqual([]);
    const bezDuvodu = { "accel-hostfw": { ...katalog["accel-hostfw"], schopnosti: undefined } };
    expect(kodZNalezu(overUmisteniSlotu({ "accel-hostfw": { placement: "gpu", compose: "docker-compose.coolify-accel-hostfw.yml" } }, { servers, cteniCompose: cti, katalog: bezDuvodu })), "NET_RAW firewallu bez pojmenovaného důvodu").toBe(1);
    expect(overUmisteniSlotu({ model: { placement: "gpu", compose: "t.yml" } }, { servers, cteniCompose: cti, katalog })).toEqual([]);
  });

  it("schopnost mimo NET_ADMIN jen s pojmenovaným důvodem v katalogu a compose z katalogu; jádro/hodiny/procesy ani s důvodem", () => {
    const s = (caps) => `services:\n  svc:\n    image: x\n    cap_add: [${caps}]\n`;
    const cti = compose({ "raw.yml": s("NET_RAW"), "cas.yml": s("SYS_TIME"), "cizi.yml": s("NET_RAW") });
    const katalog = { fw: { compose: "raw.yml", schopnosti: { NET_RAW: "iptables-legacy potřebuje raw socket." } }, hodiny: { compose: "cas.yml", schopnosti: { SYS_TIME: "Takovou výjimku katalog otevřít nesmí ani s důvodem." } } };
    const kod = (id, f) => kodZNalezu(overUmisteniSlotu({ [id]: { placement: "gpu", compose: f } }, { servers, cteniCompose: cti, katalog }));
    expect(kod("fw", "raw.yml"), "NET_RAW s důvodem a compose z katalogu").toBe(0);
    expect(kod("fw", "cizi.yml"), "táž schopnost s cizím compose").toBe(1);
    expect(kod("jina", "raw.yml"), "služba bez výjimky v katalogu").toBe(1);
    expect(kod("hodiny", "cas.yml"), "SYS_TIME zůstane rozporem i s důvodem").toBe(1);
    katalog.fw.schopnosti.NET_RAW = "  ";
    expect(kod("fw", "raw.yml"), "prázdný důvod není důvod").toBe(1);
  });

  it("socket Dockeru: jen služba z katalogu (socket_dockeru), jen pro čtení, bez sítě, bez schopností, jen s compose z katalogu", () => {
    const proxy = (svazek, extra = "    network_mode: none\n") => `services:\n  proxy:\n    image: x\n${extra}    volumes:\n      - ${svazek}\n`;
    const cti = compose({
      "p.yml": proxy("/var/run/docker.sock:/var/run/docker.sock:ro"),
      "rw.yml": proxy("/var/run/docker.sock:/var/run/docker.sock"),
      "sit.yml": proxy("/var/run/docker.sock:/var/run/docker.sock:ro", "    networks: [a]\n"),
      "cap.yml": proxy("/var/run/docker.sock:/var/run/docker.sock:ro", "    network_mode: none\n    cap_add: [NET_ADMIN]\n"),
      "kmen.yml": proxy("/var/run:/hostrun:ro"),
    });
    const duvod = { proxy: "hlídač členství čte Docker API přes proxy jen pro čtení." };
    const katalog = Object.fromEntries(["p", "rw", "sit", "cap", "kmen"].map((k) => [k, { compose: `${k}.yml`, socket_dockeru: duvod }]));
    const kod = (id, f = `${id}.yml`) => kodZNalezu(overUmisteniSlotu({ [id]: { placement: "gpu", compose: f } }, { servers, cteniCompose: cti, katalog }));
    expect(kod("p"), "proxy z katalogu, :ro, bez sítě").toBe(0);
    expect(kod("rw"), "socket pro zápis").toBe(1);
    expect(kod("sit"), "proxy se sítí").toBe(1);
    expect(kod("cap"), "proxy se schopností").toBe(1);
    expect(kod("kmen"), "předek socketu (/var/run) výjimka nepokrývá").toBe(1);
    expect(kod("jina", "p.yml"), "táž proxy pod jménem bez výjimky v katalogu").toBe(1);
    expect(kodZNalezu(overManifest([{ id: "p", slot: "gpu", compose: "rw.yml" }], { servers, cteniCompose: cti, katalog })), "manifest s cizím compose").toBe(1);
  });

  it("svazek vrstvy: external svazek vah je změřený jen s compose z katalogu, jen pro čtení a jen když ho zakládá jiná služba katalogu na GPU", () => {
    const vstup = "services:\n  vahy:\n    image: x\n    volumes: [\"v:/vahy\"]\nvolumes:\n  v:\n    name: ${ACCEL_OWNER_PREFIX:?id}-accel-vahy\n";
    const engine = (rezim) => `services:\n  e:\n    image: x\n    volumes: ["v:/vahy${rezim}"]\nvolumes:\n  v:\n    external: true\n    name: \${ACCEL_OWNER_PREFIX:?id}-accel-vahy\n`;
    const cti = compose({ "vstup.yml": vstup, "e.yml": engine(":ro"), "erw.yml": engine(""), "cizi.yml": engine(":ro") });
    const katalog = { vstup: { placement: "gpu", compose: "vstup.yml" }, e: { placement: "gpu", compose: "e.yml" }, erw: { placement: "gpu", compose: "erw.yml" } };
    const kod = (id, f) => kodZNalezu(overUmisteniSlotu({ [id]: { placement: "gpu", compose: f } }, { servers, cteniCompose: cti, katalog }));
    expect(kod("e", "e.yml"), "engine čte váhy vrstvy").toBe(0);
    expect(kod("erw", "erw.yml"), "zápis do svazku vrstvy = rozpor").toBe(1);
    expect(kod("fork", "cizi.yml"), "cizí compose se týmž svazkem = jako dřív NEZMĚŘENO").toBe(2);
    expect(kodZNalezu(overManifest([{ id: "e", slot: "gpu", compose: "cizi.yml" }], { servers, cteniCompose: cti, katalog })), "manifest: jméno z katalogu, compose cizí").toBe(2);
    const bezZakladatele = { e: katalog.e };
    expect(kodZNalezu(overUmisteniSlotu({ e: { placement: "gpu", compose: "e.yml" } }, { servers, cteniCompose: cti, katalog: bezZakladatele })), "svazek nikdo z katalogu nezakládá").toBe(2);
  });

  it("N3: env_file na GPU slotu = NEMĚŘENO (2) — text compose proměnné ze souboru neprozradí; kotva: bez env_file čisté", () => {
    const cti = compose({ "e.yml": "services:\n  svc:\n    image: x\n    env_file: [.env]\n", "c.yml": BEZ_MESHE });
    expect(overUmisteniSlotu({ x: { placement: "gpu", compose: "e.yml" } }, { servers, cteniCompose: cti })).toEqual([expect.objectContaining({ kod: 2, id: "x" })]);
    expect(overUmisteniSlotu({ x: { placement: "gpu", compose: "c.yml" } }, { servers, cteniCompose: cti })).toEqual([]);
  });

  it("YAML merge `<<: *kotva` (idiom repa) rozbalí host, env_file i coolify; kotva: bez kotvy čisté", () => {
    const sKotvou = (obsah) => `x-spolecne: &spolecne\n${obsah}\nservices:\n  svc:\n    <<: *spolecne\n    image: x\n`;
    const cti = compose({
      "h.yml": sKotvou("  network_mode: host"),
      "e.yml": sKotvou("  env_file: [.env]"),
      "c.yml": sKotvou("  networks: [ven]") + "networks:\n  ven:\n    external: true\n    name: coolify\n",
      "ok.yml": sKotvou("  restart: unless-stopped"),
    });
    const kod = (f) => kodZNalezu(overUmisteniSlotu({ x: { placement: "gpu", compose: f } }, { servers, cteniCompose: cti }));
    expect(kod("h.yml"), "host v kotvě").toBe(1);
    expect(kod("e.yml"), "env_file v kotvě").toBe(2);
    expect(kod("c.yml"), "coolify v kotvě").toBe(1);
    expect(kod("ok.yml")).toBe(0);
  });

  it("extends a include text jednoho souboru nevyloží = NEZMĚŘENO (2)", () => {
    const cti = compose({ "x.yml": "services:\n  svc:\n    extends: { file: jiny.yml, service: zaklad }\n", "i.yml": "include: [jiny.yml]\nservices:\n  svc:\n    image: x\n" });
    for (const f of ["x.yml", "i.yml"]) expect(kodZNalezu(overUmisteniSlotu({ x: { placement: "gpu", compose: f } }, { servers, cteniCompose: cti })), f).toBe(2);
  });

  it("mapa MANIFESTU: aplikace na GPU slotu se měří compose z manifestu, neznámý slot = 2 (revize accel-1, bod 1)", () => {
    const cti = compose({ "m.yml": HLAVNI_MESH, "c.yml": BEZ_MESHE });
    expect(kodZNalezu(overManifest([{ id: "pgadmin", slot: "gpu", compose: "m.yml" }], { servers, cteniCompose: cti }))).toBe(1);
    expect(kodZNalezu(overManifest([{ id: "pgadmin", slot: "tpu", compose: "c.yml" }], { servers, cteniCompose: cti }))).toBe(2);
    expect(overManifest([{ id: "pgadmin", slot: "backend", compose: "m.yml" }, { id: "x", slot: "gpu", compose: "c.yml" }], { servers, cteniCompose: cti }), "kotva").toEqual([]);
    expect(parsujMapuManifestu("a\tgpu\tm.yml\nb\tbackend\tc.yml\n")).toEqual([{ id: "a", slot: "gpu", compose: "m.yml" }, { id: "b", slot: "backend", compose: "c.yml" }]);
    expect(() => parsujMapuManifestu("jen-id\n")).toThrow(/bez id nebo slotu/);
  });

  it("kód běhu: jistý rozpor (1) má přednost před NEMĚŘENO (2); bez nálezu 0", () => {
    expect(kodZNalezu([{ kod: 2 }, { kod: 1 }])).toBe(1);
    expect(kodZNalezu([{ kod: 2 }])).toBe(2);
    expect(kodZNalezu([])).toBe(0);
  });

  it("nečitelný nebo chybějící compose na GPU slotu = NEMĚŘENO, ne „čisté“", () => {
    expect(overUmisteniSlotu({ x: { placement: "gpu", compose: "neni.yml" } }, { servers, cteniCompose: compose({}) })[0]?.kod).toBe(2);
    expect(overUmisteniSlotu({ x: { placement: "gpu" } }, { servers, cteniCompose: compose({}) })[0]?.kod).toBe(2);
  });
});

// Celá cesta doktora (krok 0): umisteni-souhlasi.sh → derivace z profilu instance → tahle kontrola.
// Každý případ pouští bash a derivaci domén (2× node). Pod zátěží sdíleného stroje to trvá
// víc než výchozích 5 s (naměřeno: timeout v plné sadě skriptů 10-05), strop proto výslovně.
const STROP_MS = 60_000;
describe("umisteni-souhlasi.sh s profilem instance, který posílá model na gpu", () => {
  let d;
  let prazdnyEnv;
  const profil = (prepis) => {
    const p = JSON.parse(readFileSync(join(KOREN, "config/profiles/cloud-multi.json"), "utf8"));
    p.id = "gputest";
    // Šablona nese TLD jako null (dosazuje je operátor); zkušební profil je musí mít sám.
    p.domain = { ...p.domain, public_tld: "aisha.example", internal_tld: "int.example", mesh_tld: "mesh.example" };
    p.servers = [...p.servers, "gpu"];
    p.service_overrides = { ...p.service_overrides, ...prepis };
    // Model na GPU slotu chce deklaraci vstupu lane nájemce (derivace bez ní selže) — testovací hodnota.
    p.lane_gpu = { vlastnik: "testuzel", vstup_url: "http://10.251.9.2:8000" };
    writeFileSync(join(d, "profiles", "gputest.json"), JSON.stringify(p, null, 2));
  };
  const manifest = (slot) => {
    const cesta = join(d, `m-${slot}.manifest`);
    const text = readFileSync(MANIFEST, "utf8");
    expect(text, "manifest nemá model na experimental — sonda nemá co přesunout").toMatch(/^app: model:experimental:/m);
    writeFileSync(cesta, text.replace(/^app: model:experimental:/m, `app: model:${slot}:`));
    return cesta;
  };
  const spust = (m) =>
    spawnSync("bash", [SOUHLASI, m], {
      encoding: "utf8",
      env: {
        ...process.env,
        AISHA_PROFILE: "gputest",
        // Model na GPU slotu = modelový mesh forku; jména jeho peerů nese identita instance.
        APP_NAME_PREFIX: "gputest",
        AISHA_INSTANCE_CONFIG_DIR: d,
        ENV_FILE: prazdnyEnv,
        CHAT_GGUF_URL: "https://modely.example/model.gguf",
      },
    });

  beforeAll(() => {
    d = mkdtempSync(join(tmpdir(), "umisteni-slotu-"));
    mkdirSync(join(d, "profiles"));
    // Lane modelu otevřená i v souboru prostředí: mapa aplikací manifestu (coolify-app-vars)
    // čte lane odtud, derivace z prostředí procesu. Obě strany mají vidět model.
    prazdnyEnv = join(d, "lane-modelu.env");
    writeFileSync(prazdnyEnv, "CHAT_GGUF_URL=https://modely.example/model.gguf\n");
  });
  afterAll(() => d && rmSync(d, { recursive: true, force: true }));

  it("kotva: model na experimental (dnešní stav) projde oběma kontrolami", () => {
    profil({});
    const r = spust(MANIFEST);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/umístění slotů v pořádku/);
  }, STROP_MS);

  it("model na gpu s dnešním compose (agent hlavního meshe) = STOP 1 dřív než zápis", () => {
    profil({ model: { placement: "gpu" } });
    const r = spust(manifest("gpu"));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/ROZPOR model: na GPU slotu 'gpu' vstupuje do HLAVNÍHO meshe/);
    expect(r.stderr).toContain("docker-compose.coolify-model.yml");
    // a na GPU slotu smí model jen tenký compose (katalog compose_gpu)
    expect(r.stderr).toMatch(/JEN tenký compose docker-compose\.coolify-model-gpu\.yml/);
  }, STROP_MS);

  it("model na gpu s TENKÝM compose (compose_gpu) projde oběma kontrolami", () => {
    profil({ model: { placement: "gpu" } });
    const cesta = join(d, "m-gpu-tenky.manifest");
    const text = readFileSync(MANIFEST, "utf8");
    writeFileSync(cesta, text.replace(/^app: model:experimental:docker-compose\.coolify-model\.yml/m, "app: model:gpu:docker-compose.coolify-model-gpu.yml"));
    const r = spust(cesta);
    expect(r.status, r.stderr).toBe(0);
  }, STROP_MS);

  it("manifest posílá pgadmin na gpu, profil o gpu neví = STOP 1 (revize accel-1: dřív kód 0)", () => {
    profil({});
    const cesta = join(d, "m-pgadmin-gpu.manifest");
    const text = readFileSync(MANIFEST, "utf8");
    expect(text, "manifest nemá pgadmin na backend — sonda nemá co přesunout").toMatch(/^app: pgadmin:backend:/m);
    writeFileSync(cesta, text.replace(/^app: pgadmin:backend:/m, "app: pgadmin:gpu:"));
    const r = spust(cesta);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/ROZPOR pgadmin: na GPU slotu 'gpu'/);
  }, STROP_MS);

  // Firewall hostitele má vlastní přepínač — deklaraci uzlu (provision_when_env accel-hostfw
  // = [ACCEL_FW_NODE_OWNER, ACCEL_FW_SSH]); vstup lane (`accel-vstup`) je za ACCEL_DEKLARACE_B64
  // a enginy (`accel-embed-<n>`) za ACCEL_EMBED_<n>_REPO — všechno odvozené z deklarace uzlu.
  // Majitel 2026-10-05: nejdřív firewall, kouřový test lane až po něm.
  const LANE_VRSTVY = ["ACCEL_DEKLARACE_B64", "ACCEL_EMBED_1_REPO", "ACCEL_EMBED_2_REPO"];
  const prostredi = (hodnoty) => {
    const soubor = join(d, `prostredi-${Object.keys(hodnoty).join("-") || "nic"}.env`);
    writeFileSync(soubor, ["CHAT_GGUF_URL=https://modely.example/model.gguf", ...Object.entries(hodnoty).map(([k, v]) => `${k}=${v}`)].join("\n") + "\n");
    return {
      ...process.env,
      AISHA_PROFILE: "gputest",
      AISHA_INSTANCE_CONFIG_DIR: d,
      ENV_FILE: soubor,
      CHAT_GGUF_URL: "https://modely.example/model.gguf",
      ...Object.fromEntries(LANE_VRSTVY.map((k) => [k, ""])),
      ACCEL_FW_NODE_OWNER: "",
      ACCEL_FW_SSH: "",
      ...hodnoty,
    };
  };
  const umisteni = (env) => {
    const r = spawnSync(process.execPath, [join(KOREN, "scripts/lib/derive-domains.mjs"), "--shell"], { encoding: "utf8", env });
    expect(r.status, r.stderr).toBe(0);
    return new Set([...r.stdout.matchAll(/^([A-Z0-9_]+)_PLACEMENT=/gm)].map((m) => m[1]));
  };
  const UZEL = { ACCEL_FW_NODE_OWNER: "vrstva-a", ACCEL_FW_SSH: "svet" };
  const LANE_OTEVRENE = { ACCEL_DEKLARACE_B64: "x", ACCEL_EMBED_1_REPO: "org/model", ACCEL_EMBED_2_REPO: "org/model" };
  const SLUZBY_LANE = ["ACCEL_VSTUP", "ACCEL_EMBED_1", "ACCEL_EMBED_2"];

  it("firewall PŘED lane: deklarovaný vlastník uzlu + zavřené lane vstupu a enginů → firewall v topologii, vstup ani enginy ne; krok 0 (manifest `accel-hostfw:gpu`, compose v síti hostitele) kód 0", () => {
    profil({});
    expect(readFileSync(MANIFEST, "utf8"), "manifest nemá firewall hostitele na slotu gpu").toMatch(/^app: accel-hostfw:gpu:docker-compose\.coolify-accel-hostfw\.yml$/m);
    expect(readFileSync(join(KOREN, "docker-compose.coolify-accel-hostfw.yml"), "utf8"), "compose firewallu běží v síti hostitele — jinak by kotva níž nic nedokazovala").toMatch(/^\s+network_mode: host$/m);
    const env = prostredi(UZEL);
    const v = umisteni(env);
    expect(v.has("ACCEL_HOSTFW"), "firewall hostitele v topologii").toBe(true);
    for (const id of SLUZBY_LANE) expect(v.has(id), `${id} za zavřenou lane v topologii není`).toBe(false);
    const r = spawnSync("bash", [SOUHLASI, MANIFEST], { encoding: "utf8", env });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/umístění souhlasí: \d+ aplikací manifestu × profil/);
    expect(r.stdout).toMatch(/umístění slotů v pořádku/);
    expect(r.stderr).not.toMatch(/accel-hostfw/);
    // Stačí kterákoli z deklarací uzlu (provision_when_env je výčet přepínačů).
    expect(umisteni(prostredi({ ACCEL_FW_NODE_OWNER: "vrstva-a" })).has("ACCEL_HOSTFW")).toBe(true);
  }, STROP_MS);

  it("⛔ bez deklarace uzlu firewall v topologii NENÍ — ani s otevřenými lane vstupu a enginů; krok 0 bez deklarace kód 0", () => {
    profil({});
    const nic = prostredi({});
    expect(umisteni(nic).has("ACCEL_HOSTFW")).toBe(false);
    const r = spawnSync("bash", [SOUHLASI, MANIFEST], { encoding: "utf8", env: nic });
    expect(r.status, r.stderr).toBe(0);
    const jenLane = umisteni(prostredi(LANE_OTEVRENE));
    expect(jenLane.has("ACCEL_HOSTFW"), "lane vstupu ani enginů firewall nezapínají").toBe(false);
    expect(jenLane.has("ACCEL_VSTUP"), "měřidlo: lane vstupu otevřená").toBe(true);
  }, STROP_MS);

  it("lane vstupu a enginů otevřené s deklarovaným uzlem: skutečné compose vrstvy (accel-vstup, -embed-1, -embed-2) se skutečným katalogem projdou krokem 0 — kód 0, žádný nález o accel", () => {
    profil({});
    const katalog = JSON.parse(readFileSync(join(KOREN, "config/services.json"), "utf8")).services;
    for (const id of ["accel-vstup", "accel-embed-1", "accel-embed-2"]) {
      expect(existsSync(join(KOREN, katalog[id].compose)), `compose ${id} z katalogu existuje`).toBe(true);
      expect(readFileSync(MANIFEST, "utf8"), `manifest nese ${id} na gpu s compose z katalogu`).toMatch(new RegExp(`^app: ${id}:gpu:${katalog[id].compose.replace(/\./g, "\\.")}$`, "m"));
    }
    const env = prostredi({ ...UZEL, ...LANE_OTEVRENE });
    const v = umisteni(env);
    for (const id of ["ACCEL_HOSTFW", ...SLUZBY_LANE]) expect(v.has(id), `${id} v topologii`).toBe(true);
    const r = spawnSync("bash", [SOUHLASI, MANIFEST], { encoding: "utf8", env });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toMatch(/accel/);
    expect(r.stdout).toMatch(/umístění slotů v pořádku/);
  }, STROP_MS);

  it("⛔ kotva výjimek vrstvy: skutečné compose bez výjimky z katalogu = nález — vstup bez `socket_dockeru` ROZPOR 1 (soket Dockeru), engine s compose mimo katalog NEZMĚŘENO 2 (svazek vah external); se skutečným katalogem žádný", () => {
    const katalog = JSON.parse(readFileSync(join(KOREN, "config/services.json"), "utf8")).services;
    const radek = (id) => parsujMapuManifestu(`${id}\tgpu\t${katalog[id].compose}\n`);
    for (const id of ["accel-vstup", "accel-embed-1", "accel-embed-2"]) expect(overManifest(radek(id), { servers, katalog }), id).toEqual([]);
    const { socket_dockeru: _duvod, ...vstupBezSoketu } = katalog["accel-vstup"];
    const n = overManifest(radek("accel-vstup"), { servers, katalog: { ...katalog, "accel-vstup": vstupBezSoketu } });
    expect(n).toEqual([expect.objectContaining({ kod: 1, id: "accel-vstup" })]);
    expect(n[0].zprava).toMatch(/accel-docker-proxy svazek \(soket: \/var\/run\/docker\.sock\)/);
    const e = overManifest(radek("accel-embed-1"), { servers, katalog: { ...katalog, "accel-embed-1": { ...katalog["accel-embed-1"], compose: "jiny.yml" } } });
    expect(e).toEqual([expect.objectContaining({ kod: 2, id: "accel-embed-1" })]);
    expect(e[0].zprava).toMatch(/svazek vahy \(external/);
  });

  it("⛔ kotva: TÝŽ manifest a compose firewallu bez `sit_hostitele` v katalogu = ROZPOR 1 (síť hostitele na GPU slotu); s ním žádný nález", () => {
    const radek = parsujMapuManifestu("accel-hostfw\tgpu\tdocker-compose.coolify-accel-hostfw.yml\n");
    const katalog = JSON.parse(readFileSync(join(KOREN, "config/services.json"), "utf8")).services;
    expect(typeof katalog["accel-hostfw"].sit_hostitele, "katalog nese pojmenovaný důvod").toBe("string");
    expect(overManifest(radek, { servers, katalog }), "skutečný katalog a skutečný compose").toEqual([]);
    const { sit_hostitele: _duvod, ...bezDuvodu } = katalog["accel-hostfw"];
    const n = overManifest(radek, { servers, katalog: { ...katalog, "accel-hostfw": bezDuvodu } });
    expect(n).toEqual([expect.objectContaining({ kod: 1, id: "accel-hostfw" })]);
    expect(n[0].zprava).toMatch(/obchází síť stacku \(.*\(host\)/);
    expect(kodZNalezu(n)).toBe(1);
  });

  it("model na slot, který registr nezná = NEMĚŘENO 2, žádné výchozí umístění", () => {
    profil({ model: { placement: "tpu" } });
    const r = spust(manifest("tpu"));
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/NEZMĚŘENO model: umístění 'tpu' registr slotů/);
  }, STROP_MS);
});
