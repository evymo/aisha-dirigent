/**
 * Vzorkování automatického hodnocení odpovědí chatu (SELF_IMPROVEMENT_LOOP.md K-17, D8).
 * Samostatný čistý modul: čte ho config.ts, takže nesmí importovat nic, co importuje config.
 */

/**
 * Vzorkovací podíl z přepínače instance. Fail-closed: chybějící, nečíselná nebo mimo
 * [0, 1] hodnota = 0 (nehodnotí se nic) — neznámý přepínač nikdy nezapne útratu.
 */
export function parseEvalSampleRate(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return 0;
  return n;
}

/** Hodit si kostkou: hodnotit tuto odpověď? rate 0 = nikdy, 1 = vždy. */
export function shouldSampleEval(rate: number, random: () => number = Math.random): boolean {
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  return random() < rate;
}
