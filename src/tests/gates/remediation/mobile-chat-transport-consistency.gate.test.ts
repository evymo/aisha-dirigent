/**
 * Gate (remediation M2 — mobile-chat-transport-consistency): the mobile AISHA
 * chat client and the svc-ai-chat server it calls MUST agree on the wire
 * transport. Either both speak SSE (server emits `text/event-stream`, client
 * reads a streamed body and parses `data:` frames) OR both speak plain JSON
 * (server returns a single JSON object, client parses one JSON body).
 *
 * Why this exists: mobile-app/src/hooks/useAishaChat.ts POSTs `stream: true`
 * to `${baseUrl}/functions/v1/ai-chat` and then consumes the reply as an SSE
 * stream — `response.body.getReader()`, TextDecoder, splitting on lines that
 * `startsWith("data: ")`, JSON-parsing each frame's payload. But the server
 * handler services/svc-ai-chat/src/routes/chat.ts returns EVERY response as a
 * single `Content-Type: application/json` object (success + all error paths)
 * and never sets `text/event-stream` nor writes `data:`-framed chunks. A JSON
 * body has no `data: ` line prefixes, so the client's frame loop matches
 * nothing and `fullContent` stays "" — the user sees an empty AISHA reply even
 * though the server produced a real answer. That is the RED mismatch.
 *
 * Contract enforced here (post-fix, order-independent):
 *     mobileClientSpeaksSSE  ===  serverEmitsSSE
 * A fix may land on EITHER side and turn this green:
 *   - make chat.ts stream (`text/event-stream` + `data:` frames), or
 *   - make useAishaChat.ts parse the single JSON object it actually receives.
 * Do NOT weaken this gate to match the buggy state — fix one side so the two
 * transports agree.
 *
 * KNOWN-RED at authoring time (branch feat/remediation): mobile sends
 * `stream: true` and parses `data:` SSE frames while chat.ts returns JSON only
 * → empty content. Expect RED.
 *
 * Scope note: this is a two-endpoint transport contract, not a tree-class
 * scan — the AISHA mobile chat lane has exactly ONE client/server pair. The
 * paths are resolved defensively (fail LOUD if either file moves) so the gate
 * cannot silently pass by reading nothing.
 */
import { describe, test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

const MOBILE_CLIENT = "mobile-app/src/hooks/useAishaChat.ts";
const SERVER_HANDLER = "services/svc-ai-chat/src/routes/chat.ts";

/** Strip `//` line comments and block comments so a commented-out mention
 *  (e.g. a doc that merely says "text/event-stream") never counts as a real
 *  transport signal. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

function readSource(rel: string): string {
  const abs = join(ROOT, rel);
  // Fail LOUD if the file moved — an absent file must not make the gate a no-op.
  expect(existsSync(abs), `expected file to exist: ${rel}`).toBe(true);
  return stripComments(readFileSync(abs, "utf-8"));
}

/**
 * The mobile client "speaks SSE" when it consumes the response as a streamed
 * body AND decodes `data:`-framed events — the shape produced only by a
 * text/event-stream server. Requiring BOTH signals (streamed read + frame
 * parsing) avoids a false positive from an unrelated `stream:` field.
 */
function mobileClientSpeaksSSE(src: string): boolean {
  const readsStreamBody = /\.body\??\.getReader\s*\(/.test(src);
  const parsesDataFrames = /startsWith\(\s*["']data:\s?["']\s*\)/.test(src);
  const requestsStream = /\bstream\s*:\s*true\b/.test(src);
  // Streamed-body read + data-frame parsing is the definitive SSE-consumer
  // signature; `stream: true` corroborates the intent.
  return readsStreamBody && parsesDataFrames && requestsStream;
}

/**
 * The server "emits SSE" when it advertises the event-stream content type.
 * A JSON-only handler (only `application/json` Content-Type, no event-stream)
 * returns false.
 */
function serverEmitsSSE(src: string): boolean {
  return /text\/event-stream/.test(src);
}

describe("mobile chat transport consistency (M2)", () => {
  test("mobile chat client and svc-ai-chat server agree on transport (both SSE or both JSON)", () => {
    const mobileSrc = readSource(MOBILE_CLIENT);
    const serverSrc = readSource(SERVER_HANDLER);

    const clientSSE = mobileClientSpeaksSSE(mobileSrc);
    const serverSSE = serverEmitsSSE(serverSrc);

    expect(
      clientSSE,
      `Transport mismatch between mobile client and server.\n` +
        `  mobile (${MOBILE_CLIENT}) speaks SSE: ${clientSSE}\n` +
        `  server (${SERVER_HANDLER}) emits SSE: ${serverSSE}\n` +
        `The client parses \`data:\` SSE frames while the server returns a ` +
        `single JSON object with no text/event-stream — the frame loop matches ` +
        `nothing and the reply renders empty. Fix ONE side so both transports ` +
        `agree (make the server stream, or make the client parse JSON).`,
    ).toBe(serverSSE);
  });
});
