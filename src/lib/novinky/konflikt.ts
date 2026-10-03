/**
 * Souběh dvou editorů: server odmítne zápis s neplatným razítkem (PT409 →
 * HTTP 409). Tady se to rozpozná z chyby RPC, ať přišla jako status, jako
 * SQLSTATE v `code`, nebo jen jako text — a hooky ji nesou dál i s kódem,
 * místo aby ji zploštily na `new Error(message)`.
 */
export class ChybaUlozeniClanku extends Error {
  constructor(message: string, public status?: number, public code?: string) {
    super(message);
    this.name = "ChybaUlozeniClanku";
  }
}

export function chybaZRpc(error: { message: string; status?: number; code?: string }): ChybaUlozeniClanku {
  return new ChybaUlozeniClanku(error.message, error.status, error.code);
}

export function jeKonfliktUlozeni(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; code?: string; message?: string };
  if (e.status === 409 || e.code === "PT409") return true;
  return /PT409|changed since it was loaded/i.test(e.message ?? "");
}
