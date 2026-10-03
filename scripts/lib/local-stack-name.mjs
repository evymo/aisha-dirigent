// local-stack-name.mjs — per-IMPLEMENTATION local stack namespace (single SoT).
//
// The local dev stack's compose project name, bridge network, and the
// container/volume prefix (`${LOCAL_STACK}__`) all derive from ONE name. It is
// per-implementation, NOT per-worktree/checkout: every checkout of the same
// implementation shares the one local instance ("jedna instance dané
// implementace"), and different implementations on the same machine never
// collide — this fork must never touch another implementation's stack (e.g.
// upstream evymo runs its local stack as project `aisha-local`; its containers,
// volumes and network are off-limits).
//
// Default = "aisha-local" — jméno TÉHLE šablony, ne nájemníka. Fork si ho
// přebije přes AISHA_LOCAL_STACK na svůj slug; do generického stromu jméno
// konkrétní implementace nepatří (komentář výš to sám říká: upstream jede
// jako `aisha-local`, a do 2026-08-11 tu přesto stálo natvrdo jméno forku).
// Override via AISHA_LOCAL_STACK only for exceptional scenarios (e.g. a
// disposable second sandbox) — never point it at another implementation's
// project name.
//
// Shell consumers cannot import this module and duplicate the default as
// `${AISHA_LOCAL_STACK:-aisha-local}` (local-warmup.sh, e2e helpers). Parity is
// enforced by src/tests/gates/local-container-namespacing.gate.test.ts.

const raw = (process.env.AISHA_LOCAL_STACK || "aisha-local").trim();

if (!/^[a-z][a-z0-9_-]*$/.test(raw)) {
  throw new Error(
    `AISHA_LOCAL_STACK="${raw}" is not a valid stack slug (^[a-z][a-z0-9_-]*$) — ` +
      "the name feeds the compose project, network, and container/volume prefixes.",
  );
}

export const LOCAL_STACK = raw;
export const LOCAL_STACK_PREFIX = `${LOCAL_STACK}__`;
