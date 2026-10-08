# Knowledge from experience (platform layer)

Each `<slug>.md` here is one knowledge item: a general lesson from building and
operating AISHA that holds for **every fork**. The seed
`aisha/db/seed/core/41_aisha_knowledge_from_experience.sql` is **generated** from
these files and lands in the default story (`story_id` NULL) of every instance on
every deploy.

- Regenerate after any change: `npm run db:seed:knowledge` (then `npm run regen`
  to refresh the compiled seed). The gate `knowledge-seed-from-sources` fails when
  the seed and the sources differ.
- Format, states and the write policy (upsert with version) are documented in the
  generator header: `scripts/db/gen-knowledge-seed.mjs`.
- Only `status: adopted` (and `retired`) reach the seed; `proposed`, `draft` and
  `returned` are listed in the seed header as not included.
- This repository is public. An item here names no instance, machine, domain,
  person or private repository, and its evidence is readable without private
  access: a `file:` path in this repository, or a rule written as a procedure
  anyone can re-run. Knowledge about one instance belongs in that instance's own
  data repository (`--vrstva instance`).
