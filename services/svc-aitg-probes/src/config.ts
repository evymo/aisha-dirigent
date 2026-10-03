/**
 * Povinná hodnota — nedosazuje se.
 *
 * ⛔ 2026-08-24: tenhle soubor dosazoval `http://postgrest:3000`,
 * `http://svc-ai-chat:3011` a prázdné tokeny, přestože jeho compose všechny
 * čtyři doručuje FAIL-CLOSED (`${VAR:?…}`). Dosazení tedy nikdy nevystřelilo —
 * a právě proto by se na něj přišlo až ve chvíli, kdy hodnota jednou chybět
 * bude: adresa bez prefixu instance trefí na sdíleném hostiteli cizí kontejner
 * a prázdný token vyrobí `Authorization: Bearer `, tedy selhání až za RLS.
 */
function vyzadovane(klic: string, proc: string): string {
  const v = process.env[klic];
  if (v && v.trim()) return v.trim();
  throw new Error(`${klic} není nastavená — odmítám dosadit. ${proc}`);
}

export const config = {
  port: parseInt(process.env.SVC_AITG_PROBES_PORT ?? '3041', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',

  /** PostgREST endpoint for aitg_record_run_audited + aitg_get_*. */
  postgrestUrl: vyzadovane('POSTGREST_URL', 'Dosazené `postgrest:3000` nenese prefix instance.'),
  postgrestServiceToken: vyzadovane('POSTGREST_SERVICE_TOKEN', 'Prázdný token = nepřihlášené volání, ne volání bez oprávnění.'),

  /** svc-ai-chat URL — probes dispatch LLM calls via this service so we share
   *  router / cost / Langfuse instrumentation with production traffic. */
  aiChatUrl: vyzadovane('AI_CHAT_SERVICE_URL', 'Dosazené `svc-ai-chat:3011` nenese prefix instance.'),
  aiChatToken: vyzadovane('AI_CHAT_SERVICE_TOKEN', 'Prázdný token = nepřihlášené volání.'),

  /** Build SHA stamped onto every aitg_runs row this service emits. */
  buildSha: process.env.GIT_SHA ?? 'dev',

  /** Default model used for probes when caller omits it. */
  defaultModel: process.env.AITG_DEFAULT_MODEL ?? 'gpt-4o-mini',

  // ── OWASP hardening (@aisha/security) ──
  corsAllowlist: process.env.CORS_ALLOWLIST ?? '',
  ssrfHostAllowlist:
    process.env.SSRF_HOST_ALLOWLIST ?? 'api.openai.com,api.anthropic.com,generativelanguage.googleapis.com',
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',
} as const;
