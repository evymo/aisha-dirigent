import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken } from '../auth.js';
import { rpcService } from '../postgrest.js';
import { config } from '../config.js';
import { sendSms, generateOtp, normalizePhone } from '../sms-providers.js';

/**
 * SMS OTP routes — send and verify OTP codes.
 * OTP state managed via `edge_sms_otp` RPC function.
 */
export async function smsOtpRoutes(app: FastifyInstance): Promise<void> {
  // ── Send OTP ──
  app.post('/send-sms-otp', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await verifyToken(req.headers.authorization);

    const body = req.body as { phone?: string; locale?: string } | null;
    if (!body?.phone) {
      return reply.status(400).send({ error: 'phone is required' });
    }

    const phone = normalizePhone(body.phone);
    // Locale comes from the request; 'en' is the terminal failover, not 'cs'.
    const locale = body.locale ?? 'en';

    // Generate OTP
    const code = generateOtp();

    // Store OTP via RPC (handles rate limiting, expiry, attempt tracking)
    const result = await rpcService<{ success: boolean; error?: string }>('edge_sms_otp', {
      p_action: 'create',
      p_code: code,
      p_max_attempts: config.otpMaxAttempts,
      p_phone: phone,
      p_ttl_minutes: config.otpTtlMinutes,
      p_user_id: user.userId,
    });

    if (!result.success) {
      return reply.status(429).send({ error: result.error ?? 'Too many OTP requests' });
    }

    // Send SMS
    const message = locale === 'cs'
      ? `Váš ověřovací kód Evymo: ${code}. Platnost ${config.otpTtlMinutes} minut.`
      : `Your Evymo verification code: ${code}. Valid for ${config.otpTtlMinutes} minutes.`;

    const smsResult = await sendSms(phone, message);

    if (!smsResult.success) {
      app.log.error({ phone: phone.slice(0, 6) + '***', error: smsResult.error }, 'SMS send failed');
      return reply.status(502).send({ error: 'Failed to send SMS' });
    }

    return reply.send({ success: true, ttl_minutes: config.otpTtlMinutes });
  });

  // ── Verify OTP ──
  app.post('/verify-sms-otp', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await verifyToken(req.headers.authorization);

    const body = req.body as { phone?: string; code?: string } | null;
    if (!body?.phone || !body?.code) {
      return reply.status(400).send({ error: 'phone and code are required' });
    }

    const phone = normalizePhone(body.phone);

    const result = await rpcService<{ success: boolean; error?: string; verified?: boolean }>('edge_sms_otp', {
      p_action: 'verify',
      p_code: body.code,
      p_phone: phone,
      p_user_id: user.userId,
    });

    if (!result.success) {
      return reply.status(400).send({ error: result.error ?? 'Verification failed' });
    }

    return reply.send({ verified: result.verified ?? true });
  });
}
