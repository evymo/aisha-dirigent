/**
 * GATE: svc-ai-chat is runnable + host-exposable in the LOCAL dev stack with a
 * REAL serviceable pool — the prerequisite for verifying model selection/dispatch
 * in real conditions (owner: "musime byt schopni otestovat vse v realnych
 * podminkach"). Without this, svc-ai-chat is in no preset and its provider keys
 * are empty, so no selection lane can be exercised against the live stack.
 *
 * Asserts the local-presets wiring (string-read — robust in CI where .env-* files
 * are absent and importing the module would yield empty keys anyway).
 *
 * @module
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC = fs.readFileSync(path.join(process.cwd(), 'config/local-presets.mjs'), 'utf8');

describe('GATE: svc-ai-chat real-conditions testability', () => {
  it('a preset runs svc-ai-chat (optimum-ai apps include ai-chat)', () => {
    const m = SRC.match(/"optimum-ai":\s*\{[\s\S]*?apps:\s*\[([^\]]*)\]/);
    expect(m, 'optimum-ai preset must exist').toBeTruthy();
    expect(m![1]).toMatch(/["']ai-chat["']/);
  });

  it('the full preset also includes ai-chat', () => {
    const m = SRC.match(/\bfull:\s*\{[\s\S]*?apps:\s*\[([\s\S]*?)\]/);
    expect(m, 'full preset must exist').toBeTruthy();
    expect(m![1]).toMatch(/["']ai-chat["']/);
  });

  it('svc-ai-chat is host-exposable on :3011 (hostPorts entry)', () => {
    expect(SRC).toMatch(/svc\("aisha-svc-ai-chat",\s*\{\s*3011/);
  });

  it('host exposure is gated behind LOCAL_EXPOSE_AI_CHAT (internal-only by default)', () => {
    expect(SRC).toMatch(/EXPOSE_AI_CHAT[\s\S]{0,160}LOCAL_EXPOSE_AI_CHAT/);
    expect(SRC).toMatch(/svc\("aisha-svc-ai-chat",[\s\S]{0,80}EXPOSE_AI_CHAT\)/);
  });

  it('provider keys are SOURCED (shell → .env.coolify → .env-prod-backup), not process.env-only', () => {
    expect(SRC).toMatch(/resolveLlmProviderKey\(["']OPENAI_API_KEY["']\)/);
    expect(SRC).toMatch(/resolveLlmProviderKey\(["']ANTHROPIC_API_KEY["']\)/);
    expect(SRC).toMatch(/resolveLlmProviderKey\(["']GOOGLE_AI_API_KEY["']\)/);
    expect(SRC).toMatch(/\.env-prod-backup/);
    expect(SRC).toMatch(/\.env\.coolify/);
    // the old process.env-only pattern must be gone (it left the pool empty)
    expect(SRC, 'old process.env-only sourcing removed').not.toMatch(
      /OPENAI_API_KEY:\s*process\.env\.OPENAI_API_KEY\s*\|\|/,
    );
  });

  it('sourcing stays cold-start-parity safe (empty when no .env files present)', () => {
    // resolveLlmProviderKey ends in `|| ""` — never throws / never a hardcoded key
    expect(SRC).toMatch(/function resolveLlmProviderKey[\s\S]{0,200}\|\|\s*""/);
  });
});
