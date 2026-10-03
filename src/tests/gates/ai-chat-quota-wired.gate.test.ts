/**
 * Gate: svc-ai-chat consumes the per-user LLM quota before dispatch.
 *
 * fn_check_and_consume_llm_quota_audited existed as SoT but had NO runtime caller
 * (wp-2-3 locks the SQL; nothing enforced it). Without a consumer a free member's AI
 * spend is unbounded. This locks the /chat handler as that consumer: it must call the
 * quota RPC on the user-scoped client and deny with 429 when the budget is exhausted.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const CHAT = fs.readFileSync(path.join(ROOT, 'services/svc-ai-chat/src/routes/chat.ts'), 'utf8');

describe('ai-chat LLM quota wiring', () => {
  it('calls fn_check_and_consume_llm_quota_audited on the user-scoped client', () => {
    expect(CHAT).toMatch(/pgrestUser\.rpc\(\s*['"]fn_check_and_consume_llm_quota_audited['"]/);
  });

  it('passes the caller id + a pre-call token & cost estimate', () => {
    expect(CHAT).toMatch(/p_user_id:\s*userId/);
    expect(CHAT).toMatch(/p_tokens:/);
    expect(CHAT).toMatch(/p_cost:/);
  });

  it('denies with 429 when the quota is exhausted', () => {
    expect(CHAT).toMatch(/allowed === false/);
    expect(CHAT).toMatch(/status:\s*429/);
    expect(CHAT).toMatch(/quota_exceeded/);
  });
});
