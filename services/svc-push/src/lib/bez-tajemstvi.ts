/**
 * Stráž na hranici: do push oznámení NESMÍ jít jednorázový kód ani tajemství.
 *
 * ZADÁNÍ MAJITELE: „kód ne, ten pošleme přes telegram, jen upozornění v pushce."
 * Push tedy nese POZVÁNKU K AKCI, ne obsah — kód jde jiným kanálem
 * (`openclaw_notifications` → Telegram) a příjemce ho dostane tam.
 *
 * ⛔ PROČ TO NENÍ JEN SLUŠNÉ CHOVÁNÍ: push payload neputuje jen do telefonu.
 *   1. prochází cizí infrastrukturou (FCM Google, web-push Mozilla/Apple) —
 *      tam ho vidí poskytovatel, ne my;
 *   2. `send-push.ts` ho zapisuje do protokolu oznámení jako `payload_data`,
 *      takže kód v pushce = kód uložený v databázi;
 *   3. na uzamčené obrazovce ho přečte kdokoli, kdo se na telefon podívá.
 * Kterýkoli z těch tří bodů sám o sobě stačí, aby kód v pushi neměl co dělat.
 *
 * KDE STRÁŽ STOJÍ: u OBOU východů k poskytovateli (`sendFcmMessage`,
 * `sendWebPushNotifications`), ne v pomocníkovi `deliverPush`. Naměřeno
 * 2026-09-21: `deliverPush` NENÍ jediné hrdlo — `reminder-notifications.ts`
 * a `questionnaire-reminders.ts` volají `sendFcmMessage` přímo. Stráž patří
 * tam, kde data opouštějí systém, ne tam, kudy zrovna teče většina provozu.
 */

export class KodVPushiError extends Error {
  readonly klic: string;
  constructor(klic: string, kde: string) {
    super(
      `push payload nese tajemství v klíči "${klic}" (${kde}). ` +
        'Jednorázový kód patří do jiného kanálu (openclaw_notifications → Telegram); ' +
        'push nese jen upozornění. Zadání majitele 2026-09-20.',
    );
    this.name = 'KodVPushiError';
    this.klic = klic;
  }
}

/**
 * Jména, která ZNAMENAJÍ tajemství — ne jména, která ho jen připomínají.
 *
 * ⛔ Proč výčet a ne vzor `_code$`: `step_code` je identifikátor kroku,
 * `country_code` země, `locale_code` jazyka. Široký vzor by zakázal legitimní
 * data a stráž by se obcházela výjimkami, až by přestala platit. Úzký výčet
 * naopak můžeme rozšířit, kdykoli se objeví nové jméno pro tutéž věc.
 */
const ZAKAZANA_JMENA = new Set([
  'code',
  'kod',
  'otp',
  'pin',
  'passcode',
  'password',
  'heslo',
  'secret',
  'token',
  'verification_code',
  'one_time_code',
  'onetimecode',
  'knock_code',
  'access_code',
  'auth_code',
  'confirmation_code',
  'sms_code',
  'totp',
]);

/** Přípony, u kterých už jméno tajemství nese bez ohledu na předponu. */
const ZAKAZANE_PRIPONY = ['_otp', '_pin', '_password', '_heslo', '_secret', '_token', '_passcode', '_totp'];

function jeZakazany(klic: string): boolean {
  const k = klic.trim().toLowerCase();
  if (ZAKAZANA_JMENA.has(k)) return true;
  return ZAKAZANE_PRIPONY.some((p) => k.endsWith(p));
}

/**
 * Projde payload a VYHODÍ, najde-li klíč, který nese tajemství.
 *
 * Fail closed: raději neodeslané oznámení než odeslaný kód. Volající to nemá
 * odchytávat a pokračovat — je to vada v tom, kdo push skládá, ne provozní stav.
 *
 * @param data  mapa, kterou push nese (FCM `data`, web-push `data`)
 * @param kde   jméno východu kvůli hlášce („FCM", „web push")
 */
export function zkontrolujPayloadBezTajemstvi(data: unknown, kde: string): void {
  if (!data || typeof data !== 'object') return;
  for (const klic of Object.keys(data as Record<string, unknown>)) {
    if (jeZakazany(klic)) throw new KodVPushiError(klic, kde);
  }
}
