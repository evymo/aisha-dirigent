/**
 * Reference clean file (no violations). Specs assert this file does NOT
 * trigger any rule.
 */

import { rpcUser } from "@aisha/sdk";

export async function goodQuery(): Promise<unknown> {
  // RPC-only pattern, no any, no console, no @ts-ignore, no select('*')
  const result = await rpcUser<{ id: string }[]>("list_users", {});
  return result;
}
