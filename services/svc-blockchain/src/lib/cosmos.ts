import { config } from '../config.js';
import { DirectSecp256k1HdWallet, type EncodeObject } from '@cosmjs/proto-signing';
import { SigningStargateClient, GasPrice, type DeliverTxResponse, type StdFee } from '@cosmjs/stargate';

/**
 * Cosmos chain helpers — REAL signed MsgSend / MsgVote broadcast via cosmjs.
 *
 * Previously these built UNSIGNED txs (empty auth_info.signer_infos + empty signatures) and
 * POSTed them to the LCD /cosmos/tx/v1beta1/txs endpoint. A real chain rejects them at
 * signature verification (code 4 "unauthorized: signature verification failed"), so the
 * reward-claim + ledger-sync on-chain transfer paths never actually moved tokens.
 *
 * Now: derive the signer from COSMOS_SIGNER_MNEMONIC, connect a SigningStargateClient to the
 * Tendermint RPC (the LCD /txs path cannot sign), and sign+broadcast for real. The
 * caller-facing BroadcastResult shape is UNCHANGED, so the circuit-breaker / idempotency /
 * retry-exhaustion logic in ledger-sync.ts stays untouched.
 */

const COSMOS_REST = config.cosmosRestUrl;

/** Check if the Cosmos node is healthy (not syncing). REST LCD — no signing needed. */
export async function checkCosmosHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${COSMOS_REST}/cosmos/base/tendermint/v1beta1/syncing`, {
      signal: AbortSignal.timeout(config.circuitBreakerTimeoutMs),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { syncing?: boolean };
    return data?.syncing === false;
  } catch {
    return false;
  }
}

export interface BroadcastResult {
  success: boolean;
  txHash: string;
  error?: string;
}

/** Fixed fee — 5000 uash at gas 200000 ≥ the chain's MINIMUM_GAS_PRICES (0.025uash). */
const TX_FEE: StdFee = {
  amount: [{ denom: config.cosmosGasDenom, amount: '5000' }],
  gas: '200000',
};

// Lazy singleton signer + client: connect to the RPC once, reuse across broadcasts. cosmjs
// fetches the signer's account number/sequence per signed tx, so sequential broadcasts are
// safe. A failed connect resets the cache so the next call retries (the chain may be briefly
// unreachable) rather than wedging the signer forever.
let signerPromise: Promise<{ client: SigningStargateClient; address: string }> | null = null;
async function getSigner(): Promise<{ client: SigningStargateClient; address: string }> {
  if (!config.cosmosSignerMnemonic) {
    throw new Error('COSMOS_SIGNER_MNEMONIC is not configured — cannot sign an on-chain transaction');
  }
  if (!signerPromise) {
    signerPromise = (async () => {
      const wallet = await DirectSecp256k1HdWallet.fromMnemonic(config.cosmosSignerMnemonic, {
        prefix: config.cosmosAddressPrefix,
      });
      const [account] = await wallet.getAccounts();
      const client = await SigningStargateClient.connectWithSigner(config.cosmosRpcUrl, wallet, {
        gasPrice: GasPrice.fromString(`0.025${config.cosmosGasDenom}`),
      });
      return { client, address: account.address };
    })().catch((err) => {
      signerPromise = null;
      throw err;
    });
  }
  return signerPromise;
}

/** Reset the cached signer/client (test hook + recovery after a config/key rotation). */
export function resetCosmosSigner(): void {
  signerPromise = null;
}

function toResult(res: DeliverTxResponse): BroadcastResult {
  if (res.code !== 0) {
    return { success: false, txHash: res.transactionHash, error: res.rawLog ?? `tx failed with code ${res.code}` };
  }
  return { success: true, txHash: res.transactionHash };
}

/** Broadcast a SIGNED MsgSend token transfer (signed by COSMOS_SIGNER_MNEMONIC). */
export async function broadcastMsgSend(params: {
  fromAddress: string;
  toAddress: string;
  amount: string;
  denom: string;
  memo: string;
}): Promise<BroadcastResult> {
  try {
    const { client, address } = await getSigner();
    // The mnemonic-derived account is the authoritative signer/sender. Reject a from_address
    // that isn't it — we cannot sign on behalf of another account (would fail verification).
    if (params.fromAddress && params.fromAddress !== address) {
      return { success: false, txHash: '', error: `from_address ${params.fromAddress} is not the signer ${address}` };
    }
    const res = await client.sendTokens(
      address,
      params.toAddress,
      [{ denom: params.denom, amount: params.amount }],
      TX_FEE,
      params.memo,
    );
    return toResult(res);
  } catch (err) {
    return { success: false, txHash: '', error: err instanceof Error ? err.message : 'sign/broadcast error' };
  }
}

/**
 * Broadcast a SIGNED MsgVote, cast by the service signer account. A vote must be signed by
 * the voter, and the service only holds its own key, so the on-chain voter is the service
 * signer (not an arbitrary `voter` arg — we cannot sign for someone else's address).
 */
export async function broadcastVote(params: {
  proposalId: string;
  voteOption: number;
  voter: string;
}): Promise<BroadcastResult> {
  try {
    const { client, address } = await getSigner();
    const msg: EncodeObject = {
      typeUrl: '/cosmos.gov.v1beta1.MsgVote',
      value: { proposalId: BigInt(params.proposalId), voter: address, option: params.voteOption },
    };
    const res = await client.signAndBroadcast(address, [msg], TX_FEE, `Vote by ${address.slice(0, 12)}…`);
    return toResult(res);
  } catch (err) {
    return { success: false, txHash: '', error: err instanceof Error ? err.message : 'sign/broadcast error' };
  }
}
