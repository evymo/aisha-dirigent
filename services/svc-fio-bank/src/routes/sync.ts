import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { verifyToken, isAdminOrStaff, AuthError } from '../auth.js';
import { rpcService } from '../postgrest.js';
import { resolveBaseCurrency } from '../lib/currency.js';

// ── Fio API types ──

interface FioColumnValue {
  value: string | number;
  name: string;
  id: number;
}

interface FioTransaction {
  column0?: FioColumnValue;  // Datum
  column1?: FioColumnValue;  // Objem
  column2?: FioColumnValue;  // Protiúčet
  column5?: FioColumnValue;  // VS
  column7?: FioColumnValue;  // Uživatelská identifikace
  column10?: FioColumnValue; // Název protiúčtu
  column14?: FioColumnValue; // Měna
  column16?: FioColumnValue; // Zpráva pro příjemce
  column22?: FioColumnValue; // ID pohybu
  column25?: FioColumnValue; // Komentář
}

interface ParsedTransaction {
  amount: number;
  currency: string;
  fio_transaction_id: string;
  message: string;
  sender_account: string;
  sender_name: string;
  transaction_date: string;
  variable_symbol: string;
}

type SyncAction = 'sync' | 'status';

interface SyncBody {
  action?: SyncAction;
  from_date?: string;
  to_date?: string;
}

// ── Helpers ──

function parseFioTransactions(
  apiResponse: Record<string, unknown>,
  baseCurrency: string,
): ParsedTransaction[] {
  const accountStatement = apiResponse?.accountStatement as Record<string, unknown> | undefined;
  if (!accountStatement) return [];

  const transactionList = accountStatement.transactionList as Record<string, unknown> | undefined;
  if (!transactionList) return [];

  const transactions = transactionList.transaction;
  if (!Array.isArray(transactions)) return [];

  return transactions
    .map((tx: FioTransaction) => {
      const txId = tx.column22?.value;
      const amount = tx.column1?.value;

      if (txId == null || amount == null) return null;
      if (typeof amount !== 'number' || amount <= 0) return null;

      const dateStr = String(tx.column0?.value ?? '');
      const isoDate = dateStr.split('+')[0] || dateStr;

      return {
        fio_transaction_id: String(txId),
        amount,
        currency: String(tx.column14?.value ?? baseCurrency),
        variable_symbol: String(tx.column5?.value ?? ''),
        sender_account: String(tx.column2?.value ?? ''),
        sender_name: String(tx.column10?.value ?? ''),
        transaction_date: isoDate,
        message: String(tx.column16?.value ?? tx.column25?.value ?? tx.column7?.value ?? ''),
      };
    })
    .filter((tx): tx is ParsedTransaction => tx !== null);
}

async function getFioApiToken(): Promise<string | null> {
  try {
    const data = await rpcService<{ rows?: Array<{ key?: unknown; value?: unknown }> } | null>(
      'edge_app_secrets',
      { p_action: 'get_many', p_payload: { keys: ['fio_bank_api_token'] } },
    );

    const rows = data?.rows ?? [];
    for (const row of rows) {
      if (row.key === 'fio_bank_api_token' && typeof row.value === 'string') {
        return row.value;
      }
    }
  } catch {
    // fall through to env
  }

  return config.fioApiTokenEnv || null;
}

async function getFioBankSettings(): Promise<{ enabled: boolean; check_interval_minutes: number }> {
  try {
    const data = await rpcService<Record<string, unknown> | null>(
      'get_system_config',
      { p_key: 'fio_bank' },
    );

    if (data && typeof data === 'object' && 'enabled' in data) {
      return {
        enabled: data.enabled === true,
        check_interval_minutes:
          typeof data.check_interval_minutes === 'number'
            ? data.check_interval_minutes
            : 30,
      };
    }
  } catch {
    // default
  }

  return { enabled: false, check_interval_minutes: 30 };
}

// ── Routes ──

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /sync — Main action dispatch (sync | status)
   * Requires admin or staff role.
   */
  app.post<{ Body: SyncBody }>('/sync', async (req: FastifyRequest<{ Body: SyncBody }>, reply: FastifyReply) => {
    // Auth
    let user;
    try {
      user = await verifyToken(req.headers.authorization);
    } catch (err) {
      const status = err instanceof AuthError ? err.statusCode : 401;
      return reply.status(status).send({ error: err instanceof Error ? err.message : 'Unauthorized' });
    }

    if (!isAdminOrStaff(user)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const body = req.body ?? {};
    const action: SyncAction = body.action === 'status' ? 'status' : 'sync';

    // ─── STATUS ───
    if (action === 'status') {
      const settings = await getFioBankSettings();
      const token = await getFioApiToken();

      return reply.send({
        configured: !!token,
        enabled: settings.enabled,
        check_interval_minutes: settings.check_interval_minutes,
      });
    }

    // ─── SYNC ───
    const settings = await getFioBankSettings();

    if (!settings.enabled) {
      return reply.status(400).send({ ok: false, reason: 'Fio bank sync is disabled' });
    }

    const fioToken = await getFioApiToken();
    if (!fioToken) {
      return reply.status(400).send({ ok: false, reason: 'Fio API token not configured' });
    }

    // Date range — last 30 days default
    const fromDate = body.from_date
      ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const toDate = body.to_date
      ?? new Date().toISOString().split('T')[0];

    req.log.info({ fromDate, toDate }, 'Fetching Fio transactions');

    // Fio API call
    const fioUrl = `${config.fioApiBase}/periods/${fioToken}/${fromDate}/${toDate}/transactions.json`;

    const fioResponse = await fetch(fioUrl, {
      signal: AbortSignal.timeout(config.fioApiTimeoutMs),
      headers: { Accept: 'application/json' },
    });

    if (!fioResponse.ok) {
      const errText = await fioResponse.text().catch(() => '');
      req.log.warn({ status: fioResponse.status, body: errText.substring(0, 200) }, 'Fio API error');
      return reply.status(502).send({ ok: false, reason: `Fio API returned ${fioResponse.status}` });
    }

    const fioData = await fioResponse.json() as Record<string, unknown>;
    const baseCurrency = await resolveBaseCurrency();
    const transactions = parseFioTransactions(fioData, baseCurrency);

    req.log.info({ count: transactions.length }, 'Parsed transactions');

    let inserted = 0;
    let duplicates = 0;
    let autoMatched = 0;

    for (const tx of transactions) {
      // Insert transaction
      const insertResult = await rpcService<{ ok?: boolean; reason?: string } | null>(
        'edge_bank_transactions',
        {
          p_action: 'insert_transaction',
          p_payload: {
            fio_transaction_id: tx.fio_transaction_id,
            amount: tx.amount,
            currency: tx.currency,
            variable_symbol: tx.variable_symbol,
            sender_account: tx.sender_account,
            sender_name: tx.sender_name,
            transaction_date: tx.transaction_date,
            message: tx.message,
          },
        },
      );

      if (insertResult?.ok === false && insertResult?.reason === 'duplicate') {
        duplicates++;
        continue;
      }

      inserted++;

      // Auto-match by variable symbol
      if (tx.variable_symbol) {
        const matchResult = await rpcService<{ matched?: boolean; order_id?: string } | null>(
          'edge_bank_transactions',
          {
            p_action: 'auto_match_by_vs',
            p_payload: {
              variable_symbol: tx.variable_symbol,
              amount: tx.amount,
              currency: tx.currency,
            },
          },
        );

        if (matchResult?.matched) {
          autoMatched++;
          req.log.info({ vs: tx.variable_symbol, orderId: matchResult.order_id }, 'Auto-matched transaction');
        }
      }
    }

    // Audit log
    try {
      await rpcService('record_audit_log', {
        p_action: 'fio_bank.sync_completed',
        p_details: {
          from_date: fromDate,
          to_date: toDate,
          total_transactions: transactions.length,
          inserted,
          duplicates,
          auto_matched: autoMatched,
        },
        p_resource_id: null,
        p_resource_type: 'fio_bank',
        p_user_id: user.userId,
      });
    } catch (err) {
      req.log.warn({ err }, 'Failed to write audit log');
    }

    req.log.info({ total: transactions.length, inserted, duplicates, autoMatched }, 'Sync completed');

    return reply.send({
      ok: true,
      total: transactions.length,
      inserted,
      duplicates,
      auto_matched: autoMatched,
    });
  });
}
