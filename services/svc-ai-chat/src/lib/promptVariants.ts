/**
 * Per-model prompt variants (odysseus G5).
 *
 * Anthropic's guidance: a few-shot prompt tuned on Sonnet can mislead Opus, so
 * heavily-few-shot prompts sometimes need a variant per model family. Rather than
 * standing up a new store, this reuses the registry's `model_family` concept
 * (ai_model_registry.model_family) and the established `*_template_versions`
 * pattern: a prompt has variants keyed by a coarse family bucket, and the resolver
 * picks the most specific match, broadening to a base family and finally to
 * `default`. A missing variant NEVER fails — it falls back to the default.
 *
 * Deploy variants only where behaviour actually differs (e.g. Sonnet→Opus
 * escalation of a few-shot-heavy prompt); everything else uses the single default.
 *
 * @module
 */

/** Coarse family buckets used to key prompt variants. */
export type ModelFamily =
  | 'anthropic-opus'
  | 'anthropic-sonnet'
  | 'anthropic-haiku'
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'local'
  | 'default';

/**
 * Derive a coarse family bucket from the registry `model_family` (preferred) or the
 * model id. Deterministic and total — always returns a bucket, never throws.
 */
export function deriveModelFamily(modelId: string | null | undefined, registryFamily?: string | null): ModelFamily {
  const hay = `${registryFamily ?? ''} ${modelId ?? ''}`.toLowerCase();
  if (!hay.trim()) return 'default';
  if (hay.includes('opus')) return 'anthropic-opus';
  if (hay.includes('sonnet')) return 'anthropic-sonnet';
  if (hay.includes('haiku')) return 'anthropic-haiku';
  if (hay.includes('claude') || hay.includes('anthropic')) return 'anthropic';
  if (hay.includes('gpt') || hay.includes('openai') || /\bo[13]\b/.test(hay)) return 'openai';
  if (hay.includes('gemini') || hay.includes('google')) return 'google';
  if (
    hay.includes('llama') ||
    hay.includes('mistral') ||
    hay.includes('qwen') ||
    hay.includes('ollama') ||
    hay.includes('local')
  ) {
    return 'local';
  }
  return 'default';
}

/**
 * The lookup chain for a family: most specific → base family → 'default'.
 * e.g. 'anthropic-opus' → ['anthropic-opus', 'anthropic', 'default'].
 */
export function familyLookupChain(family: ModelFamily): string[] {
  const chain: string[] = [family];
  const dash = family.indexOf('-');
  if (dash > 0) chain.push(family.slice(0, dash)); // 'anthropic-opus' -> 'anthropic'
  if (family !== 'default') chain.push('default');
  return [...new Set(chain)];
}

/** A prompt variant. `system` and/or `fewShot` differ per family; unset fields inherit. */
export interface PromptVariant<T = string> {
  system?: T;
  fewShot?: T;
}

/**
 * Select the best variant for `family` from a keyed map, broadening through the
 * lookup chain. Returns `undefined` only when the map has no usable entry at all —
 * the caller then uses its built-in default (the resolver never throws).
 *
 * `variants` keys are family strings ('anthropic-opus', 'anthropic', 'default', …).
 */
export function selectPromptVariant<T = string>(
  variants: Readonly<Record<string, PromptVariant<T>>> | null | undefined,
  family: ModelFamily,
): PromptVariant<T> | undefined {
  if (!variants) return undefined;
  for (const key of familyLookupChain(family)) {
    const v = variants[key];
    if (v && (v.system !== undefined || v.fewShot !== undefined)) return v;
  }
  // Last resort: an explicit 'default' key even if it wasn't in the chain order.
  return variants.default;
}

/**
 * Convenience: resolve a variant straight from a model id + registry family,
 * falling back to `fallback` (the code default) when no variant matches.
 */
export function resolvePromptForModel<T = string>(
  variants: Readonly<Record<string, PromptVariant<T>>> | null | undefined,
  modelId: string | null | undefined,
  registryFamily: string | null | undefined,
  fallback: PromptVariant<T>,
): PromptVariant<T> {
  const chosen = selectPromptVariant(variants, deriveModelFamily(modelId, registryFamily));
  if (!chosen) return fallback;
  // Inherit any unset field from the fallback so a partial variant is safe.
  return {
    system: chosen.system ?? fallback.system,
    fewShot: chosen.fewShot ?? fallback.fewShot,
  };
}
