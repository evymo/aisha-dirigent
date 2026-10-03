import { config } from './config.js';

interface SmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/** Send SMS via configured provider (Twilio / MessageBird / Vonage) */
export async function sendSms(to: string, body: string): Promise<SmsResult> {
  switch (config.smsProvider) {
    case 'twilio':
      return sendTwilio(to, body);
    case 'messagebird':
      return sendMessageBird(to, body);
    case 'vonage':
      return sendVonage(to, body);
    default:
      return { success: false, error: `Unknown SMS provider: ${config.smsProvider}` };
  }
}

/** Generate a random numeric OTP code */
export function generateOtp(length: number = config.otpLength): string {
  const digits = new Uint8Array(length);
  crypto.getRandomValues(digits);
  return Array.from(digits, (d) => (d % 10).toString()).join('');
}

/** Normalize phone number to E.164 */
export function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[^+\d]/g, '');
  // Czech default: if starts with a digit (no +), prepend +420
  if (!cleaned.startsWith('+')) {
    cleaned = `+420${cleaned}`;
  }
  return cleaned;
}

// ── Provider implementations ──

async function sendTwilio(to: string, body: string): Promise<SmsResult> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`;
  const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: config.twilioFromNumber, Body: body }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { success: false, error: `Twilio ${res.status}: ${detail}` };
  }

  const data = await res.json() as { sid?: string };
  return { success: true, messageId: data.sid };
}

async function sendMessageBird(to: string, body: string): Promise<SmsResult> {
  const res = await fetch('https://rest.messagebird.com/messages', {
    method: 'POST',
    headers: {
      'Authorization': `AccessKey ${config.messagebirdApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      originator: config.messagebirdOriginator,
      recipients: [to],
      body,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { success: false, error: `MessageBird ${res.status}: ${detail}` };
  }

  const data = await res.json() as { id?: string };
  return { success: true, messageId: data.id };
}

async function sendVonage(to: string, body: string): Promise<SmsResult> {
  const res = await fetch('https://rest.nexmo.com/sms/json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: config.vonageApiKey,
      api_secret: config.vonageApiSecret,
      from: config.vonageFromNumber,
      to: to.replace('+', ''),
      text: body,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { success: false, error: `Vonage ${res.status}: ${detail}` };
  }

  const data = await res.json() as { messages?: Array<{ 'message-id'?: string; status?: string }> };
  const first = data.messages?.[0];
  if (first?.status !== '0') {
    return { success: false, error: `Vonage status: ${first?.status}` };
  }

  return { success: true, messageId: first['message-id'] };
}
