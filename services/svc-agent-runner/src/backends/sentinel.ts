/**
 * Čtení výstupu sandboxového kontejneru: logové řádky a obálka `__result`.
 *
 * ⛔ 2026-09-16: tahle funkce existovala dvakrát (docker.ts, kata.ts), obě kopie
 * vytáhly z obálky jen `value` a `schedules`, které shim pluginu vydává
 * (deklarace rozvrhů z init()), zahodily. Host se tak o rozvrhu pluginu nikdy
 * nedozvěděl a cron capability se nespustila. Jedna implementace pro oba backendy.
 */

export interface LogLine {
  level: string;
  message: string;
  meta?: Record<string, unknown>;
}

/** Deklarace rozvrhu z shimu: v `cron` spustit `capability` (null = starý tvar s funkcí). */
export interface ScheduleDeclaration {
  cron: string;
  capability: string | null;
}

export function parseSentinelLogs(raw: string): { logs: LogLine[]; result: unknown; schedules: ScheduleDeclaration[] } {
  const logs: LogLine[] = [];
  let result: unknown = undefined;
  let schedules: ScheduleDeclaration[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed['__result'] === true) {
        result = parsed['value'];
        const dekl = parsed['schedules'];
        schedules = Array.isArray(dekl)
          ? dekl
              .filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null)
              .map((d) => ({ cron: String(d['cron'] ?? ''), capability: typeof d['capability'] === 'string' ? d['capability'] : null }))
          : [];
      } else if (parsed['level'] && parsed['message']) {
        logs.push({ level: String(parsed['level']), message: String(parsed['message']), meta: parsed['meta'] as Record<string, unknown> | undefined });
      }
    } catch {
      logs.push({ level: 'info', message: trimmed });
    }
  }
  return { logs, result, schedules };
}
