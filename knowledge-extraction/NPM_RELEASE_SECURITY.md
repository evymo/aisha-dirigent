# NPM Release Security — Context And Principles

Tento dokument je portable knowledge artefakt pro AISHA orchestrace kolem npm publish workflow.

## Kontext vs Zasady

- Zasady: normativni pravidla (MUST/NEVER) patri do expert rules.
- Kontext: situacni fakta (scope, registry, release state) patri do knowledge items.
- Runtime heuristika AISHA rozhoduje, kdy pouzit kterou vrstvu.

## Minimalni bezpecnostni baseline

1. Pri podezreni na leak tokenu aplikuj rotate-first policy.
2. Pred publish vzdy udelat pack dry-run a scan obsahu tarballu.
3. Oddelit tokeny pro interni a public registry.
4. Zachovat audit trace o tom, proc byl zvolen dany rezim.

## Release gate order

1. Lint
2. Relevantni testy
3. Build
4. npm pack --dry-run
5. Secret scan artefaktu
6. Publish
7. Smoke install
8. Runtime verify

## Poznamka k autonomii

Konkretni keywordy, vahy ani thresholdy zde nejsou hardcoded. Tyto parametry se maji ladit dynamicky podle trace/eval dat backendu a modelu.
