/**
 * Fio Bank Sync Edge Function
 *
 * Polls Fio banka API for new transactions and inserts them into
 * bank_transactions table. Supports auto-matching by variable symbol.
 *
 * Actions:
 *   - sync: Fetch new transactions from Fio API, insert + auto-match
 *   - status: Return last sync info
 *
 * Security: Requires admin/staff role or service_role key.
 */
import { serve, createClient } from "../_shared/deps.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Fio API base
const FIO_API_BASE = "https://www.fio.cz/ib_api/rest";

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[FIO-BANK-SYNC] ${step}${detailsStr}`);
};

/**
 * Get Fio API token from app_secrets table or env fallback.
 */
async function getFioApiToken(
  supabase: ReturnType<typeof createClient>,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("edge_app_secrets", {
    p_action: "get_many",
    p_payload: { keys: ["fio_bank_api_token"] },
  });

  const rows =
    (data as { rows?: Array<{ key?: unknown; value?: unknown }> } | null)
      ?.rows ?? [];

  if (!error && rows.length > 0) {
    for (const row of rows) {
      if (row.key === "fio_bank_api_token" && typeof row.value === "string") {
        return row.value;
      }
    }
  }

  // Env fallback
  return Deno.env.get("FIO_BANK_API_TOKEN") || null;
}

/**
 * Get Fio Bank settings from system_config.
 */
async function getFioBankSettings(
  supabase: ReturnType<typeof createClient>,
): Promise<{ enabled: boolean; check_interval_minutes: number }> {
  const { data } = await supabase.rpc("get_system_config", {
    p_key: "fio_bank",
  });

  if (
    data &&
    typeof data === "object" &&
    "enabled" in (data as Record<string, unknown>)
  ) {
    const cfg = data as Record<string, unknown>;
    return {
      enabled: cfg.enabled === true,
      check_interval_minutes:
        typeof cfg.check_interval_minutes === "number"
          ? cfg.check_interval_minutes
          : 30,
    };
  }

  return { enabled: false, check_interval_minutes: 30 };
}

interface FioTransaction {
  column22?: { value: number; name: string; id: number }; // ID pohybu
  column0?: { value: string; name: string; id: number }; // Datum
  column1?: { value: number; name: string; id: number }; // Objem
  column14?: { value: string; name: string; id: number }; // Měna
  column5?: { value: string; name: string; id: number }; // VS
  column2?: { value: string; name: string; id: number }; // Protiúčet
  column10?: { value: string; name: string; id: number }; // Název protiúčtu
  column7?: { value: string; name: string; id: number }; // Uživatelská identifikace
  column16?: { value: string; name: string; id: number }; // Zpráva pro příjemce
  column25?: { value: string; name: string; id: number }; // Komentář
}

function parseFioTransactions(
  apiResponse: Record<string, unknown>,
): Array<{
  fio_transaction_id: string;
  amount: number;
  currency: string;
  variable_symbol: string;
  sender_account: string;
  sender_name: string;
  transaction_date: string;
  message: string;
}> {
  const accountStatement = apiResponse?.accountStatement as
    | Record<string, unknown>
    | undefined;
  if (!accountStatement) return [];

  const transactionList = accountStatement.transactionList as
    | Record<string, unknown>
    | undefined;
  if (!transactionList) return [];

  const transactions = transactionList.transaction;
  if (!Array.isArray(transactions)) return [];

  return transactions
    .map((tx: FioTransaction) => {
      const txId = tx.column22?.value;
      const amount = tx.column1?.value;

      if (txId == null || amount == null) return null;

      // Only import credit (incoming) transactions
      if (amount <= 0) return null;

      const dateStr = tx.column0?.value || "";
      // Fio returns date as "YYYY-MM-DD+HHMM" or "YYYY-MM-DD"
      const isoDate = dateStr.split("+")[0] || dateStr;

      return {
        fio_transaction_id: String(txId),
        amount,
        currency: tx.column14?.value || "CZK",
        variable_symbol: tx.column5?.value || "",
        sender_account: tx.column2?.value || "",
        sender_name: tx.column10?.value || "",
        transaction_date: isoDate,
        message:
          tx.column16?.value || tx.column25?.value || tx.column7?.value || "",
      };
    })
    .filter(
      (
        tx,
      ): tx is {
        fio_transaction_id: string;
        amount: number;
        currency: string;
        variable_symbol: string;
        sender_account: string;
        sender_name: string;
        transaction_date: string;
        message: string;
      } => tx !== null,
    );
}

serve(async (req) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth check: must be service_role, admin, or staff
    const authHeader = req.headers.get("authorization");
    let isServiceRole = false;

    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");

      // If the token is the service role key, allow
      if (token === supabaseServiceKey) {
        isServiceRole = true;
      } else {
        // Verify JWT and check role
        const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const {
          data: { user },
        } = await userClient.auth.getUser();

        if (!user) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Check admin/staff role
        const { data: hasRole } = await supabase.rpc("has_role", {
          p_role: "admin",
          p_user_id: user.id,
        });
        const { data: hasStaffRole } = await supabase.rpc("has_role", {
          p_role: "staff",
          p_user_id: user.id,
        });

        if (!hasRole && !hasStaffRole) {
          return new Response(JSON.stringify({ error: "Forbidden" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
    } else {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const action = body?.action || "sync";

    // ─── STATUS ───
    if (action === "status") {
      const settings = await getFioBankSettings(supabase);
      const token = await getFioApiToken(supabase);

      return new Response(
        JSON.stringify({
          configured: !!token,
          enabled: settings.enabled,
          check_interval_minutes: settings.check_interval_minutes,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // ─── SYNC ───
    if (action === "sync") {
      const settings = await getFioBankSettings(supabase);

      if (!settings.enabled && !isServiceRole) {
        return new Response(
          JSON.stringify({
            ok: false,
            reason: "Fio bank sync is disabled",
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const fioToken = await getFioApiToken(supabase);
      if (!fioToken) {
        return new Response(
          JSON.stringify({
            ok: false,
            reason: "Fio API token not configured",
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // Determine date range — last 30 days by default, or custom range
      const fromDate =
        body?.from_date ||
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0];
      const toDate =
        body?.to_date || new Date().toISOString().split("T")[0];

      logStep("Fetching transactions", { fromDate, toDate });

      // Call Fio API — periods endpoint
      const fioUrl = `${FIO_API_BASE}/periods/${fioToken}/${fromDate}/${toDate}/transactions.json`;

      const fioResponse = await fetch(fioUrl, {
          signal: AbortSignal.timeout(15000),
        headers: { Accept: "application/json" },
      });

      if (!fioResponse.ok) {
        const errText = await fioResponse.text();
        logStep("Fio API error", {
          status: fioResponse.status,
          body: errText.substring(0, 200),
        });
        return new Response(
          JSON.stringify({
            ok: false,
            reason: `Fio API returned ${fioResponse.status}`,
          }),
          {
            status: 502,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const fioData = (await fioResponse.json()) as Record<string, unknown>;
      const transactions = parseFioTransactions(fioData);

      logStep("Parsed transactions", { count: transactions.length });

      let inserted = 0;
      let duplicates = 0;
      let autoMatched = 0;

      for (const tx of transactions) {
        // Insert transaction
        const { data: insertResult } = await supabase.rpc(
          "edge_bank_transactions",
          {
            p_action: "insert_transaction",
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

        const result = insertResult as { ok?: boolean; reason?: string } | null;

        if (result?.ok === false && result?.reason === "duplicate") {
          duplicates++;
          continue;
        }

        inserted++;

        // Auto-match by variable symbol if present
        if (tx.variable_symbol) {
          const { data: matchResult } = await supabase.rpc(
            "edge_bank_transactions",
            {
              p_action: "auto_match_by_vs",
              p_payload: {
                variable_symbol: tx.variable_symbol,
                amount: tx.amount,
                currency: tx.currency,
              },
            },
          );

          const matchRes = matchResult as {
            matched?: boolean;
            order_id?: string;
            status?: string;
          } | null;

          if (matchRes?.matched) {
            autoMatched++;
            logStep("Auto-matched transaction", {
              vs: tx.variable_symbol,
              order_id: matchRes.order_id,
            });
          }
        }
      }

      // Audit log
      await supabase.rpc("record_audit_log", {
        p_action: "fio_bank.sync_completed",
        p_details: {
          from_date: fromDate,
          to_date: toDate,
          total_transactions: transactions.length,
          inserted,
          duplicates,
          auto_matched: autoMatched,
        },
        p_resource_id: null,
        p_resource_type: "fio_bank",
        p_user_id: null,
      });

      logStep("Sync completed", {
        total: transactions.length,
        inserted,
        duplicates,
        autoMatched,
      });

      return new Response(
        JSON.stringify({
          ok: true,
          total: transactions.length,
          inserted,
          duplicates,
          auto_matched: autoMatched,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("[FIO-BANK-SYNC] Error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
});
