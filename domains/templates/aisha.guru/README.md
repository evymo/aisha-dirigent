# Branded site template — not included in the open-source distribution

This directory is where a deployment's **own branded website template** lives
(the full GrapesJS-ingestable marketing/landing design). It is intentionally
**empty in the open-source repository**.

## Why it's empty here

The public platform ships only the neutral base template in
[`domains/default/`](../../default/) ("Your Aisha stack is online"). A
deployment's real branded site is private and lives in a separate, private
repository (mounted here as a git submodule in the maintainers' own checkout).
It is never published to the open-source mirror.

## How to use it

- **Run the platform without it:** nothing to do. At boot, `svc-web-artifact`
  `/seed-default` ingests `domains/default/` into the `web_pages` table and
  serves it at `/`. The neutral template is the public homepage.
- **Add your own site:** finish the page in the **GrapesJS page builder** in the
  admin UI, let **AISHA** auto-import a design, or place your template files here
  (or wire this path to your own private repo as a submodule) and point
  `AISHA_SEED_DOMAIN` at it.

See `domains/default/README.md` and `services/svc-web-artifact/`.
