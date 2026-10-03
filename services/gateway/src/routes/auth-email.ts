/**
 * Auth email delivery — branded email + push OTP dual-channel.
 *
 * In KC world: KC handles standard auth emails via Freemarker templates.
 * This route preserves the dual-channel delivery (Resend email + push OTP)
 * for magiclink/reauthentication flows triggered by the app.
 *
 * Internal only — called by KC event listeners or app backend.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';

const POSTGREST = config.postgrestUrl;
const SERVICE_TOKEN = (process.env.POSTGREST_SERVICE_TOKEN ?? '');
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? '';

// ── Types ──

type Langs = 'cs' | 'de' | 'en' | 'fr' | 'ru' | 'th';

interface AuthEmailRequest {
  action_type: string; // magiclink, recovery, reauthentication, signup, invite, email_change
  brand_name?: string;
  email: string;
  lang?: string;
  otp_code?: string;
  redirect_url?: string;
  support_email?: string;
  token_hash?: string;
  user_id: string;
}

// ── PostgREST RPC ──

async function rpc<T = unknown>(fn: string, params: Record<string, unknown>): Promise<T | null> {
  const resp = await fetch(`${POSTGREST}/rpc/${fn}`, {
    body: JSON.stringify(params),
    headers: {
      'Authorization': `Bearer ${SERVICE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) return null;
  return resp.json() as Promise<T>;
}

// ── Localised strings ──

const BRAND_COLOR = '#1ead89';
const BRAND_BG = '#f0f8f6';

const PUSH_OTP_ACTION_TYPES = new Set(['magiclink', 'magic_link', 'reauthentication']);
const VALID_LANGS = new Set(['cs', 'de', 'en', 'fr', 'ru', 'th']);

function resolveLang(raw?: string): Langs {
  return (raw && VALID_LANGS.has(raw) ? raw : 'en') as Langs;
}

const L = {
  buttonLabel: {
    email_change: { cs: 'Potvrdit email', de: 'E-Mail bestätigen', en: 'Confirm email', fr: 'Confirmer email', ru: 'Подтвердить', th: 'ยืนยัน' },
    invite: { cs: 'Přijmout pozvání', de: 'Einladung annehmen', en: 'Accept invitation', fr: 'Accepter', ru: 'Принять', th: 'ยอมรับ' },
    magiclink: { cs: 'Přihlásit se', de: 'Anmelden', en: 'Sign in', fr: 'Se connecter', ru: 'Войти', th: 'เข้าสู่ระบบ' },
    recovery: { cs: 'Obnovit heslo', de: 'Passwort zurücksetzen', en: 'Reset password', fr: 'Réinitialiser', ru: 'Сбросить', th: 'รีเซ็ต' },
    signup: { cs: 'Potvrdit', de: 'Bestätigen', en: 'Confirm', fr: 'Confirmer', ru: 'Подтвердить', th: 'ยืนยัน' },
  } as Record<string, Record<Langs, string>>,
  emailBody: {
    email_change: { cs: 'Potvrďte změnu emailové adresy kliknutím na tlačítko níže.', de: 'Bestätigen Sie die Änderung Ihrer E-Mail-Adresse.', en: 'Confirm your email address change by clicking the button below.', fr: 'Confirmez le changement de votre adresse email.', ru: 'Подтвердите изменение email, нажав кнопку ниже.', th: 'ยืนยันการเปลี่ยนแปลงอีเมลโดยคลิกปุ่มด้านล่าง' },
    invite: { cs: 'Byli jste pozváni do platformy. Klikněte na tlačítko níže.', de: 'Sie wurden eingeladen. Klicken Sie auf den Button.', en: "You've been invited. Click the button below to accept.", fr: 'Vous avez été invité. Cliquez sur le bouton.', ru: 'Вас пригласили. Нажмите кнопку для принятия.', th: 'คุณได้รับเชิญ คลิกปุ่มด้านล่าง' },
    magiclink: { cs: 'Klikněte na tlačítko níže nebo zadejte jednorázový kód.', de: 'Klicken Sie auf den Button oder geben Sie den Einmalcode ein.', en: 'Click the button below or enter the one-time code to sign in.', fr: 'Cliquez sur le bouton ou entrez le code à usage unique.', ru: 'Нажмите кнопку или введите одноразовый код.', th: 'คลิกปุ่มหรือกรอกรหัสแบบใช้ครั้งเดียว' },
    reauthentication: { cs: 'Z bezpečnostních důvodů prosím ověřte svou totožnost.', de: 'Bitte überprüfen Sie Ihre Identität.', en: 'For security reasons, please verify your identity.', fr: 'Veuillez vérifier votre identité.', ru: 'Подтвердите свою личность.', th: 'โปรดยืนยันตัวตนของคุณ' },
    recovery: { cs: 'Klikněte na tlačítko níže pro obnovení hesla.', de: 'Klicken Sie auf den Button zum Zurücksetzen.', en: 'Click the button below to reset your password.', fr: 'Cliquez sur le bouton pour réinitialiser.', ru: 'Нажмите кнопку для сброса пароля.', th: 'คลิกปุ่มเพื่อรีเซ็ตรหัสผ่าน' },
    signup: { cs: 'Klikněte na tlačítko níže pro potvrzení registrace.', de: 'Klicken Sie auf den Button zur Bestätigung.', en: 'Click the button below to confirm your registration.', fr: 'Cliquez sur le bouton pour confirmer.', ru: 'Нажмите кнопку для подтверждения регистрации.', th: 'คลิกปุ่มเพื่อยืนยันการลงทะเบียน' },
  } as Record<string, Record<Langs, string>>,
  emailHeading: {
    email_change: { cs: 'Potvrďte nový email', de: 'Neue E-Mail bestätigen', en: 'Confirm your new email', fr: 'Confirmez votre nouvel email', ru: 'Подтвердите новый email', th: 'ยืนยันอีเมลใหม่' },
    invite: { cs: 'Byli jste pozváni', de: 'Sie wurden eingeladen', en: "You've been invited", fr: 'Vous avez été invité', ru: 'Вас пригласили', th: 'คุณได้รับเชิญ' },
    magiclink: { cs: 'Přihlaste se', de: 'Anmelden', en: 'Sign in', fr: 'Connectez-vous', ru: 'Войдите', th: 'เข้าสู่ระบบ' },
    reauthentication: { cs: 'Ověřte svou totožnost', de: 'Identität überprüfen', en: 'Verify your identity', fr: 'Vérifiez votre identité', ru: 'Подтвердите личность', th: 'ยืนยันตัวตน' },
    recovery: { cs: 'Obnovení hesla', de: 'Passwort zurücksetzen', en: 'Reset your password', fr: 'Réinitialiser le mot de passe', ru: 'Сброс пароля', th: 'รีเซ็ตรหัสผ่าน' },
    signup: { cs: 'Potvrzení registrace', de: 'Registrierung bestätigen', en: 'Confirm your registration', fr: 'Confirmez votre inscription', ru: 'Подтвердите регистрацию', th: 'ยืนยันการลงทะเบียน' },
  } as Record<string, Record<Langs, string>>,
  footer: {
    help: { cs: 'Potřebujete pomoc? Napište nám na', de: 'Brauchen Sie Hilfe? Schreiben Sie an', en: 'Need help? Contact us at', fr: "Besoin d'aide ? Contactez-nous à", ru: 'Нужна помощь? Напишите нам на', th: 'ต้องการความช่วยเหลือ? ติดต่อ' } as Record<Langs, string>,
    ignore: { cs: 'Pokud jste o to nežádali, tento email můžete ignorovat.', de: 'Wenn Sie dies nicht angefordert haben, ignorieren Sie diese E-Mail.', en: "If you didn't request this, you can ignore this email.", fr: "Si vous n'avez pas fait cette demande, ignorez cet email.", ru: 'Если вы не запрашивали это, игнорируйте письмо.', th: 'หากคุณไม่ได้ร้องขอ สามารถละเว้นอีเมลนี้ได้' } as Record<Langs, string>,
  },
  otpExpiry: { cs: 'Tento kód brzy vyprší.', de: 'Dieser Code läuft bald ab.', en: 'This code expires shortly.', fr: 'Ce code expirera bientôt.', ru: 'Этот код скоро истечет.', th: 'รหัสนี้จะหมดอายุเร็วๆนี้' } as Record<Langs, string>,
  otpLabel: { cs: 'Jednorázový kód', de: 'Einmalcode', en: 'One-time code', fr: 'Code à usage unique', ru: 'Одноразовый код', th: 'รหัสแบบใช้ครั้งเดียว' } as Record<Langs, string>,
  pushTitle: { cs: 'Platform — Autorizační kód', de: 'Platform — Autorisierungscode', en: 'Platform — Authorization Code', fr: "Platform — Code d'autorisation", ru: 'Platform — Код авторизации', th: 'Platform — รหัสยืนยัน' } as Record<Langs, string>,
  subjects: {
    email_change: { cs: 'Potvrďte nový email — Platform', de: 'Neue E-Mail bestätigen — Platform', en: 'Confirm your new email — Platform', fr: 'Confirmez votre nouvel email — Platform', ru: 'Подтвердите новый email — Platform', th: 'ยืนยันอีเมลใหม่ — Platform' },
    invite: { cs: 'Byli jste pozváni — Platform', de: 'Sie wurden eingeladen — Platform', en: "You've been invited — Platform", fr: 'Vous avez été invité — Platform', ru: 'Вас пригласили — Platform', th: 'คุณได้รับเชิญ — Platform' },
    magiclink: { cs: 'Váš přihlašovací kód — Platform', de: 'Ihr Anmeldecode — Platform', en: 'Your sign-in code — Platform', fr: 'Votre code de connexion — Platform', ru: 'Ваш код входа — Platform', th: 'รหัสเข้าสู่ระบบ — Platform' },
    reauthentication: { cs: 'Ověřte svou totožnost — Platform', de: 'Identität überprüfen — Platform', en: 'Verify your identity — Platform', fr: 'Vérifiez votre identité — Platform', ru: 'Подтвердите личность — Platform', th: 'ยืนยันตัวตน — Platform' },
    recovery: { cs: 'Obnovení hesla — Platform', de: 'Passwort zurücksetzen — Platform', en: 'Reset your password — Platform', fr: 'Réinitialiser votre mot de passe — Platform', ru: 'Сброс пароля — Platform', th: 'รีเซ็ตรหัสผ่าน — Platform' },
    signup: { cs: 'Potvrzení registrace — Platform', de: 'Registrierung bestätigen — Platform', en: 'Confirm your registration — Platform', fr: 'Confirmez votre inscription — Platform', ru: 'Подтвердите регистрацию — Platform', th: 'ยืนยันการลงทะเบียน — Platform' },
  } as Record<string, Record<Langs, string>>,
};

function t<T extends Record<Langs, string>>(dict: T, l: Langs): string {
  return dict[l] ?? dict.en;
}

// ── Email HTML builder ──

function buildEmailHtml(req: AuthEmailRequest, l: Langs): string {
  const actionKey = req.action_type === 'magic_link' ? 'magiclink' : req.action_type;
  const brandName = req.brand_name ?? 'Platform';
  // Adresa ani doména se NEDOSAZUJÍ. `support@platform.com` je schránka na doméně,
  // kterou tohle nasazení nevlastní — příjemce by psal cizímu člověku a nikdo by
  // se to nedozvěděl. Když volající adresu nepošle, řádek s podporou se nevykreslí.
  const supportEmail = req.support_email?.trim();
  // Totéž pro logo: bez STORAGE_PUBLIC_URL mířil <img> na cizí CDN. Bez něj se
  // v hlavičce vykreslí jméno značky textem — e-mail zůstane celý, jen bez obrázku.
  const storageBase = process.env.STORAGE_PUBLIC_URL?.trim();
  const logoUrl = storageBase ? `${storageBase}/email-assets/branding/logo.png` : null;

  const heading = t(L.emailHeading[actionKey] ?? L.emailHeading.magiclink, l);
  const body = t(L.emailBody[actionKey] ?? L.emailBody.magiclink, l);

  const showButton = !['reauthentication'].includes(actionKey) && req.redirect_url;
  const buttonLabel = showButton ? t(L.buttonLabel[actionKey] ?? L.buttonLabel.magiclink, l) : '';
  const showOtp = Boolean(req.otp_code);

  return `<!doctype html>
<html>
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background-color:#f6f7f9;font-family:system-ui,-apple-system,sans-serif;color:#111827;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f6f7f9;padding:40px 16px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;background:#fff;border-radius:16px;border:1px solid #e5e7eb;">
<tr><td style="padding:24px 32px;background:${BRAND_BG};border-bottom:1px solid #e5e7eb;">
  ${logoUrl
    ? `<img src="${logoUrl}" alt="${brandName}" height="32" style="display:block;border:0;"/>`
    : `<span style="display:block;font-size:18px;font-weight:700;color:#0f172a;">${brandName}</span>`}
</td></tr>
<tr><td style="padding:32px;">
  <h1 style="margin:0 0 12px;font-size:24px;color:#0f172a;">${heading}</h1>
  <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151;">${body}</p>
  ${showButton ? `<div style="text-align:center;margin:24px 0;">
    <a href="${req.redirect_url}" style="display:inline-block;background:${BRAND_COLOR};color:#fff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;font-size:15px;">${buttonLabel}</a>
  </div>` : ''}
  ${showOtp ? `<div style="border:1px dashed #c7e6dd;border-radius:12px;padding:20px;background:#f7fbfa;margin:24px 0;">
    <p style="margin:0 0 8px;font-size:14px;color:#0f172a;font-weight:600;">${t(L.otpLabel, l)}</p>
    <div style="font-size:32px;letter-spacing:8px;font-weight:700;color:#0f172a;text-align:center;padding:12px 0;">${req.otp_code}</div>
    <p style="margin:8px 0 0;font-size:12px;color:#6b7280;text-align:center;">${t(L.otpExpiry, l)}</p>
  </div>` : ''}
  <p style="margin:20px 0 0;font-size:13px;color:#6b7280;">${t(L.footer.ignore, l)}</p>
</td></tr>
<tr><td style="padding:20px 32px;background:#f8fafc;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">
  ${supportEmail ? `<p style="margin:0 0 6px;">${t(L.footer.help, l)} ${supportEmail}.</p>` : ''}
  <p style="margin:0;">${brandName}</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

// ── Resend email delivery ──

async function sendViaResend(to: string, subject: string, html: string): Promise<{ error?: string; ok: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { error: 'RESEND_API_KEY not configured', ok: false };

  // Odesílací doména se NEDOSAZUJE. `platform.com` je cizí doména: SPF/DKIM pro
  // ni tomuhle nasazení nikdy nevyjdou, takže by Resend buď odmítl, nebo by pošta
  // tiše padala do spamu — výpadek bez souvislosti s příčinou. Chybějící hodnota
  // se proto hlásí týmž kanálem jako chybějící klíč o pár řádků výš.
  const fromDomain = process.env.RESEND_FROM_DOMAIN?.trim();
  if (!fromDomain) return { error: 'RESEND_FROM_DOMAIN not configured', ok: false };
  // Zobrazované jméno je dekorace, ne adresa — bez něj je `noreply@<doména>`
  // platná hlavička From. Literál by tu vydával cizí značku za odesílatele.
  const fromName = process.env.RESEND_FROM_NAME?.trim();
  const from = fromName ? `${fromName} <noreply@${fromDomain}>` : `noreply@${fromDomain}`;

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      body: JSON.stringify({ from, html, subject, to: [to] }),
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      return { error: `Resend ${resp.status}: ${errBody}`, ok: false };
    }
    return { ok: true };
  } catch (err) {
    return { error: `Resend error: ${(err as Error).message}`, ok: false };
  }
}

// ── Push notification delivery ──

async function sendOtpPush(userId: string, otpCode: string, l: Langs): Promise<{ error?: string; sent: boolean }> {
  const pushUrl = process.env.PUSH_SERVICE_URL ?? 'http://svc-push:3012';

  try {
    const resp = await fetch(`${pushUrl}/send`, {
      body: JSON.stringify({
        body: otpCode,
        data: { otp_code: otpCode, type: 'auth_otp' },
        priority: 'high',
        send_mobile: true,
        send_web: true,
        title: t(L.pushTitle, l),
        user_id: userId,
      }),
      headers: { 'Authorization': `Bearer ${INTERNAL_API_KEY}`, 'Content-Type': 'application/json' },
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      return { error: `Push ${resp.status}: ${errBody}`, sent: false };
    }

    const result = await resp.json() as { mobile_sent?: number; web_sent?: number };
    return { sent: ((result.mobile_sent ?? 0) + (result.web_sent ?? 0)) > 0 };
  } catch (err) {
    return { error: `Push error: ${(err as Error).message}`, sent: false };
  }
}

// ── Audit log ──

async function logOtpPushDelivery(userId: string, actionType: string, pushResult: { error?: string; sent: boolean }): Promise<void> {
  try {
    await rpc('edge_mobile_notifications', {
      p_action: 'insert_notification_log',
      p_payload: {
        created_at: new Date().toISOString(),
        data: { action_type: actionType, channel: 'push', delivery_type: 'auth_otp', push_error: pushResult.error ?? null, push_sent: pushResult.sent },
        devices_failed: pushResult.sent ? 0 : 1,
        devices_sent: pushResult.sent ? 1 : 0,
        error_message: pushResult.error ?? null,
        notification_type: 'auth_otp',
        recipients_count: 1,
        title: 'auth_otp',
      },
    });
  } catch {
    // Fire-and-forget
  }
}

// ── Route ──

export const authEmailRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {

  app.post<{ Body: AuthEmailRequest }>('/auth-send-email', async (request, reply) => {
    // Auth: internal API key
    const authHeader = request.headers.authorization ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!INTERNAL_API_KEY || token !== INTERNAL_API_KEY) {
      return reply.code(403).send({ error: 'Service role required' });
    }

    const { action_type, email, lang: rawLang, otp_code, user_id } = request.body;
    if (!email || !action_type || !user_id) {
      return reply.code(400).send({ error: 'email, action_type, and user_id are required' });
    }

    const l = resolveLang(rawLang);
    const actionKey = action_type === 'magic_link' ? 'magiclink' : action_type;

    // 1. Build and send email
    const subject = t(L.subjects[actionKey] ?? L.subjects.magiclink, l);
    const html = buildEmailHtml(request.body, l);
    const emailResult = await sendViaResend(email, subject, html);

    if (!emailResult.ok) {
      request.log.warn({ error: emailResult.error }, 'Email delivery failed');
    }

    // 2. Send push OTP (dual-channel delivery)
    let pushResult: { error?: string; sent: boolean } = { sent: false };
    if (PUSH_OTP_ACTION_TYPES.has(action_type) && otp_code) {
      pushResult = await sendOtpPush(user_id, otp_code, l);
      if (pushResult.error) {
        request.log.warn({ error: pushResult.error }, 'Push OTP delivery failed');
      }
      // Audit log (fire-and-forget)
      void logOtpPushDelivery(user_id, actionKey, pushResult);
    }

    return reply.send({
      email_sent: emailResult.ok,
      push_sent: pushResult.sent,
      success: emailResult.ok || pushResult.sent,
    });
  });
};
