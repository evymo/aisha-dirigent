/**
 * Chyba z RPC → zapsaná do logu a vyhozená jako `Error`.
 *
 * ⭐ Bydlí zvlášť, protože ji potřebuje každý hook a jako kopie se rozejde:
 *    `safeError` sám vrací `void`, takže `throw safeError(...)` hodí
 *    `undefined` — react-query pak hlásí chybu bez příčiny a v terénu se to
 *    projeví jako „něco selhalo" bez jediného vodítka. Ta past je tichá právě
 *    proto, že typ `void` se do `throw` vejde.
 */
import { safeError } from "@/lib/security/safeLogger";

export function asError(scope: string, error: unknown): Error {
  safeError(scope, error);
  return error instanceof Error
    ? error
    : new Error(String((error as { message?: string } | null)?.message ?? error));
}
