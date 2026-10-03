# Knowledge Loop SLA

Operationalni standard pro dual knowledge loop:
- ingest -> index -> retrieval usage -> quality feedback -> gap detection -> correction/reindex.

## Freshness SLA
- P0 knowledge (security/compliance/routing): max age 24h
- P1 knowledge (engineering patterns): max age 72h
- P2 knowledge (reference/background): max age 7 dni

## Decay policy
- Chunk bez retrieval hitu 30 dni: oznacit jako stale candidate
- Chunk bez retrieval hitu 90 dni: archivacni review
- Chunk s opakovanym low-score: kandidat na rewrite nebo split

## Reindex policy
- Trigger reindex:
  - zmena schema nebo expert rules,
  - drift score > threshold,
  - incident post-mortem update.
- SLA pro reindex:
  - kriticke zmeny do 24h,
  - bezne zmeny do 72h.

## Retrieval utility metrics
- hit_quality_rate >= 0.70
- chunk_usefulness_score >= 0.65
- false_positive_rate <= 0.20
- false_negative_rate <= 0.15

## Quality feedback loop
- Zdroj: Langfuse traces + verifier signal + human review
- Akce:
  - annotate low quality retrieval,
  - trigger correction task,
  - potvrdit propagaci do production KB.

## Ownership
- primary owner: ai-platform
- secondary owner: guild-of-experts
- escalation: security/compliance pokud knowledge error zpusobi policy breach
