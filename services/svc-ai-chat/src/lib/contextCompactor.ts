/**
 * impl 03 (odysseus) — history compaction glue.
 *
 * Thin orchestration over the pure budget math (contextBudget.ts): when the
 * conversation history crosses ai_runtime.compact_threshold × budget, the old
 * turns are summarized into one provenance-labeled block and the recent tail
 * stays verbatim. The summarize callback is INJECTED — the caller resolves it
 * through the governed `chat.history_compaction` purpose
 * (aisha_resolve_clow_backend via resolveDefaultModel + unifiedChat), so no
 * new LLM path exists and no model is hardcoded (impl/08 §3.6).
 *
 * Failure policy: compaction must NEVER take the chat down. A summarizer
 * error/empty result degrades to a plain oldest-first budget trim
 * (enforceHistoryBudget) — the same shape today's behavior would produce
 * under a hard cap.
 */
import {
  type ChatHistoryMessage,
  enforceHistoryBudget,
  estimateMessagesTokens,
  shouldCompactHistory,
} from "./contextBudget.js";

/** Provenance label for the compacted block (prompt-boundary friendly). */
export const COMPACTION_SUMMARY_PREFIX = "[Earlier conversation summary — compacted]";

export interface CompactionCfg {
  /** ai_runtime.compact_threshold */
  compactThreshold: number;
  /** ai_runtime.compact_keep_last_turns */
  compactKeepLastTurns: number;
  /** ai_runtime.compact_summary_max_tokens */
  compactSummaryMaxTokens: number;
}

export interface CompactHistoryArgs {
  history: ReadonlyArray<ChatHistoryMessage>;
  /** null = unknown window = parity (no compaction, no trim). */
  budgetTokens: number | null;
  cfg: CompactionCfg;
  /**
   * Governed summarizer (chat.history_compaction purpose). Receives the head
   * (older turns) and the summary token cap; returns the summary text.
   */
  summarize: (head: ChatHistoryMessage[], maxSummaryTokens: number) => Promise<string>;
}

export interface CompactHistoryResult {
  history: ChatHistoryMessage[];
  compacted: boolean;
  /** true when the summarizer failed/was empty and a plain trim was used. */
  fallback: boolean;
  tokensBefore: number;
  tokensAfter: number;
}

export async function compactHistoryIfNeeded(args: CompactHistoryArgs): Promise<CompactHistoryResult> {
  const { history, budgetTokens, cfg, summarize } = args;
  const all = [...history];
  const tokensBefore = estimateMessagesTokens(all);
  const identity: CompactHistoryResult = {
    history: all,
    compacted: false,
    fallback: false,
    tokensBefore,
    tokensAfter: tokensBefore,
  };

  if (!shouldCompactHistory({ historyTokens: tokensBefore, budgetTokens, threshold: cfg.compactThreshold })) {
    return identity;
  }

  const keep = Math.max(1, cfg.compactKeepLastTurns);
  if (all.length <= keep) return identity; // nothing older than the live tail

  const head = all.slice(0, all.length - keep);
  const tail = all.slice(all.length - keep);

  let summaryText = "";
  try {
    summaryText = (await summarize(head, cfg.compactSummaryMaxTokens))?.trim() ?? "";
  } catch {
    summaryText = "";
  }

  if (summaryText.length === 0) {
    // Graceful degradation: budget-trim without a summary (never throw).
    const trimmed = enforceHistoryBudget({ history: all, budgetTokens, keepLastTurns: keep });
    return {
      history: trimmed.kept,
      compacted: trimmed.droppedCount > 0,
      fallback: true,
      tokensBefore,
      tokensAfter: estimateMessagesTokens(trimmed.kept),
    };
  }

  let compacted: ChatHistoryMessage[] = [
    { role: "assistant", content: `${COMPACTION_SUMMARY_PREFIX}: ${summaryText}` },
    ...tail,
  ];

  // Post-summary safety: if even the compacted form exceeds the budget,
  // apply the hard budget enforcement on top (keeps the tail verbatim).
  const afterTokens = estimateMessagesTokens(compacted);
  if (budgetTokens !== null && afterTokens > budgetTokens) {
    compacted = enforceHistoryBudget({ history: compacted, budgetTokens, keepLastTurns: keep }).kept;
  }

  return {
    history: compacted,
    compacted: true,
    fallback: false,
    tokensBefore,
    tokensAfter: estimateMessagesTokens(compacted),
  };
}
