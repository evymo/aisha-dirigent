import crypto from 'node:crypto';
import webPush from 'web-push';
import { config } from '../config.js';
import { zkontrolujPayloadBezTajemstvi } from './bez-tajemstvi.js';

export interface WebPushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface StavVapid {
  ok: boolean;
  duvod?: string;
}

/**
 * Ověří, že nastavené VAPID klíče jsou PLATNÝ PÁR — ne jen že nejsou prázdné.
 *
 * ⛔ PROČ NESTAČÍ „není prázdné": půlka páru projde. Prohlížeč se přihlásí
 * k odběru veřejným klíčem z plochy, server podepíše jiným soukromým a
 * poskytovatel odmítne s 403 — u nás se nic nezapíše a oznámení prostě
 * nedojde. Tohle je ta tichá porucha, kterou měření „proměnná je nastavená"
 * nikdy neodhalí.
 *
 * Kontroluje se TVAR podle RFC 8292 (veřejný = nekomprimovaný bod 0x04||X||Y,
 * 65 B; soukromý = skalár d, 32 B) a hlavně SOUNÁLEŽITOST: ze soukromého se
 * odvodí veřejný bod a musí vyjít týž. Subjekt musí být `mailto:` nebo https
 * URL — podle něj se poskytovatel ozve, když odesílatel zlobí.
 */
export function overVapid(verejny: string, soukromy: string, subjekt: string): StavVapid {
  if (!verejny || !soukromy) return { ok: false, duvod: 'VAPID klíče nejsou nastavené' };

  let bod: Buffer;
  let skalar: Buffer;
  try {
    bod = Buffer.from(verejny, 'base64url');
    skalar = Buffer.from(soukromy, 'base64url');
  } catch {
    return { ok: false, duvod: 'VAPID klíče nejsou base64url' };
  }
  if (bod.length !== 65 || bod[0] !== 0x04) {
    return { ok: false, duvod: `veřejný klíč má být 65 B začínající 0x04 (má ${bod.length} B)` };
  }
  if (skalar.length !== 32) {
    return { ok: false, duvod: `soukromý klíč má být 32 B (má ${skalar.length} B)` };
  }

  let odvozeny: Buffer;
  try {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(skalar);
    odvozeny = ecdh.getPublicKey();
  } catch {
    return { ok: false, duvod: 'soukromý klíč není platný skalár křivky P-256' };
  }
  if (odvozeny.length !== bod.length || !crypto.timingSafeEqual(odvozeny, bod)) {
    return { ok: false, duvod: 'klíče k sobě NEPATŘÍ — veřejný neodpovídá soukromému' };
  }
  if (!/^(mailto:|https:\/\/)/.test(subjekt)) {
    return { ok: false, duvod: 'subjekt musí být mailto: nebo https URL (RFC 8292)' };
  }
  return { ok: true };
}

let zapamatovany: StavVapid | null = null;

/**
 * Verdikt o nastavení web pushe. Spočítá se jednou a pamatuje se.
 *
 * ⛔ ZÁMĚRNĚ NELOGUJE: běhový kód služby nesmí psát přes `console.*` (brána
 * `owasp-discovery`, A09) a knihovna nemá logger služby po ruce. Důvod se proto
 * VRACÍ a vypíše ho `server.ts` při startu přes `app.log` — operátor se to dozví
 * hned při nasazení, ne až první nedoručenou zprávou.
 */
export function stavWebPush(): StavVapid {
  if (zapamatovany === null) {
    zapamatovany = overVapid(config.vapidPublicKey, config.vapidPrivateKey, config.vapidSubject);
  }
  return zapamatovany;
}

export function isWebPushConfigured(): boolean {
  return stavWebPush().ok;
}

/** Jen pro testy — zahodí zapamatovaný verdikt. */
export function zapomenStavVapid(): void {
  zapamatovany = null;
}

export async function sendWebPushNotifications(
  subscriptions: WebPushSubscriptionRow[],
  payload: { title: string; body: string; link?: string; tag?: string; data?: Record<string, string> },
): Promise<{ sent: number; failed: number; errors: string[]; invalidEndpoints: string[] }> {
  if (!isWebPushConfigured()) {
    return { sent: 0, failed: subscriptions.length, errors: ['web_push_not_configured'], invalidEndpoints: [] };
  }

  // ⛔ Táž hranice jako u FCM — jen jiný poskytovatel.
  zkontrolujPayloadBezTajemstvi(payload.data, 'web push');

  webPush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);

  const jsonPayload = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  const invalidEndpoints: string[] = [];

  for (const sub of subscriptions) {
    try {
      await webPush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        jsonPayload,
        { timeout: 10_000 },
      );
      sent++;
    } catch (err) {
      failed++;
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        invalidEndpoints.push(sub.endpoint);
      }
      if (errors.length < 20) {
        errors.push(`web_push_error:${statusCode ?? 'unknown'}:${sub.endpoint.slice(0, 60)}`);
      }
    }
  }

  return { sent, failed, errors, invalidEndpoints };
}
