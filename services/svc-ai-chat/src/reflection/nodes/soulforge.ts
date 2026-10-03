import type { NodeHandler } from '../types.js';
import { rpc } from '../postgrest.js';
import { reflectionConfig as config } from '../config.js';
import { classifyTaskSlot } from '../soulforge.js';

/**
 * soulforge_classify — classify the task into a slot (spark/ember/verify/...).
 * Sets state.slot which downstream generator + critic nodes pick up.
 *
 * DB-side mirror of taskSlotRouter.ts heuristic.
 */
export const soulforgeClassify: NodeHandler = async (ctx) => {
  if (!config.enableSoulforge) {
    return {
      output_data: { skipped: 'soulforge_disabled', slot: 'default' },
      state_patch: { slot: 'default' },
      transition_key: 'classified',
    };
  }

  const task = (ctx.run.metadata.input ?? {}) as Record<string, unknown>;
  const description = String(task.description ?? '');

  // Primary path: in-process heuristic classifier (~1ms).
  const local = classifyTaskSlot(description);

  // Optional refinement via RPC for low-confidence cases. Soft-fails:
  // the RPC may not exist in older deployments — local result wins anyway.
  if (local.confidence < 0.6) {
    try {
      const result = await rpc<{ slot: string; confidence: number }>('recommend_slot_for_task', {
        p_message: description,
        p_context: {},
      });
      if (result?.confidence && result.confidence > local.confidence) {
        return {
          output_data: { slot: result.slot, confidence: result.confidence, source: 'rpc' },
          state_patch: { slot: result.slot, slot_confidence: result.confidence },
          transition_key: 'classified',
        };
      }
    } catch {
      // RPC not available; keep local result
    }
  }

  return {
    output_data: { slot: local.slot, confidence: local.confidence, source: local.reason },
    state_patch: { slot: local.slot, slot_confidence: local.confidence },
    transition_key: 'classified',
  };
};

/**
 * soulforge_optimize — payload token reduction (context compression,
 * history dedup, tool output truncation).
 *
 * For MVP this is an inline implementation. Future iterations may delegate
 * to the Soulforge SDK if available.
 */
export const soulforgeOptimize: NodeHandler = async (ctx) => {
  const cfg = ctx.node.config;
  const maxHistoryChars = (cfg.max_history_chars as number) ?? 8000;
  const slot = (ctx.state.slot as string) ?? 'default';

  const composed = ctx.state.composed_context as Record<string, unknown> | undefined;
  if (!composed) {
    return {
      output_data: { skipped: 'no_composed_context' },
      transition_key: 'optimized',
    };
  }

  // Compute size-before for visibility
  const sizeBefore = JSON.stringify(composed).length;

  // Slot-specific shaping
  const optimized = { ...composed };
  const layers = (optimized.layers ?? {}) as Record<string, unknown>;

  // For spark slot, drop heavy KB chunks (exploration doesn't need full bodies)
  if (slot === 'spark' && layers.kb_retrieval) {
    const kb = layers.kb_retrieval as { chunks?: Array<Record<string, unknown>> };
    if (kb.chunks) {
      kb.chunks = kb.chunks.slice(0, 3).map((c) => ({
        title: c.title,
        score: c.score,
        snippet: typeof c.chunk_text === 'string' ? (c.chunk_text as string).slice(0, 200) : '',
      }));
    }
  }

  // For ember/verify, keep KB but truncate chunk bodies
  if (['ember', 'verify', 'semantic'].includes(slot) && layers.kb_retrieval) {
    const kb = layers.kb_retrieval as { chunks?: Array<Record<string, unknown>> };
    if (kb.chunks) {
      kb.chunks = kb.chunks.map((c) => ({
        ...c,
        chunk_text:
          typeof c.chunk_text === 'string'
            ? (c.chunk_text as string).slice(0, Math.floor(maxHistoryChars / kb.chunks!.length))
            : c.chunk_text,
      }));
    }
  }

  const sizeAfter = JSON.stringify(optimized).length;
  const reduction = sizeBefore > 0 ? (sizeBefore - sizeAfter) / sizeBefore : 0;

  return {
    output_data: {
      size_before: sizeBefore,
      size_after: sizeAfter,
      reduction_pct: Math.round(reduction * 100),
      slot,
    },
    state_patch: { composed_context: optimized },
    transition_key: 'optimized',
  };
};
