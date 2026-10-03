/**
 * Zakládání uživatelů z administrace — heslová cesta.
 *
 * ── Proč to chybělo ─────────────────────────────────────────────────────────
 * Pozvánkový mechanismus v repu JE (`create_invitation` / `claim_invitation`
 * + branded e-mail v `auth-email.ts`), ale předpokládá, že se člověk nejdřív
 * nějak dostane k účtu. Kdo má Google nebo Apple a účet ještě nemá, dostane se:
 * brokerský tok realmu (`aisha first broker login` → `idp-create-user-if-unique`)
 * účet založí, a to i při vypnuté samoobslužné registraci — jsou to dva NEZÁVISLÉ
 * přepínače. EXISTUJÍCÍ účet (i předzaložený touto routou) se s Googlem/Applem
 * propojí jen po potvrzení a důkazu vlastnictví: odkazem e-mailem (vyžaduje SMTP
 * realmu) nebo heslem účtu. Automatické propojení podle e-mailu je od 2026-09-27
 * pryč (docs/deploy/OAUTH_PROVIDERS.md) — předzaložený účet bez hesla na instanci
 * bez SMTP se proto Googlem sám nepropojí.
 *
 * Kdo federovanou autoritu nepoužívá, se ale s `registrationAllowed=false`
 * dovnitř nedostane vůbec. Tahle routa je právě ta chybějící heslová cesta:
 * administrace účet PŘEDZALOŽÍ a Keycloak pošle člověku e-mail, kterým si
 * nastaví heslo. Registrace zůstává vypnutá — účet zakládá správce, ne návštěvník.
 *
 * ── Proč ne nový mechanismus ────────────────────────────────────────────────
 * Tvar účtu je shodný s `scripts/db/provision-operators.mjs` (roster): stejné
 * `requiredActions: ["UPDATE_PASSWORD"]`, stejné odvození username z e-mailu.
 * Dvě různé podoby téhož účtu podle toho, kudy vznikl, by byla druhá pravda.
 *
 * ── Oprávnění ───────────────────────────────────────────────────────────────
 * Volající: admin/staff JWT (`is_admin_or_staff`), NE service-role. Vůči
 * Keycloaku jedeme přes servisní účet s rolemi `realm-management` — heslo
 * platformního admina do gateway nepatří (viz auth/kc-admin.ts).
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';
import { kcAdminBase, kcAdminConfigured, kcAdminToken } from '../auth/kc-admin.js';
import { guardedFetch } from '../lib/guarded-fetch.js';

const POSTGREST = config.postgrestUrl;

interface InviteBody {
  email?: string;
  role?: string;
  firstName?: string;
  lastName?: string;
  /** Poslat e-mail pro nastavení hesla. Vypnuto = účet se jen předzaloží. */
  sendEmail?: boolean;
}

async function rpcUser<T>(fn: string, params: Record<string, unknown>, jwt: string): Promise<T | null> {
  const resp = await guardedFetch(`${POSTGREST}/rpc/${fn}`, {
    body: JSON.stringify(params),
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) return null;
  return (await resp.json().catch(() => null)) as T | null;
}

/** Uživatelské jméno z e-mailu — shodné odvození jako v provision-operators.mjs. */
function usernameFromEmail(email: string): string {
  return (email.split('@')[0] ?? '').trim();
}

export const adminUsersRoute: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post<{ Body: InviteBody }>('/users/invite', async (req, reply) => {
    const jwt = (req.headers.authorization ?? '').replace('Bearer ', '');
    if (!jwt) return reply.code(401).send({ error: 'Unauthorized' });
    const roleCheck = await rpcUser<boolean>('is_admin_or_staff', {}, jwt);
    if (!roleCheck) return reply.code(403).send({ error: 'Admin/staff required' });

    const { email, role, firstName, lastName, sendEmail = true } = req.body ?? {};
    if (!email || !email.includes('@')) return reply.code(400).send({ error: "Missing or invalid 'email'" });

    if (!kcAdminConfigured()) {
      // Hlasitě, ne tiše: bez servisního účtu tahle cesta NEEXISTUJE a člověk
      // by čekal na e-mail, který nikdy nepřijde.
      return reply.code(503).send({
        error: 'KC admin service account not configured (KC_ADMIN_CLIENT_SECRET)',
      });
    }
    const token = await kcAdminToken();
    if (!token) return reply.code(502).send({ error: 'KC admin token could not be minted' });

    const base = kcAdminBase();
    const auth = { Authorization: `Bearer ${token}` };

    // ── 1. Už existuje? Idempotence: opakované pozvání není chyba ────────────
    const lookup = await guardedFetch(`${base}/users?email=${encodeURIComponent(email)}&exact=true`, {
      headers: auth,
      signal: AbortSignal.timeout(10_000),
    });
    if (!lookup.ok) return reply.code(502).send({ error: 'KC user lookup failed' });
    const existing = (await lookup.json()) as Array<{ id: string }>;

    let userId = existing[0]?.id ?? null;
    let created = false;

    // ── 2. Předzaložení účtu ────────────────────────────────────────────────
    if (!userId) {
      const rep: Record<string, unknown> = {
        username: usernameFromEmail(email),
        email,
        enabled: true,
        // Ověření e-mailu obstará akce níž — účet bez hesla se stejně nedá použít.
        emailVerified: false,
        requiredActions: ['UPDATE_PASSWORD'],
      };
      if (firstName) rep.firstName = firstName;
      if (lastName) rep.lastName = lastName;

      const createResp = await guardedFetch(`${base}/users`, {
        body: JSON.stringify(rep),
        headers: { ...auth, 'Content-Type': 'application/json' },
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
      });
      if (createResp.status !== 201) {
        // 409 = kolize username pod jiným e-mailem; to chce člověka, ne retry.
        return reply.code(createResp.status === 409 ? 409 : 502).send({
          error: 'KC user create failed',
          kc_status: createResp.status,
        });
      }
      // Vlastní proměnná, ne přiřazení rovnou do `userId`: `pop()` vrací
      // `string | undefined`, kdežto `userId` odvodí TS z větve výš jako `string`.
      const createdId = (createResp.headers.get('location') ?? '').split('/').filter(Boolean).pop();
      if (!createdId) return reply.code(502).send({ error: 'KC user created but id could not be resolved' });
      userId = createdId;
      created = true;
    }

    // ── 3. Role přes EXISTUJÍCÍ mechanismus pozvánek ────────────────────────
    // Roli nepřidělujeme přímo: `create_invitation` je zavedený kanál (audit,
    // platnost, prefill) a `claim_invitation` ji přidělí, až se člověk přihlásí.
    let invitationId: string | null = null;
    if (role) {
      invitationId = await rpcUser<string>(
        'create_invitation',
        { p_email: email, p_max_uses: 1, p_role: role },
        jwt,
      );
    }

    // ── 4. E-mail pro nastavení hesla ───────────────────────────────────────
    let emailSent = false;
    if (sendEmail) {
      const actionResp = await guardedFetch(`${base}/users/${userId}/execute-actions-email`, {
        body: JSON.stringify(['UPDATE_PASSWORD', 'VERIFY_EMAIL']),
        headers: { ...auth, 'Content-Type': 'application/json' },
        method: 'PUT',
        signal: AbortSignal.timeout(20_000),
      });
      emailSent = actionResp.ok;
      if (!actionResp.ok) {
        // Účet JE založený — to je hodnotný mezistav, ne selhání celé operace.
        // Vracíme 207, aby administrace mohla nabídnout „poslat znovu".
        return reply.code(207).send({
          created,
          email_sent: false,
          invitation_id: invitationId,
          user_id: userId,
          warning: 'Account exists but the set-password email could not be sent',
        });
      }
    }

    return reply.send({ created, email_sent: emailSent, invitation_id: invitationId, user_id: userId });
  });
};
