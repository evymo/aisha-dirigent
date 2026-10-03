/**
 * Derivation provenance (R3 / IP-7). Every transformation of an artefact is
 * marked derived with a reference to its source, so downstream consumers that
 * need precision read the ORIGINAL, not the paraphrase — noise cannot
 * accumulate because meaning is referenced, never re-encoded.
 */
import type { DerivationMethod } from '@aisha/acs-contracts';

export interface Provenance {
  derived: boolean;
  source_ref: string | null;
  method: DerivationMethod;
}

export const VERBATIM: Provenance = { derived: false, source_ref: null, method: null };

export function markDerived(sourceRef: string, method: Exclude<DerivationMethod, null>): Provenance {
  if (!sourceRef) throw new Error('acs-sdk: derived output requires a source_ref (R3)');
  return { derived: true, source_ref: sourceRef, method };
}

/** Wrap a transformation result together with its provenance. */
export interface Derived<T> {
  value: T;
  provenance: Provenance;
}

export function derive<T>(value: T, sourceRef: string, method: Exclude<DerivationMethod, null>): Derived<T> {
  return { value, provenance: markDerived(sourceRef, method) };
}
