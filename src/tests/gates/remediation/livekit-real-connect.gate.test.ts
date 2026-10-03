/**
 * REMEDIATION GATE — M4: consultation call hooks must connect a REAL LiveKit Room.
 *
 * CONTRACT
 * ────────
 * The video-consultation call hooks are supposed to establish an actual
 * real-time media session. That means each hook MUST:
 *
 *   1. Import the LiveKit client SDK
 *        - web    → `livekit-client`
 *        - mobile → `@livekit/react-native`  (may also pull `livekit-client`)
 *   2. Actually create/connect a Room — `new Room(...)` and/or `room.connect(...)`.
 *   3. Transition `status: "connected"` ONLY in response to the Room's
 *      `connected` lifecycle event (e.g. `RoomEvent.Connected` /
 *      `room.on("connected", …)`), NOT synchronously right after the
 *      `create-livekit-token` fetch resolves.
 *
 * KNOWN-RED (HEAD, feat/remediation era)
 * ──────────────────────────────────────
 * Both hooks are simulations: they fetch a LiveKit JWT, then immediately
 * flip `status: "connected"` (and drive a wall-clock ringing timer) without
 * ever importing the LiveKit SDK or connecting a Room. No media is exchanged.
 *
 * Expected: RED with 2 instances flagged. A real fix (import SDK + connect Room
 * + set connected on the Room event) turns this green.
 *
 * This is a PATTERN gate: it walks a fixed, documented set of call-hook files
 * so that any NEW consultation-call hook added later is also held to the
 * contract (extend TARGETS below).
 *
 * Run:
 *   AISHA_SKIP_ONLINE=1 npx vitest run --config vitest.gates.config.ts \
 *     src/tests/gates/remediation/livekit-real-connect.gate.test.ts
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../../..");

/**
 * Documented target set. Every consultation-call hook must live here and must
 * satisfy the real-LiveKit-connect contract. Add new hooks as they appear.
 */
const TARGETS = [
  {
    file: "src/hooks/useConsultationCall.ts",
    platform: "web" as const,
    sdkImport: /from\s+["']livekit-client["']/,
  },
  {
    file: "mobile-app/src/hooks/useConsultationCall.ts",
    platform: "mobile" as const,
    // mobile may import the RN wrapper and/or the core client
    sdkImport: /from\s+["'](?:@livekit\/react-native|livekit-client)["']/,
  },
];

interface Violation {
  file: string;
  reasons: string[];
}

/** Strip line/block comments so commented-out code can't satisfy the contract. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function analyze(target: (typeof TARGETS)[number]): Violation | null {
  const abs = path.join(REPO_ROOT, target.file);
  if (!existsSync(abs)) {
    // Missing file is itself a contract violation — a call hook must exist.
    return { file: target.file, reasons: ["file does not exist"] };
  }

  const raw = readFileSync(abs, "utf8");
  const code = stripComments(raw);
  const reasons: string[] = [];

  // (1) SDK import present?
  if (!target.sdkImport.test(code)) {
    reasons.push(
      `does not import the LiveKit SDK (${target.platform === "mobile" ? "@livekit/react-native / livekit-client" : "livekit-client"})`,
    );
  }

  // (2) Real Room + connect?
  const hasRoom = /\bnew\s+Room\b/.test(code);
  const hasConnect = /\.connect\s*\(/.test(code);
  if (!hasRoom && !hasConnect) {
    reasons.push("never constructs a Room (`new Room`) nor calls `.connect()`");
  } else if (!hasConnect) {
    reasons.push("constructs a Room but never calls `room.connect()`");
  }

  // (3) `status: "connected"` must be gated on the Room 'connected' event,
  //     not set synchronously after the token fetch.
  const setsConnected = /status:\s*["']connected["']/.test(code);
  const hasConnectedEvent =
    /RoomEvent\.Connected\b/.test(code) ||
    /\.on\s*\(\s*["']connected["']/.test(code) ||
    /\.on\s*\(\s*RoomEvent\.Connected/.test(code);

  if (setsConnected && !hasConnectedEvent) {
    reasons.push(
      "sets `status: \"connected\"` without a Room 'connected' event handler " +
        "(RoomEvent.Connected / room.on('connected', …)) — i.e. it fakes the " +
        "connected state right after fetching the token",
    );
  }

  return reasons.length > 0 ? { file: target.file, reasons } : null;
}

describe("REMEDIATION M4 — consultation call hooks connect a real LiveKit Room", () => {
  it("every consultation-call hook imports the LiveKit SDK, connects a Room, and only becomes 'connected' on the Room event", () => {
    const violations = TARGETS.map(analyze).filter(
      (v): v is Violation => v !== null,
    );

    if (violations.length > 0) {
      const report = violations
        .map((v) => `  • ${v.file}\n      - ${v.reasons.join("\n      - ")}`)
        .join("\n");
      throw new Error(
        `M4 CONTRACT VIOLATION — ${violations.length} consultation-call hook(s) simulate the ` +
          `LiveKit call instead of connecting a real Room:\n${report}\n\n` +
          `Each hook must import the LiveKit client SDK, create/connect a Room, and set ` +
          `status:"connected" only on the Room 'connected' event.`,
      );
    }

    expect(violations).toEqual([]);
  });
});
