import { overRunId } from './svazek-behu.js';

/**
 * Větev, do které běh claude_cli_task pushuje — VŽDY ve jmenném prostoru běhu.
 *
 * ⛔ 2026-10-07 (F3, runner na serveru): jméno větve dřív bral runner od VOLAJÍCÍHO
 * (`agent_runs.source_ref` / `inputs.branch` — zapisuje je kdokoli, kdo smí
 * `fn_spawn_claude_cli_run`) a entrypoint agenta na ni pushoval. `branch: "main"` by tak
 * šel rovnou do výchozí větve. Teď:
 *   - cíl je `aisha/run/<runId>` (runId vydává databáze, ne volající),
 *   - požadované jméno smí být jen POPIS pod ním (`aisha/run/<runId>/<popis>`), nikdy cíl
 *     mimo jmenný prostor; nečitelné jméno = běh se nespustí (fail-closed, ne „opravené“ ticho),
 *   - entrypoint agenta pushuje jen do `refs/heads/aisha/run/…` (druhá stráž v kontejneru).
 * Skutečnou hranici drží forge: token běhu (AGENT_GIT_TOKEN) smí zapisovat jen do tohoto
 * jmenného prostoru (ochrana větví, viz docs/deploy/RUNNER_ZAPNUTI.md) — agent token
 * v kontejneru vidí, takže stráže runneru chrání běžnou cestu, ne zlý úmysl.
 */
export const JMENNY_PROSTOR_VETVI_BEHU = 'aisha/run/';

/** Segment jména větve, který git přijme a nic neschová (`..`, `.lock`, `@{`, mezery, `~^:?*[\`). */
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const MAX_POPIS = 120;

function platnyPopis(popis: string): boolean {
  if (popis.length === 0 || popis.length > MAX_POPIS) return false;
  return popis
    .split('/')
    .every((s) => SEGMENT.test(s) && !s.includes('..') && !s.endsWith('.') && !s.endsWith('.lock'));
}

/** `aisha/run/<runId>[/<popis>]` — popis z požadovaného jména volajícího (volitelný). */
export function vetevBehu(runId: string, pozadovana?: string | null): string {
  const zaklad = `${JMENNY_PROSTOR_VETVI_BEHU}${overRunId(runId)}`;
  const p = (pozadovana ?? '').trim();
  if (!p || p === zaklad) return zaklad;
  // Volající, který už jmenný prostor tohoto běhu zná, ho nedostane dvakrát.
  const popis = p.startsWith(`${zaklad}/`) ? p.slice(zaklad.length + 1) : p;
  if (!platnyPopis(popis)) {
    throw new Error(
      `požadované jméno větve běhu není čitelné jako popis pod ${zaklad}/ (segmenty [A-Za-z0-9._-], bez „..“, „.lock“) — běh se nespustí`,
    );
  }
  return `${zaklad}/${popis}`;
}
