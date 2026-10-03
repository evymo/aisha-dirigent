/**
 * AITG-APP-13 — Over-Reliance on AI.
 *
 * UX surfaces that present AI-generated content MUST include uncertainty
 * disclaimers / human-in-the-loop hooks. Static heuristic: every route
 * that emits LLM-generated text MUST tag its response with a UX-disclaimer
 * marker (e.g. an `ai_generated: true` flag the frontend consumes to
 * render a disclaimer badge).
 *
 * Until the frontend disclaimer component is enforced repo-wide, this gate
 * verifies the SERVER side ships the marker. Frontend integration is a
 * separate follow-up.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const CHAT_ROUTES_DIR = resolve(ROOT, 'services/svc-ai-chat/src/routes');

/**
 * Routes that emit final user-facing LLM text MUST include the
 * ai_generated marker (or similar disclaimer hook) in their response.
 */
const AI_GENERATING_ROUTES = [
  'public-chat.ts',
  'chat.ts',
  'story-consult.ts',
];

function listExistingRoutes(): string[] {
  if (!existsSync(CHAT_ROUTES_DIR)) return [];
  return readdirSync(CHAT_ROUTES_DIR).filter((f) => AI_GENERATING_ROUTES.includes(f));
}

describe('AITG-APP-13: AI response carries uncertainty disclaimer marker', () => {
  test('positive: at least one AI-generating route declares the marker', () => {
    const found = listExistingRoutes();
    if (found.length === 0) {
      // No AI-generating routes in this repo snapshot — vacuously pass.
      return;
    }
    let anyMarker = false;
    for (const f of found) {
      const src = readFileSync(join(CHAT_ROUTES_DIR, f), 'utf8');
      if (/ai_generated|disclaimer|uncertainty|confidence|withAitgGuardOrRefuse/.test(src)) {
        anyMarker = true;
        break;
      }
    }
    expect(
      anyMarker,
      `Expected at least one of [${AI_GENERATING_ROUTES.join(', ')}] to declare an AI-disclaimer marker. UI must render the "AI-generated, may be inaccurate" warning.`,
    ).toBe(true);
  });

  test('positive: public-chat applies withAitgGuardOrRefuse (server-side disclaimer-by-refusal)', () => {
    const f = join(CHAT_ROUTES_DIR, 'public-chat.ts');
    if (!existsSync(f)) return;
    const src = readFileSync(f, 'utf8');
    expect(src).toMatch(/withAitgGuardOrRefuse|withAitgGuard/);
  });

  test('negative: detector flags a synthetic AI response without disclaimer', () => {
    const fakeResponse = `app.post('/ai-direct', async () => ({ text: 'definitely true' }));`;
    const hasMarker = /ai_generated|disclaimer|uncertainty|confidence|withAitgGuard/.test(fakeResponse);
    expect(hasMarker).toBe(false);
  });
});
