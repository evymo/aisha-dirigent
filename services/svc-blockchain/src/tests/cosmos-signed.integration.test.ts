import { describe, it, expect } from 'vitest';

/**
 * SIGNED on-chain broadcast — integration test against the internal single-validator chain.
 *
 * The old cosmos.ts built UNSIGNED txs (empty signer_infos + signatures); a real chain
 * rejects them, so this proves the cosmjs signing path is actually accepted on-chain.
 *
 * Runs ONLY when a reachable chain + funded signer are provided via env:
 *   COSMOS_RPC_URL          Tendermint RPC of the single-validator chain
 *                           (container 26657; no host port is published — reach it
 *                            through a tunnel/port-forward you open yourself)
 *   COSMOS_SIGNER_MNEMONIC  the genesis-funded signer (the chain funds this account)
 * Without them it self-skips (so a bare `vitest` / unit run needs no chain). The
 * COSMOS_INTEGRATION=1 lane FAILS LOUD if the env is missing — a mis-wired lane must not
 * paint hollow-green (same contract as the PostgREST blockchain integration test).
 *
 * Run locally against a live chain:
 *   COSMOS_INTEGRATION=1 COSMOS_RPC_URL=http://127.0.0.1:<forwarded port> \
 *   COSMOS_SIGNER_MNEMONIC="…" npm run test:integration:cosmos
 */

const RPC = process.env.COSMOS_RPC_URL;
const MNEMONIC = process.env.COSMOS_SIGNER_MNEMONIC;
const PREFIX = process.env.COSMOS_ADDRESS_PREFIX ?? 'cosmos';
const DENOM = process.env.COSMOS_GAS_DENOM ?? 'uash';
const ON = !!RPC && !!MNEMONIC;

if (process.env.COSMOS_INTEGRATION === '1' && !ON) {
  throw new Error(
    'COSMOS_INTEGRATION=1 but COSMOS_RPC_URL / COSMOS_SIGNER_MNEMONIC are unset — the cosmos ' +
      'integration lane is mis-wired (needs a reachable single-validator chain + funded signer). ' +
      'Refusing to silently self-skip.',
  );
}

const RUN = ON ? describe : describe.skip;

RUN('Cosmos SIGNED on-chain broadcast (real single-validator chain)', () => {
  it('broadcastMsgSend SIGNS with the mnemonic and the chain ACCEPTS it (code 0, real txHash)', async () => {
    const { broadcastMsgSend, resetCosmosSigner } = await import('../lib/cosmos.js');
    const { DirectSecp256k1HdWallet } = await import('@cosmjs/proto-signing');
    resetCosmosSigner();

    // The signer is the genesis-funded account; send to a throwaway recipient.
    const signer = await DirectSecp256k1HdWallet.fromMnemonic(MNEMONIC!, { prefix: PREFIX });
    const [acct] = await signer.getAccounts();
    const recipient = await DirectSecp256k1HdWallet.generate(12, { prefix: PREFIX });
    const [to] = await recipient.getAccounts();

    const res = await broadcastMsgSend({
      fromAddress: acct.address,
      toAddress: to.address,
      amount: '1000',
      denom: DENOM,
      memo: 'svc-blockchain signed integration test',
    });

    // The OLD unsigned path returned code 4 (signature verification failed); the SIGNED path
    // must be accepted — a real 64-hex tx hash, no error.
    expect(res.error, res.error).toBeUndefined();
    expect(res.success).toBe(true);
    expect(res.txHash).toMatch(/^[0-9A-Fa-f]{64}$/);
  }, 30_000);

  it('rejects a from_address that is not the signer (cannot sign for another account)', async () => {
    const { broadcastMsgSend, resetCosmosSigner } = await import('../lib/cosmos.js');
    resetCosmosSigner();
    const res = await broadcastMsgSend({
      fromAddress: `${PREFIX}1notthesigneraccount00000000000000000000`,
      toAddress: `${PREFIX}1recipient000000000000000000000000000000`,
      amount: '1',
      denom: DENOM,
      memo: 'x',
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not the signer/);
  });
});
