/**
 * BRÁNA: push oznámení nesmí nést jednorázový kód.
 *
 * Zadání majitele 2026-09-20: „kód ne, ten pošleme přes telegram, jen upozornění
 * v pushce." Runtime stráž stojí v `lib/bez-tajemstvi.ts` a volá se u OBOU
 * východů k poskytovateli. Tahle brána hlídá, aby ty východy zůstaly dva —
 * runtime kontrola je k ničemu, když někdo příště zavolá FCM odjinud.
 *
 * ⭐ UNIVERZUM SE HLEDÁ, NEPÍŠE: seznam východů se odvozuje ze zdrojů
 * (kdo volá FCM endpoint nebo web-push `sendNotification`), ne z ručního
 * seznamu. Nový soubor, který začne posílat push, se tím objeví sám.
 *
 * Naměřeno 2026-09-21 při zavádění: `deliverPush` NENÍ jediné hrdlo —
 * `reminder-notifications.ts` i `questionnaire-reminders.ts` volají
 * `sendFcmMessage` přímo. Stráž proto stojí až v knihovnách u poskytovatele.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SVC = join(process.cwd(), 'services/svc-push/src');
const STRAZ = 'zkontrolujPayloadBezTajemstvi';

/** Rekurzivně všechny .ts mimo testy. */
function zdroje(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e !== 'tests') out.push(...zdroje(p));
    } else if (e.endsWith('.ts') && !e.endsWith('.test.ts')) {
      out.push(p);
    }
  }
  return out;
}

const soubory = zdroje(SVC).map((p) => ({ p, obsah: readFileSync(p, 'utf8') }));

describe('push nenese jednorázový kód', () => {
  test('stráž existuje a je volaná u KAŽDÉHO východu k poskytovateli', () => {
    // Východ = soubor, který se skutečně dotýká poskytovatele: FCM HTTP endpoint
    // nebo web-push `sendNotification`. Odvozeno, ne vyjmenováno.
    const vychody = soubory.filter(
      ({ obsah }) =>
        obsah.includes('fcm.googleapis.com') || /webPush\s*\.\s*sendNotification/.test(obsah),
    );

    expect(vychody.length, 'žádný východ k poskytovateli nenalezen — brána měří prázdnou množinu').toBeGreaterThan(0);

    // ⛔ HLEDÁ SE VOLÁNÍ, NE IMPORT. První verze téhle brány hledala jen jméno
    // stráže kdekoli v souboru — a mutace (smazání volání, import ponechán)
    // prošla. Brána tehdy měřila „soubor o stráži ví", ne „soubor ji volá".
    const volaStraz = (obsah: string): boolean =>
      obsah
        .split('\n')
        .filter((r) => !/^\s*import\b/.test(r))
        .some((r) => new RegExp(`\\b${STRAZ}\\s*\\(`).test(r));

    const bezStraze = vychody.filter(({ obsah }) => !volaStraz(obsah)).map(({ p }) => p.replace(process.cwd() + '/', ''));

    expect(
      bezStraze,
      `Tyhle soubory posílají push, ale nevolají ${STRAZ}():\n  ${bezStraze.join('\n  ')}\n\n` +
        'Push payload prochází cizí infrastrukturou, zapisuje se do protokolu oznámení\n' +
        'a čte ho uzamčená obrazovka. Jednorázový kód patří do openclaw_notifications\n' +
        '(Telegram), push nese jen upozornění — zadání majitele 2026-09-20.',
    ).toEqual([]);
  });

  test('stráž sama zná jména, která tajemství znamenají', () => {
    const straz = soubory.find(({ p }) => p.endsWith('lib/bez-tajemstvi.ts'));
    expect(straz, 'lib/bez-tajemstvi.ts chybí — stráž byla smazána').toBeTruthy();
    for (const jmeno of ['otp', 'pin', 'password', 'secret', 'token']) {
      expect(straz!.obsah, `stráž přestala hlídat "${jmeno}"`).toContain(`'${jmeno}'`);
    }
  });
});
