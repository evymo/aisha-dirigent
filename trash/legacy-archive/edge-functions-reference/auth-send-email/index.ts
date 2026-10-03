/**
 * Auth Send Email Edge Function
 *
 * Invoked by GoTrue via the `send_email` auth hook (pg-functions).
 * Sends the authentication email AND a push notification containing the SAME
 * OTP code — so the user receives the identical code on both channels.
 *
 * Email delivery: Resend API (requires RESEND_API_KEY secret)
 *   - Falls back to console.log in local dev when Resend is not configured.
 * Push delivery:  Calls the existing `send-push-notification` edge function
 *                 (FCM for mobile, VAPID Web Push for browsers).
 *
 * Push notifications are sent for action types that carry an OTP token:
 *   - magiclink   (login + sensitive data verification)
 *   - reauthentication
 *
 * @see https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook
 */

import { serve, createClient } from "../_shared/deps.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthEmailPayload {
  user: {
    id: string;
    email: string;
    phone?: string;
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
  };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
    token_new?: string;
    token_hash_new?: string;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Action types for which we also send a push notification with the OTP code */
const PUSH_OTP_ACTION_TYPES = new Set(["magiclink", "magic_link", "reauthentication"]);

const BRAND_COLOR = "#1ead89";
const BRAND_BG = "#f0f8f6";

// ---------------------------------------------------------------------------
// Localised strings
// ---------------------------------------------------------------------------

type Langs = "cs" | "en" | "de" | "fr" | "ru" | "th";

const L = {
  pushTitle: {
    cs: "Platform — Autorizační kód",
    en: "Platform — Authorization Code",
    de: "Platform — Autorisierungscode",
    fr: "Platform — Code d'autorisation",
    ru: "Platform — Код авторизации",
    th: "Platform — รหัสยืนยัน",
  } satisfies Record<Langs, string>,

  subjects: {
    magiclink: {
      cs: "Váš přihlašovací kód — Platform",
      en: "Your sign-in code — Platform",
      de: "Ihr Anmeldecode — Platform",
      fr: "Votre code de connexion — Platform",
      ru: "Ваш код входа — Platform",
      th: "รหัสเข้าสู่ระบบของคุณ — Platform",
    },
    magic_link: {
      cs: "Váš přihlašovací kód — Platform",
      en: "Your sign-in code — Platform",
      de: "Ihr Anmeldecode — Platform",
      fr: "Votre code de connexion — Platform",
      ru: "Ваш код входа — Platform",
      th: "รหัสเข้าสู่ระบบของคุณ — Platform",
    },
    recovery: {
      cs: "Obnovení hesla — Platform",
      en: "Reset your password — Platform",
      de: "Passwort zurücksetzen — Platform",
      fr: "Réinitialiser votre mot de passe — Platform",
      ru: "Сброс пароля — Platform",
      th: "รีเซ็ตรหัสผ่านของคุณ — Platform",
    },
    reauthentication: {
      cs: "Ověřte svou totožnost — Platform",
      en: "Verify your identity — Platform",
      de: "Überprüfen Sie Ihre Identität — Platform",
      fr: "Vérifiez votre identité — Platform",
      ru: "Подтвердите свою личность — Platform",
      th: "ยืนยันตัวตนของคุณ — Platform",
    },
    signup: {
      cs: "Potvrzení registrace — Platform",
      en: "Confirm your registration — Platform",
      de: "Bestätigen Sie Ihre Registrierung — Platform",
      fr: "Confirmez votre inscription — Platform",
      ru: "Подтвердите регистрацию — Platform",
      th: "ยืนยันการลงทะเบียนของคุณ — Platform",
    },
    invite: {
      cs: "Byli jste pozváni — Platform",
      en: "You've been invited — Platform",
      de: "Sie wurden eingeladen — Platform",
      fr: "Vous avez été invité — Platform",
      ru: "Вас пригласили — Platform",
      th: "คุณได้รับเชิญ — Platform",
    },
    email_change: {
      cs: "Potvrďte nový email — Platform",
      en: "Confirm your new email — Platform",
      de: "Bestätigen Sie Ihre neue E-Mail — Platform",
      fr: "Confirmez votre nouvel email — Platform",
      ru: "Подтвердите новый email — Platform",
      th: "ยืนยันอีเมลใหม่ของคุณ — Platform",
    },
  } as Record<string, Record<Langs, string>>,

  emailHeading: {
    magiclink: {
      cs: "Přihlaste se do Platform",
      en: "Sign in to Platform",
      de: "Bei Platform anmelden",
      fr: "Connectez-vous à Platform",
      ru: "Войдите в Platform",
      th: "เข้าสู่ระบบ Platform",
    },
    phi_verification: {
      cs: "Ověřte svou totožnost",
      en: "Verify your identity",
      de: "Überprüfen Sie Ihre Identität",
      fr: "Vérifiez votre identité",
      ru: "Подтвердите свою личность",
      th: "ยืนยันตัวตนของคุณ",
    },
    recovery: {
      cs: "Obnovení hesla",
      en: "Reset your password",
      de: "Passwort zurücksetzen",
      fr: "Réinitialiser votre mot de passe",
      ru: "Сброс пароля",
      th: "รีเซ็ตรหัสผ่านของคุณ",
    },
    reauthentication: {
      cs: "Ověřte svou totožnost",
      en: "Verify your identity",
      de: "Überprüfen Sie Ihre Identität",
      fr: "Vérifiez votre identité",
      ru: "Подтвердите свою личность",
      th: "ยืนยันตัวตนของคุณ",
    },
    signup: {
      cs: "Potvrzení registrace",
      en: "Confirm your registration",
      de: "Bestätigen Sie Ihre Registrierung",
      fr: "Confirmez votre inscription",
      ru: "Подтвердите регистрацию",
      th: "ยืนยันการลงทะเบียนของคุณ",
    },
    invite: {
      cs: "Byli jste pozváni do Platform",
      en: "You've been invited to Platform",
      de: "Sie wurden zu Platform eingeladen",
      fr: "Vous avez été invité à Platform",
      ru: "Вас пригласили в Platform",
      th: "คุณได้รับเชิญเข้าร่วม Platform",
    },
    email_change: {
      cs: "Potvrďte nový email",
      en: "Confirm your new email",
      de: "Bestätigen Sie Ihre neue E-Mail",
      fr: "Confirmez votre nouvel email",
      ru: "Подтвердите новый email",
      th: "ยืนยันอีเมลใหม่ของคุณ",
    },
  } as Record<string, Record<Langs, string>>,

  emailBody: {
    magiclink: {
      cs: "Klikněte na tlačítko níže nebo zadejte jednorázový kód pro bezpečné přihlášení.",
      en: "Click the button below or enter the one-time code to sign in securely.",
      de: "Klicken Sie auf den Button oder geben Sie den Einmalcode ein, um sich sicher anzumelden.",
      fr: "Cliquez sur le bouton ou entrez le code à usage unique pour vous connecter en toute sécurité.",
      ru: "Нажмите кнопку или введите одноразовый код для безопасного входа.",
      th: "คลิกปุ่มด้านล่างหรือกรอกรหัสแบบใช้ครั้งเดียวเพื่อเข้าสู่ระบบอย่างปลอดภัย",
    },
    phi_verification: {
      cs: "Z bezpečnostních důvodů prosím ověřte svou totožnost zadáním kódu níže.",
      en: "For security reasons, please verify your identity by entering the code below.",
      de: "Aus Sicherheitsgründen überprüfen Sie bitte Ihre Identität mit dem Code unten.",
      fr: "Pour des raisons de sécurité, veuillez vérifier votre identité avec le code ci-dessous.",
      ru: "В целях безопасности подтвердите свою личность, введя код ниже.",
      th: "ด้วยเหตุผลด้านความปลอดภัย โปรดยืนยันตัวตนโดยกรอกรหัสด้านล่าง",
    },
    recovery: {
      cs: "Klikněte na tlačítko níže pro obnovení hesla.",
      en: "Click the button below to reset your password.",
      de: "Klicken Sie auf den Button, um Ihr Passwort zurückzusetzen.",
      fr: "Cliquez sur le bouton ci-dessous pour réinitialiser votre mot de passe.",
      ru: "Нажмите кнопку ниже для сброса пароля.",
      th: "คลิกปุ่มด้านล่างเพื่อรีเซ็ตรหัสผ่าน",
    },
    reauthentication: {
      cs: "Z bezpečnostních důvodů prosím ověřte svou totožnost zadáním kódu níže.",
      en: "For security reasons, please verify your identity by entering the code below.",
      de: "Aus Sicherheitsgründen überprüfen Sie bitte Ihre Identität mit dem Code unten.",
      fr: "Pour des raisons de sécurité, veuillez vérifier votre identité avec le code ci-dessous.",
      ru: "В целях безопасности подтвердите свою личность, введя код ниже.",
      th: "ด้วยเหตุผลด้านความปลอดภัย โปรดยืนยันตัวตนโดยกรอกรหัสด้านล่าง",
    },
    signup: {
      cs: "Klikněte na tlačítko níže pro potvrzení registrace.",
      en: "Click the button below to confirm your registration.",
      de: "Klicken Sie auf den Button, um Ihre Registrierung zu bestätigen.",
      fr: "Cliquez sur le bouton ci-dessous pour confirmer votre inscription.",
      ru: "Нажмите кнопку для подтверждения регистрации.",
      th: "คลิกปุ่มด้านล่างเพื่อยืนยันการลงทะเบียน",
    },
    invite: {
      cs: "Byli jste pozváni do platformy Platform. Klikněte na tlačítko níže pro přijetí pozvání.",
      en: "You've been invited to Platform. Click the button below to accept the invitation.",
      de: "Sie wurden zu Platform eingeladen. Klicken Sie auf den Button, um die Einladung anzunehmen.",
      fr: "Vous avez été invité à Platform. Cliquez sur le bouton pour accepter.",
      ru: "Вас пригласили в Platform. Нажмите кнопку для принятия приглашения.",
      th: "คุณได้รับเชิญเข้าร่วม Platform คลิกปุ่มด้านล่างเพื่อยอมรับ",
    },
    email_change: {
      cs: "Potvrďte změnu emailové adresy kliknutím na tlačítko níže.",
      en: "Confirm your email address change by clicking the button below.",
      de: "Bestätigen Sie die Änderung Ihrer E-Mail-Adresse durch Klicken auf den Button.",
      fr: "Confirmez le changement de votre adresse email en cliquant sur le bouton.",
      ru: "Подтвердите изменение email, нажав кнопку ниже.",
      th: "ยืนยันการเปลี่ยนแปลงอีเมลโดยคลิกปุ่มด้านล่าง",
    },
  } as Record<string, Record<Langs, string>>,

  buttonLabel: {
    magiclink: { cs: "Přihlásit se", en: "Sign in", de: "Anmelden", fr: "Se connecter", ru: "Войти", th: "เข้าสู่ระบบ" },
    recovery: { cs: "Obnovit heslo", en: "Reset password", de: "Passwort zurücksetzen", fr: "Réinitialiser", ru: "Сбросить", th: "รีเซ็ต" },
    signup: { cs: "Potvrdit", en: "Confirm", de: "Bestätigen", fr: "Confirmer", ru: "Подтвердить", th: "ยืนยัน" },
    invite: { cs: "Přijmout pozvání", en: "Accept invitation", de: "Einladung annehmen", fr: "Accepter", ru: "Принять", th: "ยอมรับ" },
    email_change: { cs: "Potvrdit email", en: "Confirm email", de: "E-Mail bestätigen", fr: "Confirmer email", ru: "Подтвердить", th: "ยืนยัน" },
  } as Record<string, Record<Langs, string>>,

  otpLabel: {
    cs: "Jednorázový kód",
    en: "One-time code",
    de: "Einmalcode",
    fr: "Code à usage unique",
    ru: "Одноразовый код",
    th: "รหัสแบบใช้ครั้งเดียว",
  } as Record<Langs, string>,

  otpExpiry: {
    cs: "Tento kód brzy vyprší.",
    en: "This code expires shortly.",
    de: "Dieser Code läuft bald ab.",
    fr: "Ce code expirera bientôt.",
    ru: "Этот код скоро истечет.",
    th: "รหัสนี้จะหมดอายุเร็ว ๆ นี้",
  } as Record<Langs, string>,

  ignoreLine: {
    cs: "Pokud jste o to nežádali, tento email můžete ignorovat.",
    en: "If you didn't request this, you can ignore this email.",
    de: "Wenn Sie dies nicht angefordert haben, können Sie diese E-Mail ignorieren.",
    fr: "Si vous n'avez pas fait cette demande, vous pouvez ignorer cet email.",
    ru: "Если вы не запрашивали это, просто игнорируйте это письмо.",
    th: "หากคุณไม่ได้ร้องขอ สามารถละเว้นอีเมลนี้ได้",
  } as Record<Langs, string>,

  helpLine: {
    cs: "Potřebujete pomoc? Napište nám na",
    en: "Need help? Contact us at",
    de: "Brauchen Sie Hilfe? Schreiben Sie uns an",
    fr: "Besoin d'aide ? Contactez-nous à",
    ru: "Нужна помощь? Напишите нам на",
    th: "ต้องการความช่วยเหลือ? ติดต่อเราที่",
  } as Record<Langs, string>,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lang(payload: AuthEmailPayload): Langs {
  const meta = payload.user.user_metadata;
  const raw = (meta?.lang as string) ?? "en";
  return (["cs", "en", "de", "fr", "ru", "th"].includes(raw) ? raw : "en") as Langs;
}

function t<T extends Record<Langs, string>>(dict: T, l: Langs): string {
  return dict[l] ?? dict.en;
}

function isPhi(payload: AuthEmailPayload): boolean {
  return (payload.user.user_metadata?.purpose as string) === "phi_verification";
}

function resolveActionKey(payload: AuthEmailPayload): string {
  if (isPhi(payload)) return "phi_verification";
  const at = payload.email_data.email_action_type;
  return at === "magic_link" ? "magiclink" : at;
}

function isLocalDev(): boolean {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  return url.includes("127.0.0.1") || url.includes("localhost");
}

// ---------------------------------------------------------------------------
// Confirmation URL builder
// ---------------------------------------------------------------------------

/**
 * GoTrue generates a confirmation URL from the redirect_to + token_hash.
 * When using the send_email hook GoTrue does NOT provide a pre-built
 * confirmation URL — we must construct it ourselves.
 */
function buildConfirmationUrl(payload: AuthEmailPayload): string {
  const { token_hash, redirect_to, email_action_type, site_url } = payload.email_data;
  const base = site_url || redirect_to || "https://app.platform.com";
  // GoTrue confirmation endpoint path:
  const typeParam = email_action_type === "magiclink" || email_action_type === "magic_link"
    ? "magiclink"
    : email_action_type;
  return `${base}/auth/v1/verify?token=${encodeURIComponent(token_hash)}&type=${typeParam}&redirect_to=${encodeURIComponent(redirect_to || base)}`;
}

// ---------------------------------------------------------------------------
// Email HTML renderer
// ---------------------------------------------------------------------------

function buildEmailHtml(payload: AuthEmailPayload): string {
  const l = lang(payload);
  const actionKey = resolveActionKey(payload);
  const token = payload.email_data.token;
  const confirmationUrl = buildConfirmationUrl(payload);
  const supportEmail = (payload.user.user_metadata?.support_email as string) ?? "support@platform.com";
  const brandName = (payload.user.user_metadata?.brand_name as string) ?? "Platform";
  const logoUrl = `${Deno.env.get('SUPABASE_URL') ?? 'https://platform.supabase.co'}/storage/v1/object/public/email-assets/branding/logo.png`;

  const heading = t(L.emailHeading[actionKey] ?? L.emailHeading.magiclink, l);
  const body = t(L.emailBody[actionKey] ?? L.emailBody.magiclink, l);
  const subject = t(L.subjects[actionKey] ?? L.subjects.magiclink, l);

  // Should we show a magic-link button?
  const showButton = !["reauthentication", "phi_verification"].includes(actionKey);
  const buttonLabel = showButton
    ? t(L.buttonLabel[actionKey] ?? L.buttonLabel.magiclink, l)
    : "";

  // Should we show the OTP code?
  const showOtp = Boolean(token);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#f6f7f9;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f6f7f9;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">

          <!-- Header -->
          <tr>
            <td style="padding:24px 32px;background:${BRAND_BG};border-bottom:1px solid #e5e7eb;">
              <img src="${logoUrl}" alt="${brandName}" height="32" style="display:block;border:0;"/>
            </td>
          </tr>

          <!-- Main content -->
          <tr>
            <td style="padding:32px;">
              <h1 style="margin:0 0 12px;font-size:24px;line-height:1.3;color:#0f172a;">${heading}</h1>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151;">${body}</p>

              ${showButton ? `
              <!-- Action button -->
              <div style="text-align:center;margin:24px 0;">
                <a href="${confirmationUrl}" style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;font-size:15px;">${buttonLabel}</a>
              </div>

              <!-- Fallback link -->
              <p style="margin:24px 0 8px;font-size:12px;color:#6b7280;word-break:break-all;">
                <a href="${confirmationUrl}" style="color:${BRAND_COLOR};text-decoration:none;">${confirmationUrl}</a>
              </p>` : ""}

              ${showOtp ? `
              <!-- OTP code -->
              <div style="border:1px dashed #c7e6dd;border-radius:12px;padding:20px;background:#f7fbfa;margin:24px 0;">
                <p style="margin:0 0 8px;font-size:14px;color:#0f172a;font-weight:600;">${t(L.otpLabel, l)}</p>
                <div style="font-size:32px;letter-spacing:8px;font-weight:700;color:#0f172a;text-align:center;padding:12px 0;">${token}</div>
                <p style="margin:8px 0 0;font-size:12px;color:#6b7280;text-align:center;">${t(L.otpExpiry, l)}</p>
              </div>` : ""}

              <p style="margin:20px 0 0;font-size:13px;color:#6b7280;">${t(L.ignoreLine, l)}</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;background:#f8fafc;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">
              <p style="margin:0 0 6px;">${t(L.helpLine, l)} ${supportEmail}.</p>
              <p style="margin:0;">${brandName}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Email delivery — Resend API
// ---------------------------------------------------------------------------

async function sendViaResend(
  to: string,
  subject: string,
  html: string,
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }

  try {
    const fromDomain = Deno.env.get("RESEND_FROM_DOMAIN") ?? "platform.com";
    const fromName = Deno.env.get("RESEND_FROM_NAME") ?? "Platform";
    const response = await fetch("https://api.resend.com/emails", {
        signal: AbortSignal.timeout(15000),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: `${fromName} <noreply@${fromDomain}>`,
        to: [to],
        subject,
        html,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      return { ok: false, error: `Resend ${response.status}: ${errBody}` };
    }

    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Resend network error: ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// Push notification — delegates to existing send-push-notification fn
// ---------------------------------------------------------------------------

async function sendOtpPushNotification(
  userId: string,
  otpCode: string,
  l: Langs,
): Promise<{ sent: boolean; error?: string }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return { sent: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" };
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
        signal: AbortSignal.timeout(15000),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        user_id: userId,
        title: t(L.pushTitle, l),
        body: otpCode,
        data: {
          type: "auth_otp",
          otp_code: otpCode,
        },
        priority: "high",
        send_mobile: true,
        send_web: true,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      return { sent: false, error: `Push ${response.status}: ${errBody}` };
    }

    const result = await response.json();
    const totalSent = (result.mobile_sent ?? 0) + (result.web_sent ?? 0);
    return { sent: totalSent > 0 };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { sent: false, error: `Push network error: ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// Audit log — records OTP push delivery (no sensitive data!)
// ---------------------------------------------------------------------------

async function logOtpPushDelivery(
  userId: string,
  actionType: string,
  pushResult: { sent: boolean; error?: string },
): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return;

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    await supabase.rpc("edge_mobile_notifications", {
      p_action: "insert_notification_log",
      p_payload: {
        created_at: new Date().toISOString(),
        data: {
          action_type: actionType,
          channel: "push",
          delivery_type: "auth_otp",
          push_sent: pushResult.sent,
          push_error: pushResult.error ?? null,
        },
        devices_failed: pushResult.sent ? 0 : 1,
        devices_sent: pushResult.sent ? 1 : 0,
        error_message: pushResult.error ?? null,
        notification_type: "auth_otp",
        recipients_count: 1,
        title: "auth_otp",
      },
    });
  } catch {
    // Fire-and-forget — do not block the auth flow
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  // No CORS needed — this function is called internally, never from a browser
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 204 });
  }

  try {
    const payload: AuthEmailPayload = await req.json();
    const { user, email_data } = payload;
    const l = lang(payload);
    const actionKey = resolveActionKey(payload);

    // ----- 1. Build and send email -----
    const subject = t(L.subjects[email_data.email_action_type] ?? L.subjects.magiclink, l);
    const html = buildEmailHtml(payload);

    if (isLocalDev()) {
      console.log(`\n📧  AUTH EMAIL [${email_data.email_action_type}${isPhi(payload) ? " / sensitive data" : ""}]`);
      console.log(`    To:    ${user.email}`);
      console.log(`    OTP:   ${email_data.token}`);
      console.log(`    URL:   ${buildConfirmationUrl(payload)}`);
      console.log(`    Lang:  ${l}\n`);
    }

    const emailResult = await sendViaResend(user.email, subject, html);
    if (!emailResult.ok) {
      console.warn(`Email delivery failed: ${emailResult.error}`);
      // Do NOT throw — push notification can still deliver the code
    }

    // ----- 2. Send push notification with the SAME OTP code -----
    if (
      PUSH_OTP_ACTION_TYPES.has(email_data.email_action_type) &&
      email_data.token
    ) {
      const pushResult = await sendOtpPushNotification(user.id, email_data.token, l);

      if (pushResult.error) {
        console.warn(`Push OTP delivery note: ${pushResult.error}`);
      }

      // Audit log (fire-and-forget)
      void logOtpPushDelivery(user.id, actionKey, pushResult);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("auth-send-email fatal error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
