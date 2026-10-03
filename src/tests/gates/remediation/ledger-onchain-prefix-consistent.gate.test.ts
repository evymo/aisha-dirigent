/**
 * Gate (remediation D1-ledger-onchain-prefix-consistent): the svc-blockchain
 * on-chain client MUST address the deployed Cosmos node with the SAME bech32
 * prefix the node was built with.
 *
 * Ground truth (the deployed node):
 *   Dockerfile.cosmos builds `FROM ghcr.io/cosmos/simapp:v0.54` — the STOCK
 *   Cosmos SDK simapp binary. simapp is compiled with the default SDK bech32
 *   account prefix `cosmos`, so every account/validator/recipient address on
 *   that chain is `cosmos1…`. cosmos/scripts/init-node.sh only RENAMES the
 *   binary to `aishad` and picks a chain-id/denom; it does NOT (and cannot,
 *   without recompiling) change the compiled-in bech32 prefix.
 *
 * The contract this gate enforces (D1 — REALIGN the service to the node):
 *   1. services/svc-blockchain/src/config.ts — the default `cosmosAddressPrefix`
 *      must be 'cosmos' (the signer account is derived from the mnemonic using
 *      this prefix in src/lib/cosmos.ts; a mismatched prefix derives a signer
 *      address that does not exist / cannot be funded on the cosmos1 chain).
 *   2. Every recipient-address validation regex in the routes (today only
 *      claim-reward.ts) must anchor on ^cosmos1, so the service accepts the
 *      addresses that actually exist on the deployed chain.
 *   3. Dockerfile.cosmos must still be the stock simapp image — this is the
 *      reason the prefix is `cosmos`. If someone swaps in a custom-prefix
 *      binary, this gate must be revisited (it fails loudly rather than
 *      silently drifting).
 *
 * Why it matters: with config prefix='aisha' + regex ^aisha1 the on-chain
 * MsgSend (claim-reward) and MsgVote (governance) paths cannot succeed — the
 * signer address is derived under the wrong prefix and the node rejects it,
 * and legitimate cosmos1 recipient addresses are rejected at the 400 guard.
 * The whole on-chain anchoring surface is inert.
 *
 * KNOWN-RED at authoring time (branch feat/service-build-fixes):
 *   - config.ts default cosmosAddressPrefix = 'aisha'
 *   - claim-reward.ts AISHA_ADDRESS_REGEX = /^aisha1.../
 * After the D1 realign (prefix -> 'cosmos', regex -> ^cosmos1) this gate goes
 * green. Do NOT change the assertions to match the buggy 'aisha1' state — fix
 * the service. Do NOT recompile a custom-prefix node to satisfy #1/#2; the
 * locked decision is to align to the deployed stock simapp (cosmos1).
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const CONFIG = "services/svc-blockchain/src/config.ts";
const CLAIM = "services/svc-blockchain/src/routes/claim-reward.ts";
const DOCKERFILE = "Dockerfile.cosmos";

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** Strip `//` and block comments so a commented-out mention doesn't pass. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

describe("D1: svc-blockchain on-chain prefix matches the deployed cosmos1 node", () => {
  test("Dockerfile.cosmos is the stock simapp image (source of the cosmos1 prefix)", () => {
    const src = read(DOCKERFILE);
    // The reason the correct prefix is `cosmos`: the deployed binary is stock
    // simapp, which is compiled with the default SDK bech32 prefix.
    expect(src).toMatch(/FROM\s+ghcr\.io\/cosmos\/simapp/);
  });

  test("config.ts default cosmosAddressPrefix is 'cosmos', not 'aisha'", () => {
    const code = stripComments(read(CONFIG));

    // Locate the `cosmosAddressPrefix: process.env.COSMOS_ADDRESS_PREFIX ?? '<x>'`
    // default. The default (fallback) literal is what a prod deploy without the
    // env override actually uses, and what src/lib/cosmos.ts derives the signer
    // from — so it is the value this gate pins.
    const m = code.match(
      /cosmosAddressPrefix\s*:\s*process\.env\.COSMOS_ADDRESS_PREFIX\s*\?\?\s*(['"])([^'"]+)\1/,
    );
    expect(
      m,
      "could not find cosmosAddressPrefix default literal in config.ts",
    ).not.toBeNull();

    const defaultPrefix = m![2];
    expect(
      defaultPrefix,
      `cosmosAddressPrefix default must be 'cosmos' to match the stock simapp (cosmos1) node; found '${defaultPrefix}'`,
    ).toBe("cosmos");
  });

  test("claim-reward.ts recipient-address regex anchors on ^cosmos1", () => {
    const code = stripComments(read(CLAIM));

    // Any address-validation regex in this file must start at the cosmos1
    // prefix. There must be NO regex anchored on ^aisha1 (the buggy state).
    expect(
      /\^aisha1/.test(code),
      "claim-reward.ts still validates ^aisha1 addresses; realign to ^cosmos1",
    ).toBe(false);

    expect(
      /\^cosmos1/.test(code),
      "claim-reward.ts must validate recipient addresses with a ^cosmos1-anchored regex",
    ).toBe(true);
  });
});
