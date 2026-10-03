/**
 * Příští spuštění podle cronu o pěti polích (minuta hodina den-v-měsíci měsíc den-v-týdnu).
 *
 * Vlastní implementace místo závislosti: rozvrhy pluginů používají jen základní
 * syntaxi (`*`, `*∕n`, `a-b`, `a-b∕n`, seznamy `a,b`) a validuje se tu, co DB
 * pustila dál (reconcile_plugin_schedules hlídá jen pět polí). Jména (`MON`,
 * `JAN`) a zkratky (`@daily`) se ODMÍTNOU — host deklaraci nahlásí, nehádá.
 *
 * Čas: pásmo PROCESU (Date v místním čase). Naměřeno 2026-09-16: kontejner
 * svc-plugin-system běží v UTC a TZ nemá deklarované — rozvrh `0 3 * * *` je tedy
 * 03:00 UTC, dokud instance TZ hostu nedeklaruje.
 *
 * Den v měsíci × den v týdnu: když jsou omezené OBA, stačí shoda jednoho (Vixie cron).
 */

type Pole = { hodnoty: Set<number>; omezene: boolean };

const ROZSAHY: Array<[number, number]> = [
  [0, 59], // minuta
  [0, 23], // hodina
  [1, 31], // den v měsíci
  [1, 12], // měsíc
  [0, 7], // den v týdnu (0 i 7 = neděle)
];

export class NeplatnyCron extends Error {
  constructor(cron: string, duvod: string) {
    super(`neplatný cron „${cron}": ${duvod}`);
    this.name = 'NeplatnyCron';
  }
}

function rozparsujPole(text: string, [min, max]: [number, number], cron: string): Pole {
  const hodnoty = new Set<number>();
  for (const cast of text.split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(cast);
    if (!m) throw new NeplatnyCron(cron, `pole „${text}"`);
    const krok = m[4] ? Number(m[4]) : 1;
    if (krok < 1) throw new NeplatnyCron(cron, `krok v „${cast}"`);
    let od = min;
    let doo = max;
    if (m[1] !== '*') {
      od = Number(m[2]);
      doo = m[3] !== undefined ? Number(m[3]) : m[4] ? max : od;
    }
    if (od < min || doo > max || od > doo) throw new NeplatnyCron(cron, `rozsah v „${cast}" mimo ${min}-${max}`);
    for (let v = od; v <= doo; v += krok) hodnoty.add(v);
  }
  return { hodnoty, omezene: text !== '*' };
}

export function rozparsujCron(cron: string): Pole[] {
  const casti = cron.trim().split(/\s+/);
  if (casti.length !== 5) throw new NeplatnyCron(cron, 'musí mít pět polí');
  const pole = casti.map((c, i) => rozparsujPole(c, ROZSAHY[i], cron));
  if (pole[4].hodnoty.has(7)) pole[4].hodnoty.add(0);
  return pole;
}

/** První okamžik PŘÍSNĚ po `od` (zarovnaný na minutu), který cron splňuje. */
export function pristiBeh(cron: string, od: Date): Date {
  const [min, hod, dom, mes, dow] = rozparsujCron(cron);
  const t = new Date(od.getTime());
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() + 1);
  // Strop: čtyři roky minut by stačily i na 29. února; smyčka skáče po dnech/hodinách.
  const konec = od.getTime() + 4 * 366 * 24 * 60 * 60 * 1000;
  while (t.getTime() <= konec) {
    if (!mes.hodnoty.has(t.getMonth() + 1)) {
      t.setMonth(t.getMonth() + 1, 1);
      t.setHours(0, 0, 0, 0);
      continue;
    }
    const denShoda = dom.omezene && dow.omezene
      ? dom.hodnoty.has(t.getDate()) || dow.hodnoty.has(t.getDay())
      : dom.hodnoty.has(t.getDate()) && dow.hodnoty.has(t.getDay());
    if (!denShoda) {
      t.setDate(t.getDate() + 1);
      t.setHours(0, 0, 0, 0);
      continue;
    }
    if (!hod.hodnoty.has(t.getHours())) {
      t.setHours(t.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!min.hodnoty.has(t.getMinutes())) {
      t.setMinutes(t.getMinutes() + 1, 0, 0);
      continue;
    }
    return t;
  }
  throw new NeplatnyCron(cron, 'v příštích čtyřech letech nenastane');
}
