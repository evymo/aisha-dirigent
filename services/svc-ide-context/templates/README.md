# svc-ide-context templates (Phase 13 WP 13.2)

Per-IDE instruction templates rendered via [Eta](https://eta.js.org/) engine.

## Layout

```
templates/
├── claude-code/instructions.eta   → text/markdown (CLAUDE.md content)
├── cursor/instructions.eta        → text/plain (.cursorrules content)
├── copilot/instructions.eta       → text/markdown (.github/copilot-instructions.md)
└── jetbrains/instructions.eta     → application/json (AI Assistant config)
```

## Operator override

The service loads templates from this default directory at startup. To
override per deploy (e.g. customize wording for a specific tenant), set
`AISHA_TEMPLATES_DIR=/path/to/custom-templates` and mount your custom
directory. The loader falls back to the bundled defaults for any IDE
whose override is missing.

## Eta context shape

Every template receives the workspace envelope (Zod-validated upstream)
as `it`. The shape is `WorkspaceContextEnvelope` from
`../src/lib/envelope.ts`. Templates MUST be PII-safe — never interpolate
fields that contain user-provided text without an explicit allow-list
check (envelope schema already filters).

## Required structure (gate-enforced)

Every Markdown/text template MUST contain:

- `<!-- AISHA-MANAGED-START -->` … `<!-- AISHA-MANAGED-END -->`
- `<!-- USER-CUSTOM-START -->` … `<!-- USER-CUSTOM-END -->`

The bridge client (WP 13.3) uses these delimiters to merge updates
safely with user-owned sections.

JSON templates (JetBrains) skip the HTML delimiters but MUST emit a
`schemaVersion: 1` top-level key so the JetBrains plugin can detect
incompatible upgrades.

## Per-skill templates (future, WP 13.6)

`templates/claude-code/skill-{slug}.md.eta` will inject per-skill
context blocks into the main CLAUDE.md template. Reserved naming
convention so the loader knows what to splice.
