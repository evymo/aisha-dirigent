/**
 * Roura do čtenáře, který skončí PŘEDČASNĚ — jeden domov pravidla.
 *
 * Pod `set -o pipefail` vrátí roura status posledního NENULOVÉHO článku. Čtenář,
 * který skončí dřív, než zapisovatel dopíše (`grep -q` při první shodě, `head`,
 * `sed … q`, `awk … exit`), zapisovateli zavře rouru; ten zemře na SIGPIPE (141,
 * se zděděně ignorovaným SIGPIPE 1 z EPIPE) a roura hlásí selhání i tam, kde
 * čtenář NAŠEL, co hledal. `x=$(cmd | head -1)` pod `set -e` tak může skript
 * náhodně ukončit; `printf … | grep -q x || echo chybí` vypíše „chybí" u
 * nalezeného. Časově závislé: bez zátěže skoro nikdy, pod zátěží ano.
 *
 * ⛔ NAMĚŘENO 2026-09-19 a znovu 2026-09-23 (orákulum aliasů compose): brána
 * `jmeno-na-sdilene-siti-nese-identitu` padala v CI na pokaždé jiném „osiřelém"
 * jméně. Oprava orákula ležela na větvi od 19. 9. nesloučená a 23. 9. vznikla
 * znovu — proto pravidlo žije tady, sdílené, a ne jako třetí kopie vzorů.
 *
 * Náprava: herestring (`grep -q … <<< "$x"`), `sed -n '1,Np'` místo `head`,
 * nebo čtenář, který dočte vstup.
 */

/** Čtenáři, kteří skončí dřív, než zapisovatel dopíše. */
export const PREDCASNI_CTENARI: ReadonlyArray<{ jmeno: string; vzor: RegExp }> = [
  { jmeno: "grep -q/-m", vzor: /\|\s*grep\b[^|\n]*\s(-[A-Za-z]*[qm][A-Za-z0-9]*|--quiet|--max-count)\b/ },
  { jmeno: "head", vzor: /\|\s*head\b/ },
  { jmeno: "sed … q", vzor: /\|\s*sed\b[^|\n]*\bq\b/ },
  { jmeno: "awk … exit", vzor: /\|\s*awk\b[^|\n]*\bexit\b/ },
];

/**
 * Shellový zdroj bez komentářových řádků, s rourami a pokračováními slepenými
 * na jeden řádek — jinak roura rozdělená přes řádek (`cmd |⏎ grep -q`) projde.
 */
export function slepRoury(zdroj: string): string {
  return zdroj
    .split("\n")
    .filter((r) => !r.trim().startsWith("#"))
    .join("\n")
    .replace(/\\\n/g, " ")
    .replace(/\|[ \t]*\n/g, "| ");
}

/** Běží zdroj pod `pipefail` (v KÓDU — zmínka v komentáři ho nezapíná)? */
export function beziPodPipefail(zdroj: string): boolean {
  return zdroj.split("\n").some((r) => !r.trimStart().startsWith("#") && /\bpipefail\b/.test(r));
}

/** Řádky (slepené) s rourou do předčasného čtenáře, s druhem čtenáře. */
export function predcasniCtenari(zdroj: string): Array<{ druh: string; radek: string }> {
  const ven: Array<{ druh: string; radek: string }> = [];
  for (const radek of slepRoury(zdroj).split("\n")) {
    const c = PREDCASNI_CTENARI.find((p) => p.vzor.test(radek));
    if (c) ven.push({ druh: c.jmeno, radek: radek.trim().slice(0, 140) });
  }
  return ven;
}
