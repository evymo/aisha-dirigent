#!/usr/bin/env node

import { randomUUID } from "crypto";

export function createRequestEnvelope(workflow, payload, config, overrides = {}) {
  return {
    workflow,
    payload,
    story_id: overrides.storyId ?? config.storyId ?? undefined,
    context_profile: overrides.contextProfile ?? config.contextProfile ?? "repo",
    autonomy_mode: overrides.autonomyMode ?? config.autonomyMode ?? "hybrid",
    risk_level: overrides.riskLevel ?? config.riskLevel ?? "smoke",
    run_id: overrides.runId ?? randomUUID(),
  };
}

export function withEnvelope(payload, envelope) {
  return {
    ...payload,
    envelope,
  };
}
