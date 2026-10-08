/**
 * webhook-bridge: řádek „Forwarding to n8n" nenese přihlašovací údaje z
 * N8N_WEBHOOK_URL.
 *
 * Adresa n8n přichází z prostředí a smí nést userinfo
 * (`https://uzivatel:heslo@n8n…`). Most logoval celou cílovou URL
 * (nezávislá revize 2026-10-05). Teď loguje hostitele a cestu webhooku — cesta
 * je naše (resolveWebhookPath), ne z prostředí.
 *
 * `req.log` je skutečný pino z továrny `safeLoggerOptions`, zápis se čte ze
 * zachyceného proudu — ne z mocku, který by ukázal jen argumenty volání.
 */
import { Writable } from 'node:stream';
import { createHmac } from 'node:crypto';
import pino from 'pino';
import { safeLoggerOptions } from '@aisha/security';
import { describe, expect, it, vi } from 'vitest';

const HESLO = 'test-n8n-heslo-3b7e';

const { mockRpcService, mockFetch } = vi.hoisted(() => ({ mockRpcService: vi.fn(), mockFetch: vi.fn() }));

vi.mock('../postgrest.js', () => ({ rpcService: mockRpcService }));
vi.mock('../config.js', () => ({
  config: {
    githubWebhookSecret: 'hmac-mock',
    n8nWebhookUrl: `https://bridge:${HESLO}@n8n.example.test:5678`,
  },
}));

function zachyceny() {
  const kusy: string[] = [];
  const proud = new Writable({
    write(kus: Buffer, _k, hotovo) {
      kusy.push(kus.toString('utf8'));
      hotovo();
    },
  });
  const syrove = (): string => kusy.join('');
  const radky = (): Record<string, unknown>[] =>
    syrove()
      .split('\n')
      .filter(Boolean)
      .map((r) => JSON.parse(r) as Record<string, unknown>);
  return { proud, syrove, radky };
}

describe('webhook-bridge — log předání do n8n', () => {
  it('hostitel a cesta webhooku ano, heslo z N8N_WEBHOOK_URL ne', async () => {
    (globalThis as { fetch: unknown }).fetch = mockFetch;
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
    mockRpcService.mockResolvedValue({ event_id: 'e1', is_duplicate: false });

    const { webhookBridgeRoutes } = await import('../routes/webhook-bridge.js');
    const handlers = new Map<string, (req: unknown, reply: unknown) => unknown>();
    const app = {
      post: (cesta: string, _volby: unknown, h: (req: unknown, reply: unknown) => unknown) => handlers.set(cesta, h),
    } as unknown as Parameters<typeof webhookBridgeRoutes>[0];
    await webhookBridgeRoutes(app);

    const z = zachyceny();
    const log = pino(safeLoggerOptions({ level: 'info' }), z.proud);
    const body = { repository: { full_name: 'a/b' } };
    const rawBody = JSON.stringify(body);
    const reply = { code: () => reply, send: () => reply };
    await handlers.get('/webhook')!(
      {
        headers: {
          'x-github-event': 'push',
          'x-github-delivery': 'delivery-log-1',
          'x-hub-signature-256': 'sha256=' + createHmac('sha256', 'hmac-mock').update(rawBody).digest('hex'),
        },
        body,
        rawBody,
        log,
      },
      reply,
    );

    expect(mockFetch, 'požadavek do n8n jde dál s plnou adresou').toHaveBeenCalledWith(
      `https://bridge:${HESLO}@n8n.example.test:5678/webhook/push-deploy`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(z.syrove()).not.toContain(HESLO);
    const predani = z.radky().find((r) => r.msg === 'Forwarding to n8n');
    expect(predani, 'řádek předání se dál píše').toBeDefined();
    expect(predani).toMatchObject({ n8nHost: 'n8n.example.test:5678', webhookPath: '/webhook/push-deploy', delivery: 'delivery-log-1' });
  });
});
