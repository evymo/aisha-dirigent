#!/usr/bin/env node
/**
 * accel-deklarace.mjs — jak se čtou deklarace akcelerační vrstvy (GPU uzel, slot `gpu`).
 *
 * JEDEN domov výkladu proměnných firewallu. Čtou ho env-doktor (posudek před nasazením,
 * vnější sonda), hostitelský firewall `accel-hostfw` (CLI `--firewall`, viz
 * infra/accel/hostfw.sh) a ověření deklarace uzlu (accel-uzel.mjs overUzel): dva výklady
 * téže hodnoty by se rozešly — doktor by pustil, co firewall vyloží jinak.
 *
 * Hodnoty (DATA INSTANCE, platforma žádnou nedosazuje) odvozuje z deklarace GPU uzlu
 * derive-accel-uzel.mjs (accel/uzel.json v datech instance vlastníka vrstvy); jen
 * ACCEL_CI_VM_SSH_PORT dodává obsluha. Lane firewallu (provision_when_env [ACCEL_FW_NODE_OWNER,
 * ACCEL_FW_SSH] služby accel-hostfw) se tím otevře spolu s deklarací uzlu; vstup lane na
 * firewallu závisí (majitel 2026-10-05: nejdřív firewall, lane po něm).
 *   ACCEL_OWNER_PREFIX     identita vrstvy — jména kontejnerů, mesh jména, aliasy
 *                          a svazek vah se skládají z ní, NE z APP_NAME_PREFIX.
 *                          Výslovná, bez náhrady: dnes = vlastní APP_NAME_PREFIX
 *                          instance, ale při přesunu vrstvy do projektu operátora
 *                          zůstává táž, takže svazek vah (desítky GB) přežije.
 *   ACCEL_FW_MODE          measure | enforce. Cokoli jiného (i prázdno) = ŽÁDNÝ
 *                          režim (`rezim: null`) + chyba. Neznámý bezpečnostní
 *                          přepínač je fail-closed: spotřebitel (firewall) NESMÍ
 *                          naběhnout — ani jako measure (= otevřeno), ani jako
 *                          enforce (zamkl by správu).
 *   ACCEL_FW_ADMIN_CIDRS   správcovské adresy (čárkami oddělené CIDR): odkud smí
 *                          SSH správy a odkud smí VŠECHNY ostatní příchozí porty,
 *                          i porty publikované kontejnery (řetězec DOCKER-USER).
 *                          Prázdný nebo vadný seznam = `cidrs: null` + chyba:
 *                          spotřebitel NESMÍ naběhnout (prázdný seznam by zamkl
 *                          správu, polovičatý by zamkl, co chybí).
 *   ACCEL_FW_NODE_OWNER    vlastník UZLU — identita (tvar ACCEL_OWNER_PREFIX), které
 *                          jediné smí na GPU stroji běžet firewall hostitele. Pravidla
 *                          firewallu jsou stav celého stroje (řetězce AISHA-HOSTFW-*):
 *                          druhý vlastník vrstvy by spustil druhý firewall, který by
 *                          se o tytéž řetězce pral (a při vlastním selhání sundal
 *                          pravidla vlastníka). Deklarace uzlu, ne kód: firewall
 *                          naběhne JEN tehdy, když ACCEL_OWNER_PREFIX instance je
 *                          přesně vlastník uzlu; jinak STOP s pojmenovanou příčinou
 *                          a pravidla se NEMĚNÍ (vlastnikUzlu, CLI --vlastnik).
 *   ACCEL_FW_UDP_MESH_PORT příchozí UDP port meshe, který firewall hostitele PROPOUŠTÍ
 *                          (INPUT i DOCKER-USER) a kontrola uzlu bere jako jedinou
 *                          výjimku publikovaného portu. Nejmenší oprávnění: modelový
 *                          mesh v1 (varianta C) jede jen přes relay na TCP 443 a na GPU
 *                          uzlu příchozí UDP nic neobsluhuje — proto BEZ výchozí
 *                          hodnoty: prázdno = UDP ZAVŘENO, port 1–65535 = přesně ten
 *                          port, cokoli jiného = chyba a firewall NENABĚHNE
 *                          (udpPortMeshe). Dřív se otevíral NETBIRD_MESH_PORT vždy.
 *   ACCEL_FW_SSH           komu je otevřené SSH hostitele (tcp/22 v INPUT):
 *                          `svet` — komukoli (přístup hlídá sshd, jen klíčem; ne
 *                          firewall), `sprava` — jen ze správcovských adres. Volba
 *                          je v deklaraci uzlu, ne v kódu: žádná výchozí hodnota,
 *                          prázdno nebo cokoli jiného = chyba a firewall NENABĚHNE
 *                          (neznámý bezpečnostní přepínač je fail-closed). „Světu"
 *                          platí JEN pro SSH hostitele — nikdy pro jiný port ani
 *                          pro publikované porty kontejnerů.
 *                          Odchozí provoz firewall NEOMEZUJE (do OUTPUT nesahá, skok
 *                          z DOCKER-USER míří jen z veřejného rozhraní DO mostů):
 *                          agenti NetBird (443/tcp a 3478/udp na edge forků, UDP
 *                          WireGuard) projdou a jejich odpovědi pouští ESTABLISHED.
 *   ACCEL_CI_VM_SSH_PORT   port SSH do CI VM na hostiteli uzlu (DNAT správy), nebo
 *                          výslovné `zadna` = žádná CI VM. Čte ho vnější sonda
 *                          doktora; prázdno nebo cokoli jiného = NEZMĚŘENO.
 */
import { isIP } from "node:net";
import { isDirectRun } from "./cli-entry.mjs";
import { nactiKatalog, podminkaSplnena } from "./provision-gate.mjs";

export const ACCEL_FW_REZIMY = Object.freeze(["measure", "enforce"]);

/**
 * Smí firewall hostitele téhle instance běžet na uzlu? Jen když je její identita vrstvy
 * (ACCEL_OWNER_PREFIX) PŘESNĚ deklarovaný vlastník uzlu (ACCEL_FW_NODE_OWNER). Chybějící
 * nebo vadná deklarace, nebo cizí identita = `smi: false` + příčina (fail-closed).
 * Spotřebitel (infra/accel/hostfw.sh) se ptá DŘÍV, než sáhne na jakékoli pravidlo.
 * @returns {{ smi: boolean, chyba: string|null }}
 */
export function vlastnikUzlu(cti) {
  const ja = String(cti("ACCEL_OWNER_PREFIX") ?? "").trim();
  const uzel = String(cti("ACCEL_FW_NODE_OWNER") ?? "").trim();
  if (uzel === "") {
    return { smi: false, chyba: "ACCEL_FW_NODE_OWNER není deklarovaný — nevím, kdo je vlastník uzlu; firewall hostitele NENABĚHNE (pravidla se nemění)" };
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(uzel)) {
    return { smi: false, chyba: `ACCEL_FW_NODE_OWNER='${uzel}' není jméno identity vrstvy — firewall hostitele NENABĚHNE (pravidla se nemění)` };
  }
  const vadaJa = posudVlastnika(ja);
  if (vadaJa) return { smi: false, chyba: `${vadaJa} — vlastnictví uzlu nejde porovnat; firewall hostitele NENABĚHNE (pravidla se nemění)` };
  if (ja !== uzel) {
    return {
      smi: false,
      chyba:
        `ACCEL_OWNER_PREFIX='${ja}' NENÍ vlastník uzlu (ACCEL_FW_NODE_OWNER='${uzel}') — firewall hostitele smí na stroji ` +
        "provozovat jen vlastník uzlu: druhý firewall by se o řetězce AISHA-HOSTFW-* pral. STOP, pravidla se nemění",
    };
  }
  return { smi: true, chyba: null };
}

/**
 * Příchozí UDP port meshe z deklarace uzlu (ACCEL_FW_UDP_MESH_PORT). Jen výslovná
 * deklarace port otevírá: prázdno = `port: null` BEZ chyby (UDP zavřeno — výchozí
 * stav, ne vada); port mimo 1–65535 nebo jiný zápis = `port: null` + chyba.
 * Jeden domov výkladu pro firewall (CLI --firewall), kontrolu uzlu i vnější sondu.
 * @returns {{ port: number|null, chyba: string|null }}
 */
export function udpPortMeshe(cti) {
  const t = String(cti("ACCEL_FW_UDP_MESH_PORT") ?? "").trim();
  if (t === "") return { port: null, chyba: null };
  // Jen desetinný zápis: `Number()` by přijal i `0x16` a `2e3`.
  if (!/^[1-9][0-9]{0,4}$/.test(t) || Number(t) > 65535) {
    return { port: null, chyba: `ACCEL_FW_UDP_MESH_PORT='${t}' není port (celé číslo 1–65535); prázdné = UDP zavřeno — firewall NENABĚHNE, oprav hodnotu` };
  }
  return { port: Number(t), chyba: null };
}

/** Komu je otevřené SSH hostitele: `svet` (hlídá sshd) | `sprava` (jen správcovské adresy). */
export const ACCEL_FW_SSH_VOLBY = Object.freeze(["svet", "sprava"]);

/**
 * Volba SSH hostitele z deklarace uzlu. Známá hodnota platí; cokoli jiného (i
 * prázdno) = `ssh: null` + chyba — žádná výchozí volba v kódu, firewall nenaběhne.
 * @returns {{ ssh: "svet"|"sprava"|null, chyba: string|null }}
 */
export function sshFirewallu(hodnota) {
  const t = String(hodnota ?? "").trim();
  if (ACCEL_FW_SSH_VOLBY.includes(t)) return { ssh: t, chyba: null };
  return {
    ssh: null,
    chyba:
      t === ""
        ? `ACCEL_FW_SSH není deklarovaný — firewall NENABĚHNE; deklaruj ${ACCEL_FW_SSH_VOLBY.join("|")} (svet = SSH komukoli, hlídá sshd; sprava = jen ze správcovských adres)`
        : `ACCEL_FW_SSH='${t}' není ${ACCEL_FW_SSH_VOLBY.join("|")} — firewall NENABĚHNE, oprav hodnotu`,
  };
}

/**
 * Režim firewallu. Známá hodnota platí; cokoli jiného = `rezim: null` + chyba.
 * `null` NENÍ výchozí režim — je to pokyn spotřebiteli nenaběhnout (fail-closed).
 * @returns {{ rezim: "measure"|"enforce"|null, chyba: string|null }}
 */
export function rezimFirewallu(hodnota) {
  const t = String(hodnota ?? "").trim();
  if (ACCEL_FW_REZIMY.includes(t)) return { rezim: t, chyba: null };
  return {
    rezim: null,
    chyba:
      t === ""
        ? `ACCEL_FW_MODE není deklarovaný — firewall NENABĚHNE; deklaruj ${ACCEL_FW_REZIMY.join("|")}`
        : `ACCEL_FW_MODE='${t}' není ${ACCEL_FW_REZIMY.join("|")} — firewall NENABĚHNE, oprav hodnotu`,
  };
}

/**
 * Nejkratší přípustná maska adresy správy. Kratší maska už nepopisuje „odkud se
 * spravuje", ale celé bloky internetu: /8 v IPv4 je 16,7 mil. adres (nejmenší
 * blok, který RIR vůbec přiděloval), /16 v IPv6 je víc, než kolik kdy dostal
 * jakýkoli jednotlivý provozovatel (alokace RIR jsou /19–/32). Delší masky jsou
 * věc instance — tohle je jen hranice, za kterou to přestává být správa.
 */
export const NEJKRATSI_MASKA_SPRAVY = Object.freeze({ 4: 8, 6: 16 });

/** Jeden CIDR (IPv4 i IPv6) s maskou, ne kratší než NEJKRATSI_MASKA_SPRAVY. */
function posudCidr(cidr) {
  const m = /^([^/\s]+)\/(\d{1,3})$/.exec(cidr);
  if (!m) return `'${cidr}' není CIDR (adresa/maska)`;
  const verze = isIP(m[1]);
  if (verze === 0) return `'${cidr}' nemá platnou IP adresu`;
  const maska = Number(m[2]);
  if (maska > (verze === 4 ? 32 : 128)) return `'${cidr}' má masku mimo rozsah IPv${verze}`;
  if (maska < NEJKRATSI_MASKA_SPRAVY[verze]) {
    return `'${cidr}' je blok internetu, ne adresa správy (maska kratší než /${NEJKRATSI_MASKA_SPRAVY[verze]})`;
  }
  return null;
}

/**
 * Adresy správy. Prázdný nebo vadný seznam = `cidrs: null` + chyby (fail-closed:
 * spotřebitel nesmí naběhnout s prázdným ani polovičatým seznamem).
 * @returns {{ cidrs: string[]|null, chyby: string[] }}
 */
export function adresySpravy(hodnota) {
  const cidrs = String(hodnota ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (cidrs.length === 0) {
    return {
      cidrs: null,
      chyby: ["ACCEL_FW_ADMIN_CIDRS je prázdný — fail-closed: firewall bez adres správy NENABĚHNE (enforce by zamkl i správu)"],
    };
  }
  const chyby = cidrs.map(posudCidr).filter(Boolean).map((c) => `ACCEL_FW_ADMIN_CIDRS: ${c}`);
  return { cidrs: chyby.length ? null : cidrs, chyby };
}

/** Identita vrstvy musí být použitelná jako jméno kontejneru i svazku. */
export function posudVlastnika(hodnota) {
  const t = String(hodnota ?? "").trim();
  if (t === "") return "ACCEL_OWNER_PREFIX není deklarovaný — identita vrstvy se NEODVOZUJE z APP_NAME_PREFIX, deklaruj ji výslovně";
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(t)) {
    return `ACCEL_OWNER_PREFIX='${t}' není použitelné jméno (malá písmena, číslice, pomlčka uvnitř)`;
  }
  return null;
}

/** Služba firewallu hostitele v katalogu — její lane je jediný domov přepínače firewallu. */
export const SLUZBA_FIREWALLU_KATALOGU = "accel-hostfw";

/**
 * Lane firewallu z katalogu repa (čte se až při posudku — CLI v kontejneru firewallu
 * katalog nepotřebuje). Služba bez lane by byla povinná všude: to je chyba katalogu.
 */
function laneFirewalluZKatalogu() {
  const lane = nactiKatalog()?.[SLUZBA_FIREWALLU_KATALOGU]?.provision_when_env;
  if (!lane || (Array.isArray(lane) && lane.length === 0)) {
    throw new Error(`katalog u služby ${SLUZBA_FIREWALLU_KATALOGU} nevede provision_when_env — firewall by byl povinný na každé instanci`);
  }
  return lane;
}

/**
 * Posudek tvaru deklarací firewallu hostitele (ACCEL_OWNER_PREFIX, ACCEL_FW_*) a portu CI VM.
 * Hodnoty vrstvy odvozuje deklarace uzlu (derive-accel-uzel.mjs, ověřená už accel-uzel.mjs);
 * tohle je pojistka nad tím, co skutečně LEŽÍ v env instance (ruční zásah, stará záloha).
 * Tvar se posuzuje u každé VYPLNĚNÉ hodnoty; povinnost, když je otevřená lane firewallu
 * (provision_when_env služby accel-hostfw v katalogu — čte se odtud, neopisuje).
 * Bez lane a bez hodnot = žádný nález (instance bez GPU).
 *
 * @param {(klic: string) => string|undefined} cti
 * @param {{ laneFirewallu?: string|string[] }} [volby] lane firewallu (výchozí: z katalogu repa)
 * @returns {string[]} chyby
 */
export function posudAccel(cti, { laneFirewallu = laneFirewalluZKatalogu() } = {}) {
  const hodnota = (k) => String(cti(k) ?? "").trim();
  const firewall = podminkaSplnena(laneFirewallu, (k) => hodnota(k));
  const chyby = [];

  let identitaHlasena = false;
  if (firewall || hodnota("ACCEL_OWNER_PREFIX")) {
    const c = posudVlastnika(hodnota("ACCEL_OWNER_PREFIX"));
    if (c) {
      chyby.push(c);
      identitaHlasena = true;
    }
  }
  if (firewall || hodnota("ACCEL_FW_MODE")) {
    const { chyba } = rezimFirewallu(hodnota("ACCEL_FW_MODE"));
    if (chyba) chyby.push(chyba);
  }
  if (firewall || hodnota("ACCEL_FW_ADMIN_CIDRS")) {
    chyby.push(...adresySpravy(hodnota("ACCEL_FW_ADMIN_CIDRS")).chyby);
  }
  if (firewall || hodnota("ACCEL_FW_SSH")) {
    const { chyba } = sshFirewallu(hodnota("ACCEL_FW_SSH"));
    if (chyba) chyby.push(chyba);
  }
  // Port UDP meshe je volitelný (prázdno = zavřeno): posuzuje se jen vyplněná hodnota.
  {
    const { chyba } = udpPortMeshe(cti);
    if (chyba) chyby.push(chyba);
  }
  if (firewall || hodnota("ACCEL_FW_NODE_OWNER")) {
    const { chyba } = vlastnikUzlu(cti);
    // Vadu samotné identity vrstvy, už hlášenou výš, podruhé neopakuje; tady to, co
    // přidává deklarace vlastníka uzlu: chybí, je vadná, nebo instance vlastníkem není.
    const dvojiHlaseni = identitaHlasena && hodnota("ACCEL_FW_NODE_OWNER") !== "";
    if (chyba && !dvojiHlaseni) chyby.push(chyba);
  }
  // Port SSH do CI VM: jen TVAR vyplněné hodnoty. Chybějící deklarace firewall
  // nezastaví — vnější sonda ji přizná jako NEZMĚŘENO, tady nálezem není.
  if (hodnota(DEKLARACE_PORTU_CI_VM.klic)) {
    const { duvod } = portCiVm(cti);
    if (duvod) chyby.push(duvod);
  }
  return chyby;
}

/**
 * Výklad pro firewall hostitele: režim, volba SSH a správcovské adresy rozdělené
 * podle rodiny (iptables / ip6tables) — jen pro vlastníka uzlu (vlastnikUzlu).
 * Stačí jedna vadná deklarace a NEPLATÍ NIC —
 * `rezim`, `ssh`, `cidrs4` i `cidrs6` jsou `null` a firewall nenaběhne
 * (fail-closed): polovičatá sada pravidel by zamkla správu nebo nechala otevřeno,
 * co se zavřít mělo.
 *
 * Seznam jedné rodiny smí být prázdný (správa jen po IPv4 → po IPv6 ze správy nic;
 * SSH po IPv6 pak jen při `ssh: "svet"`).
 *
 * @param {(klic: string) => string|undefined} cti
 * `udpMesh` = příchozí UDP port meshe, který firewall propouští, nebo `null` (zavřeno).
 *
 * @returns {{ rezim: "measure"|"enforce"|null, ssh: "svet"|"sprava"|null, udpMesh: number|null, cidrs4: string[]|null, cidrs6: string[]|null, chyby: string[] }}
 */
export function deklaraceFirewallu(cti) {
  const { chyba: chybaVlastnika } = vlastnikUzlu(cti);
  const { rezim, chyba } = rezimFirewallu(cti("ACCEL_FW_MODE"));
  const { ssh, chyba: chybaSsh } = sshFirewallu(cti("ACCEL_FW_SSH"));
  const { port: udpMesh, chyba: chybaUdp } = udpPortMeshe(cti);
  const { cidrs, chyby } = adresySpravy(cti("ACCEL_FW_ADMIN_CIDRS"));
  const vse = [
    ...(chybaVlastnika ? [chybaVlastnika] : []),
    ...(chyba ? [chyba] : []),
    ...(chybaSsh ? [chybaSsh] : []),
    ...(chybaUdp ? [chybaUdp] : []),
    ...chyby,
  ];
  if (vse.length > 0 || rezim === null || ssh === null || cidrs === null) {
    return { rezim: null, ssh: null, udpMesh: null, cidrs4: null, cidrs6: null, chyby: vse };
  }
  const rodina = (c) => isIP(c.split("/")[0]);
  return {
    rezim,
    ssh,
    udpMesh,
    cidrs4: cidrs.filter((c) => rodina(c) === 4),
    cidrs6: cidrs.filter((c) => rodina(c) === 6),
    chyby: [],
  };
}

/**
 * Port SSH do CI VM — DNAT správy virtuálního stroje CI na veřejné adrese GPU uzlu
 * (soužití s CI VM, docs/compose-notes/docker-compose.coolify-accel-hostfw.yml.md).
 * Vnější sonda doktora ho má měřit vždy: nepublikuje ho žádná aplikace Coolify
 * a drží ho cizí tabulka, takže rozbitou množinu správy by jinak nikdo neviděl.
 *
 * Deklaruje ho OBSLUHA instance klíčem vrstvy (vedle ACCEL_FW_*; kontrakt
 * env-doktora ho vede jako `external`, heredoc cold-startu ho propouští).
 * Platforma žádnou hodnotu nedosazuje a žádný literál portu v repu není:
 *   • číslo 1–65535 — port, který sonda měří,
 *   • `zadna`       — výslovně „na hostiteli uzlu žádná CI VM není": port se
 *                     neměří a výstup to řekne (informace, ne NEZMĚŘENO),
 *   • cokoli jiného, prázdno i chybějící klíč — NEZMĚŘENO s důvodem: mlčení
 *     není „žádná CI VM" a překlep není port.
 */
export const DEKLARACE_PORTU_CI_VM = Object.freeze({ klic: "ACCEL_CI_VM_SSH_PORT", bezCiVm: "zadna" });

/**
 * Výklad deklarace portu SSH do CI VM.
 *
 * @param {(klic: string) => string|undefined} cti
 * @returns {{ port: number|null, zadna: boolean, duvod: string|null }}
 *   `port` = číslo k měření; `zadna` = výslovně žádná CI VM (neměřit, říct);
 *   `duvod` = proč deklaraci nejde vyložit (volající to vypíše jako NEZMĚŘENO).
 */
export function portCiVm(cti) {
  const { klic, bezCiVm } = DEKLARACE_PORTU_CI_VM;
  const t = String(cti(klic) ?? "").trim();
  if (t === "") {
    return { port: null, zadna: false, duvod: `${klic} není deklarovaný — deklaruj port (1–65535), nebo '${bezCiVm}', když na hostiteli uzlu CI VM není` };
  }
  if (t === bezCiVm) return { port: null, zadna: true, duvod: null };
  // Jen desetinný zápis: `Number()` by přijal i `0x16` a `2e3`.
  if (!/^[1-9][0-9]{0,4}$/.test(t) || Number(t) > 65535) {
    return { port: null, zadna: false, duvod: `${klic}='${t}' není port (celé číslo 1–65535) ani '${bezCiVm}'` };
  }
  return { port: Number(t), zadna: false, duvod: null };
}

/**
 * Leží adresa v některém z CIDR? (Vnější sonda doktora: smí stanoviště měření
 * podle deklarace na SSH správy?) Porovnává se jen v rámci jedné rodiny.
 *
 * @param {string} adresa
 * @param {string[]} cidrs
 */
export function adresaVCidrech(adresa, cidrs) {
  const verze = isIP(String(adresa ?? ""));
  if (verze === 0) return false;
  const cislo = adresaNaCislo(adresa, verze);
  return (cidrs ?? []).some((c) => {
    const [sit, m] = c.split("/");
    if (isIP(sit) !== verze) return false;
    const maska = Number(m);
    const bity = verze === 4 ? 32n : 128n;
    const posun = bity - BigInt(maska);
    return (cislo >> posun) === (adresaNaCislo(sit, verze) >> posun);
  });
}

/** IP adresa → BigInt (IPv4 i IPv6 včetně zkráceného `::` a IPv4 na konci). */
function adresaNaCislo(adresa, verze) {
  if (verze === 4) return adresa.split(".").reduce((n, o) => (n << 8n) + BigInt(Number(o)), 0n);
  let text = adresa.toLowerCase();
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (v4) {
    const o = v4[1].split(".").map(Number);
    text = text.slice(0, -v4[1].length) + `${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const [hlava, pata] = text.split("::");
  const h = hlava ? hlava.split(":") : [];
  const p = pata !== undefined && pata !== "" ? pata.split(":") : [];
  const skupiny = pata === undefined ? h : [...h, ...Array(8 - h.length - p.length).fill("0"), ...p];
  return skupiny.reduce((n, g) => (n << 16n) + BigInt(parseInt(g || "0", 16)), 0n);
}

// ── CLI (spotřebitel v kontejneru: infra/accel/hostfw.sh) ────────────────────
//   node accel-deklarace.mjs --firewall
//     → kód 0: na stdout `rezim=<measure|enforce>`, `ssh=<svet|sprava>`, `udp_mesh=<port>` (řádek
//       VŽDY; prázdná hodnota = příchozí UDP zavřeno), pak `cidr4=<CIDR>` / `cidr6=<CIDR>` po řádcích
//       kód 1: deklarace neplatná — chyby na stderr, na stdout NIC (firewall nenaběhne)
//   Hodnoty se čtou z prostředí procesu (ACCEL_OWNER_PREFIX, ACCEL_FW_NODE_OWNER,
//   ACCEL_FW_MODE, ACCEL_FW_SSH, ACCEL_FW_UDP_MESH_PORT, ACCEL_FW_ADMIN_CIDRS).
//   node accel-deklarace.mjs --vlastnik
//     → kód 0: instance je vlastník uzlu (na stdout `vlastnik=<identita>`)
//       kód 3: NENÍ (nebo vlastnictví nejde určit) — příčina na stderr; spotřebitel
//              NESMÍ sáhnout na žádné pravidlo (ani sundat „svoje" — patří vlastníkovi)
if (isDirectRun(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.length !== 1 || !["--firewall", "--vlastnik"].includes(argv[0])) {
    console.error("použití: accel-deklarace.mjs --firewall | --vlastnik");
    process.exit(2);
  }
  if (argv[0] === "--vlastnik") {
    const { smi, chyba } = vlastnikUzlu((k) => process.env[k]);
    if (!smi) {
      console.error(`accel-deklarace: ${chyba}`);
      process.exit(3);
    }
    process.stdout.write(`vlastnik=${String(process.env.ACCEL_OWNER_PREFIX).trim()}\n`);
    process.exit(0);
  }
  const d = deklaraceFirewallu((k) => process.env[k]);
  if (d.rezim === null) {
    for (const c of d.chyby) console.error(`accel-deklarace: ${c}`);
    process.exit(1);
  }
  const radky = [`rezim=${d.rezim}`, `ssh=${d.ssh}`, `udp_mesh=${d.udpMesh ?? ""}`, ...d.cidrs4.map((c) => `cidr4=${c}`), ...d.cidrs6.map((c) => `cidr6=${c}`)];
  process.stdout.write(`${radky.join("\n")}\n`);
}
