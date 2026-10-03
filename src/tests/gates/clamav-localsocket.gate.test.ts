/**
 * Gate: clamd must expose a LocalSocket (clamav image entrypoint requirement)
 *
 * The clamav/clamav image's /init entrypoint polls `[ -S /run/clamav/clamd.sock ]`
 * (or /tmp/clamd.sock) to confirm clamd started; on a TCP-only config the socket
 * file never appears, so /init times out after its 1800s wait, prints "Failed to
 * start clamd", and exits — restarting the container on an EXACT 30-minute cycle
 * (the live clamav flap, verified via captured `die` events 2026-06-30). clamd
 * serves both sockets at once: keep TCPSocket 3310 for the av-scan clients AND
 * LocalSocket for the image's lifecycle management.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const clamdConf = readFileSync(join(ROOT, "infra/clamav/clamd.conf"), "utf-8");

describe("clamd.conf socket configuration", () => {
  test("declares a LocalSocket at the path the clamav image entrypoint polls", () => {
    // /init checks /run/clamav/clamd.sock first, then /tmp/clamd.sock
    expect(clamdConf).toMatch(/^LocalSocket\s+\/run\/clamav\/clamd\.sock\s*$/m);
  });

  test("keeps the TCP socket for the av-scan client lib (sibling containers)", () => {
    expect(clamdConf).toMatch(/^TCPSocket\s+3310\s*$/m);
  });
});
