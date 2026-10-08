/**
 * Postroj pro brány hostitelského firewallu (infra/accel/hostfw.sh).
 *
 * Simulovaný hostitel bez jediného skutečného příkazu na síti: falešné
 * iptables (lib/falesne-iptables.mjs) nad JSON stavem, falešné `ip` (výchozí
 * trasa z prostředí testu) a falešné `nft`, které se jen zapíše a selže —
 * hostfw na nftables tabulky (CI VM: `inet ci_vm`, `ip ci_vm_nat`) sahat nesmí.
 *
 * Výchozí stav = hostitel s Dockerem A s CI VM (dohoda s Android, ACCEL_PLANE.md):
 * most `virbr-ci`, dvě pravidla v DOCKER-USER jen pro ten most, cizí pravidlo
 * v INPUT. Adresy jsou z dokumentačních rozsahů (RFC 5737 / RFC 3849),
 * rozhraní má jméno, jaké žádný hostitel nemá — nic z toho nejsou data instance.
 */
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const ROOT = process.cwd();
export const HOSTFW = join(ROOT, "infra/accel/hostfw.sh");
const FALESNE_IPT = join(ROOT, "src/tests/gates/lib/falesne-iptables.mjs");

export const ROZHRANI = "verejne0";
export const SPRAVA = "192.0.2.10/32,198.51.100.0/24,2001:db8:a::/48";
/** Port UDP meshe pro fixtury, které ho deklarují (ACCEL_FW_UDP_MESH_PORT) — smyšlený, ne výchozí NetBirdu. */
export const MESH_PORT = "40404";
/** Identita vrstvy, která je ve fixtuře vlastníkem uzlu (smyšlená, ne data instance). */
export const VLASTNIK = "vrstva-a";

export type Pravidlo = { spec: string; pkts: number };
export type Retez = { politika: string | null; pravidla: Pravidlo[] };
export type Stav = {
  tabulky: Record<"4" | "6", Record<string, Retez>>;
  /** nftables tabulky CI VM — falešné iptables je nevidí, hostfw na ně nesmí. */
  nft: Record<string, string[]>;
};

const r = (spec: string): Pravidlo => ({ spec, pkts: 0 });

export function vychoziStav(): Stav {
  return {
    tabulky: {
      "4": {
        INPUT: { politika: "ACCEPT", pravidla: [r("-i virbr-ci -p udp -m udp --dport 67 -m comment --comment ci-vm-dhcp -j ACCEPT")] },
        FORWARD: { politika: "DROP", pravidla: [r("-j DOCKER-USER"), r("-j DOCKER-FORWARD")] },
        OUTPUT: { politika: "ACCEPT", pravidla: [] },
        "DOCKER-USER": {
          politika: null,
          pravidla: [
            r("-i virbr-ci -m comment --comment ci-vm -j ACCEPT"),
            r("-o virbr-ci -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment ci-vm -j ACCEPT"),
          ],
        },
        "DOCKER-FORWARD": { politika: null, pravidla: [r("-o docker0 -j DOCKER"), r("-o br-+ -j DOCKER")] },
        DOCKER: { politika: null, pravidla: [] },
      },
      "6": {
        INPUT: { politika: "ACCEPT", pravidla: [] },
        FORWARD: { politika: "DROP", pravidla: [r("-j DOCKER-USER")] },
        OUTPUT: { politika: "ACCEPT", pravidla: [] },
        "DOCKER-USER": { politika: null, pravidla: [] },
      },
    },
    nft: {
      "inet ci_vm": ["iifname virbr-ci accept", "oifname virbr-ci ct state established,related accept"],
      "ip ci_vm_nat": ["tcp dport 2222 ip saddr { 192.0.2.10 } dnat to 203.0.113.10:22", "oifname != virbr-ci masquerade"],
    },
  };
}

export type Postroj = {
  adresar: string;
  stavSoubor: string;
  logIpt: string;
  logNft: string;
  procNet: string;
  stavDir: string;
  env: (extra?: Record<string, string>) => NodeJS.ProcessEnv;
  cti: () => Stav;
  zapis: (s: Stav) => void;
  pakety: (rodina: "4" | "6", podretezec: string, n: number) => void;
  stavHostfw: () => string | null;
};

export function postroj(stav: Stav = vychoziStav()): Postroj {
  const adresar = mkdtempSync(join(tmpdir(), "hostfw-postroj-"));
  const bin = join(adresar, "bin");
  mkdirSync(bin);
  const procNet = join(adresar, "proc-net");
  mkdirSync(procNet);
  writeFileSync(join(procNet, "if_inet6"), "");
  const stavDir = join(adresar, "run-hostfw");
  const stavSoubor = join(adresar, "ipt.json");
  const logIpt = join(adresar, "ipt.log");
  const logNft = join(adresar, "nft.log");
  writeFileSync(stavSoubor, JSON.stringify(stav, null, 2));
  for (const rod of ["iptables", "ip6tables"]) {
    for (const b of ["nft", "legacy"]) {
      for (const d of ["", "-restore", "-save"]) {
        const jmeno = `${rod}-${b}${d}`;
        writeFileSync(join(bin, jmeno), `#!/bin/sh\nexec "${process.execPath}" "${FALESNE_IPT}" ${jmeno} "$@"\n`);
        chmodSync(join(bin, jmeno), 0o755);
      }
    }
  }
  writeFileSync(
    join(bin, "ip"),
    [
      "#!/bin/sh",
      'case "$1 $2 $3 $4" in',
      '  "-4 route show default") [ -n "${FALESNA_TRASA4:-}" ] && printf \'%s\\n\' "$FALESNA_TRASA4" ;;',
      '  "-6 route show default") [ -n "${FALESNA_TRASA6:-}" ] && printf \'%s\\n\' "$FALESNA_TRASA6" ;;',
      '  *) echo "falešné ip: $*" >&2; exit 2 ;;',
      "esac",
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "ip"), 0o755);
  writeFileSync(join(bin, "nft"), `#!/bin/sh\necho "nft $*" >> "${logNft}"\nexit 1\n`);
  chmodSync(join(bin, "nft"), 0o755);

  const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
    PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: adresar,
    FALESNE_IPT_STAV: stavSoubor,
    FALESNE_IPT_LOG: logIpt,
    FALESNE_IPT_BACKEND: "nft",
    FALESNA_TRASA4: `default via 192.0.2.1 dev ${ROZHRANI} proto static`,
    HOSTFW_PROC_NET: procNet,
    HOSTFW_STAV_DIR: stavDir,
    HOSTFW_KROK_S: "1",
    ACCEL_FW_MODE: "measure",
    // Volba SSH hostitele z deklarace uzlu (bez ní hostfw nenaběhne); výchozí fixtura = přísnější.
    ACCEL_FW_SSH: "sprava",
    // Identita vrstvy instance a deklarovaný vlastník uzlu — firewall běží jen u vlastníka.
    ACCEL_OWNER_PREFIX: VLASTNIK,
    ACCEL_FW_NODE_OWNER: VLASTNIK,
    ACCEL_FW_ADMIN_CIDRS: SPRAVA,
    // Příchozí UDP meshe se otevírá jen deklarací uzlu (ACCEL_FW_UDP_MESH_PORT); výchozí fixtura = zavřeno.
    ACCEL_FW_CONFIRM_S: "10",
    ACCEL_FW_INTERVAL_S: "5",
    ...extra,
  });
  return {
    adresar,
    stavSoubor,
    logIpt,
    logNft,
    procNet,
    stavDir,
    env,
    cti: () => JSON.parse(readFileSync(stavSoubor, "utf8")) as Stav,
    zapis: (s) => writeFileSync(stavSoubor, JSON.stringify(s, null, 2)),
    pakety: (rodina, podretezec, n) => {
      const v = spawnSync(process.execPath, [FALESNE_IPT, "--pakety", rodina, podretezec, String(n)], {
        env: { FALESNE_IPT_STAV: stavSoubor },
        encoding: "utf8",
      });
      if (v.status !== 0) throw new Error(`pakety: ${v.stderr}`);
    },
    stavHostfw: () => {
      const p = join(stavDir, "stav");
      if (!existsSync(p)) return null;
      return /^stav=(\S+)/m.exec(readFileSync(p, "utf8"))?.[1] ?? null;
    },
  };
}

/** `hostfw.sh --plan` (DRY_RUN) — výstup a kód. */
export function plan(p: Postroj, extra: Record<string, string> = {}, skript = HOSTFW) {
  const v = spawnSync("sh", [skript, "--plan"], { env: p.env(extra), encoding: "utf8", timeout: 60_000 });
  return { kod: v.status, out: v.stdout ?? "", err: v.stderr ?? "" };
}

/** Jednorázový příkaz hostfw.sh (--vrat, --zdravi). */
export function prikaz(p: Postroj, arg: string, extra: Record<string, string> = {}) {
  const v = spawnSync("sh", [HOSTFW, arg], { env: p.env(extra), encoding: "utf8", timeout: 60_000 });
  return { kod: v.status, out: v.stdout ?? "", err: v.stderr ?? "" };
}

/** Spustí hostfw.sh na pozadí; `cekej` čeká na stav, `zastav` pošle TERM. */
export function spustit(p: Postroj, extra: Record<string, string> = {}) {
  // Stav předchozího běhu nesmí odpovědět za tenhle (hostfw ho při startu přepíše
  // na STARTUJE, ale čekání by ho mohlo přečíst dřív, než proces naběhne).
  rmSync(join(p.stavDir, "stav"), { force: true });
  const proc = spawn("sh", [HOSTFW], { env: p.env(extra) });
  let log = "";
  proc.stdout.on("data", (d) => (log += d));
  proc.stderr.on("data", (d) => (log += d));
  let skoncil: number | null | undefined;
  proc.on("exit", (kod) => (skoncil = kod));
  return {
    log: () => log,
    async cekej(stavy: string[], stropMs = 150_000): Promise<string> {
      const konec = Date.now() + stropMs;
      while (Date.now() < konec) {
        const s = p.stavHostfw();
        if (s && stavy.includes(s)) return s;
        if (skoncil !== undefined) throw new Error(`hostfw skončil (kód ${skoncil}) dřív než ve stavu ${stavy.join("|")}:\n${log}`);
        await new Promise((ok) => setTimeout(ok, 150));
      }
      throw new Error(`hostfw nedošel do stavu ${stavy.join("|")} za ${stropMs} ms (je ${p.stavHostfw()}):\n${log}`);
    },
    /**
     * Počká, až log obsahuje `vzor`, a vrátí ho. Stav hostfw leží v SOUBORU, log přichází
     * ROUROU: `cekej` vidí stav dřív, než smyčka událostí přečte data z roury, takže
     * `log()` hned po `cekej` může hlášku ještě nemít (naměřeno v CI pod zátěží: stav
     * SELHALO, log jen „STARTUJE“). Hláška, která nedorazí, je pád s celým logem.
     */
    async cekejNaLog(vzor: RegExp, stropMs = 30_000): Promise<string> {
      const konec = Date.now() + stropMs;
      while (Date.now() < konec) {
        if (vzor.test(log)) return log;
        if (skoncil !== undefined) {
          await new Promise((ok) => setImmediate(ok)); // dočíst, co v rouře zbylo po exitu
          if (vzor.test(log)) return log;
          throw new Error(`hostfw skončil (kód ${skoncil}) a v logu chybí ${vzor}:\n${log}`);
        }
        await new Promise((ok) => setTimeout(ok, 50));
      }
      throw new Error(`v logu hostfw se za ${stropMs} ms neobjevilo ${vzor}:\n${log}`);
    },
    async zastav(): Promise<void> {
      if (skoncil !== undefined) return;
      await new Promise<void>((ok) => {
        proc.once("exit", () => ok());
        proc.kill("SIGTERM");
      });
    },
  };
}

/** Cizí řetězce (ne AISHA-HOSTFW-*) bez skoků hostfw — to, co se po apply i revertu nesmí změnit. */
export function ciziBezSkoku(s: Stav) {
  const out: Record<string, Record<string, string[]>> = {};
  for (const rod of ["4", "6"] as const) {
    out[rod] = {};
    for (const [jmeno, ret] of Object.entries(s.tabulky[rod])) {
      if (jmeno.startsWith("AISHA-HOSTFW-")) continue;
      out[rod][jmeno] = [`politika ${ret.politika}`, ...ret.pravidla.filter((x) => !/ -j AISHA-HOSTFW-/.test(` ${x.spec}`)).map((x) => x.spec)];
    }
  }
  return out;
}

/** Pravidla v cizích řetězcích, která skáčou do vlastních. */
export function skokyHostfw(s: Stav, rodina: "4" | "6") {
  return Object.entries(s.tabulky[rodina]).flatMap(([jmeno, ret]) =>
    ret.pravidla.filter((x) => / -j AISHA-HOSTFW-/.test(` ${x.spec}`)).map((x) => `${jmeno} ${x.spec}`),
  );
}
