/**
 * Domov pro otázku „ODKUD se ve službě mountuje?" — dosud si ji každá brána
 * zodpovídala po svém a každá jinak špatně.
 *
 * ⛔ NAMĚŘENO 2026-09-23. `coolify-compose-compliance` četla compose po řádcích
 * a brala jen krátký tvar `- zdroj:cíl`, ze kterého uřízla vše za PRVNÍ
 * dvojtečkou. Dlouhý tvar (`- type: bind` a pod ním `source: …`) neviděla
 * vůbec, a `${INGEST_DOCS_MOUNT:-/srv/…}` uřízla na `${INGEST_DOCS_MOUNT` —
 * dvojtečka uvnitř `${…}` není oddělovač. Sesterská brána sdílených cest četla
 * YAML správně, ale nerozparsovatelný soubor tiše vrátila jako „bez nálezu".
 *
 * Proto jeden čtenář, na kterého se ptají obě:
 *   - ptáme se PARSERU (s merge klíči), ne textu — `- a:b` a `{source: a}`
 *     znamenají totéž;
 *   - krátký tvar se dělí na první dvojtečce MIMO `${…}`;
 *   - zdroj se vrací SUROVÝ (i s `${…}`) — co s ním, rozhoduje brána; cíl bez režimu;
 *   - co s ním udělá Coolify, říká `coolifyOdmitneZdroj` / `coolifyOdmitneCil` (přenos
 *     jeho validace) a `pastNaPromennou` (tvary, které Coolify přijme, ale nefungují);
 *   - nerozparsovatelný compose je VÝJIMKA, ne prázdný seznam: pád měřidla
 *     nesmí vypadat jako čisto.
 */
import { parse } from "yaml";

export type ZdrojSvazku = {
  sluzba: string;
  /** Surový zdroj, jak stojí v compose (i `${VAR:-/cesta}`). */
  zdroj: string;
  /** Cíl v kontejneru (krátký tvar bez režimu `:ro`/`:rw`). */
  cil?: string;
  tvar: "kratky" | "dlouhy";
  /** Jen dlouhý tvar: `bind` / `volume` / `tmpfs` …; krátký tvar typ nenese. */
  typ?: string;
};

/** Krátký tvar `zdroj:cíl[:režim]` — dělí se na první dvojtečce mimo `${…}`. */
export function rozdelKratkyTvar(polozka: string): { zdroj: string; cil: string } | null {
  const s = polozka.replace(/^["']|["']$/g, "");
  let hloubka = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith("${", i)) {
      hloubka++;
      i++;
    } else if (s[i] === "}" && hloubka > 0) {
      hloubka--;
    } else if (s[i] === ":" && hloubka === 0) {
      return { zdroj: s.slice(0, i), cil: s.slice(i + 1) };
    }
  }
  // Bez dvojtečky = anonymní svazek (jen cíl) nebo zkratka pojmenovaného — zdroj nemá.
  return null;
}

/** `${VAR:-/cesta}…` → `/cesta…`; bez výchozí hodnoty `null` (cestu nese až prostředí). */
export function rozvinVychoziHodnotu(zdroj: string): string | null {
  const m = /^\$\{[A-Za-z0-9_]+:?-([^}]*)\}(.*)$/.exec(zdroj);
  if (m) return m[1] + m[2];
  return zdroj.includes("${") ? null : zdroj;
}

// ─── Co Coolify se zdrojem a cílem svazku udělá ─────────────────────────────
//
// ⛔ NAMĚŘENO 2026-09-23. Brána `coolify-compose-compliance` tvrdila, že Coolify
// `${` ve zdroji svazku odmítá VŽDY (incident 2026-06-30). Tak se Coolify choval
// jen mezi v4.0.0-beta.441 (PR coollabsio/coolify#6891) a beta.443 (#7144, issue
// #7127). Dnešní validace (`rawComposeBindMkdirCommand` + `validateShellSafePath`
// v bootstrap/helpers/shared.php) je přenesená níž DOSLOVA. Produkce ji potvrzuje:
// Coolify 4.3.16, local-ingest dvou instancí s `${INGEST_DOCS_MOUNT:-…}` — 3×
// „finished" u každé. Přísnější brána tlačila vývoj k DOSLOVNÝM cestám
// (commit 2a1630df0: „interpolaci zakazuje brána"), a ty sdílí každá instance
// na stroji — viz `hostitelska-cesta-bez-identity-se-sdili`.

const NEBEZPECNE_ZNAKY: ReadonlyArray<[string, string]> = [
  ["`", "backtick (command substitution)"],
  ["$(", "command substitution"],
  ["${", "variable substitution with potential command injection"],
  ["|", "pipe operator"],
  ["&", "background/AND operator"],
  [";", "command separator"],
  ["\n", "newline (command separator)"],
  ["\r", "carriage return"],
  ["\t", "tab (token separator)"],
  [">", "output redirection"],
  ["<", "input redirection"],
];

/** Coolify `validateShellSafePath` — důvod odmítnutí, nebo `null`. */
function coolifyNebezpecnyZnak(vstup: string, kontext: string): string | null {
  for (const [znak, popis] of NEBEZPECNE_ZNAKY) {
    if (vstup.includes(znak)) return `Invalid ${kontext}: contains forbidden character '${znak}' (${popis})`;
  }
  return null;
}

/** Coolify `rawComposeBindMkdirCommand` — proč Coolify zdroj svazku ODMÍTNE, nebo `null`. */
export function coolifyOdmitneZdroj(zdroj: string): string | null {
  // Coolify: preg_match('/[\x00-\x1F\x7F]/') — řídicí znak podle kódu (regex s nimi lint zakazuje).
  if ([...zdroj].some((z) => z.charCodeAt(0) <= 0x1f || z.charCodeAt(0) === 0x7f)) {
    return "Invalid volume source: contains a control character.";
  }
  const s = zdroj.trim();
  if (s === "") return "Invalid volume source: path is empty.";
  if (/^\$\{[a-zA-Z_][a-zA-Z0-9_]*\}$/.test(s)) return null;
  if (/^\$\{[a-zA-Z_][a-zA-Z0-9_]*\}(?:\/[\w.-]+)*\/?$/.test(s)) return null;
  const vychozi = /^\$\{([a-zA-Z_][a-zA-Z0-9_]*):-(.*)\}$/.exec(s);
  if (vychozi) return coolifyNebezpecnyZnak(vychozi[2], "volume source");
  return coolifyNebezpecnyZnak(s, "volume source");
}

/** Coolify validuje i CÍL (`validateShellSafePath(target, 'volume target')`) — interpolace tam neprojde. */
export function coolifyOdmitneCil(cil: string): string | null {
  return coolifyNebezpecnyZnak(cil, "volume target");
}

/**
 * Tvary, které Coolify PŘIJME, ale nedělají, co vypadají (domácí pravidlo, naměřené):
 *   - `${VAR:-výchozí}` — parser Coolify dosadí VÝCHOZÍ hodnotu bez ohledu na VAR
 *     (bootstrap/helpers/parsers.php: `$source = $defaultValue`). Proměnná je ozdoba.
 *   - `${VAR}` (i `${VAR}/přípona`, i dlouhý tvar `source: ${VAR}`) — ⛔ NAMĚŘENO
 *     2026-09-28 živě v Coolify 4.3.16 (talos): bind vs. pojmenovaný svazek se
 *     rozhoduje JEN podle TEXTU zdroje, `sourceIsLocal()` v bootstrap/helpers/
 *     shared.php:1692 — lokální je jen zdroj začínající `/`, `./`, `~`, `..`.
 *     Hodnotu VAR z env aplikace Coolify předtím NEDOSADÍ, takže `${VAR}` skončí jako
 *     pojmenovaný svazek `<uuid>_<slug>` i s nastavenou absolutní cestou (Edge aisha,
 *     dva forky: `_static` prázdný). Premisa „`${VAR}` s celou cestou = hostitelská
 *     cesta per instance" (36f8ef51f) platila jen pro upstream HEAD Coolify
 *     (`rawComposeBindMkdirCommand`), ne pro 4.3.16 ani 4.3.23.
 * Pravidlo: data sdílená službami = POJMENOVANÝ svazek v TÉMŽE compose (jméno z
 * identity: `${APP_NAME_PREFIX:?}_…` v top-level `volumes:`); mezi aplikacemi se
 * data předávají po síti, ne hostitelskou cestou.
 */
export function pastNaPromennou(zdroj: string): string | null {
  const s = zdroj.trim();
  if (/^\$\{[a-zA-Z_][a-zA-Z0-9_]*:?-[^}]*\}/.test(s)) {
    return "`${VAR:-výchozí}` — Coolify dosadí vždy výchozí hodnotu a VAR ignoruje; data = pojmenovaný svazek v témže compose";
  }
  if (s.startsWith("${")) {
    return "`${VAR}` ve zdroji — Coolify 4.3.16 z něj udělá pojmenovaný svazek `<uuid>_<slug>` bez ohledu na hodnotu (sourceIsLocal jen `/ ./ ~ ..`); hostitelská cesta ani sdílení s jinou aplikací nefunguje — data = pojmenovaný svazek v témže compose";
  }
  return null;
}

/** Všechny zdroje svazků všech služeb jednoho compose souboru. */
export function zdrojeSvazku(soubor: string, obsah: string): ZdrojSvazku[] {
  let j: { services?: Record<string, { volumes?: unknown }> } | null;
  try {
    j = parse(obsah, { merge: true });
  } catch (e) {
    throw new Error(`${soubor}: compose nejde rozparsovat — měřidlo zdrojů svazků nic neměřilo (${(e as Error).message.split("\n")[0]})`);
  }
  const vysledek: ZdrojSvazku[] = [];
  for (const [sluzba, s] of Object.entries(j?.services ?? {})) {
    const svazky = s?.volumes;
    if (!Array.isArray(svazky)) continue;
    for (const polozka of svazky) {
      if (typeof polozka === "string") {
        const dvojice = rozdelKratkyTvar(polozka);
        if (dvojice) {
          // `cíl[:režim]` — režim (`ro`, `rw`, `z` …) odřízne stejné dělení mimo `${…}`.
          const cil = rozdelKratkyTvar(dvojice.cil)?.zdroj ?? dvojice.cil;
          vysledek.push({ sluzba, zdroj: dvojice.zdroj, cil, tvar: "kratky" });
        }
      } else if (polozka && typeof polozka === "object") {
        const { source: zdroj, target: cil, type: typ } = polozka as { source?: unknown; target?: unknown; type?: unknown };
        if (typeof zdroj === "string") {
          vysledek.push({
            sluzba,
            zdroj,
            cil: typeof cil === "string" ? cil : undefined,
            tvar: "dlouhy",
            typ: typeof typ === "string" ? typ : undefined,
          });
        }
      }
    }
  }
  return vysledek;
}
