## Plan: Global AI Batch Abstraction (driver-pluggable, Anthropic + OpenAI v MVP)

Postavit globální platformovou vrstvu pro asynchronní AI batch zpracování, která je provider-agnostic. Provider-specifické rozdíly (Anthropic Message Batches, OpenAI Batch API, později Bedrock/Vertex/lokální async) se schovávají za jednotný `BatchDriver` interface a jednotný DB job model. AISHA rozhoduje na úrovni task-kind ↔ provider ↔ batch-eligibility podle kapabilit, ne podle konkrétních provider jmen. MVP zahrnuje oba drivery (Anthropic + OpenAI) jako důkaz, že abstrakce drží.

**Vrstvový model (top-down)**

1. Task layer — typed katalog AI úloh (`ai_task_kinds`) s metadaty (realtime nárok, output size class, data classification, batch_eligible, default provider preference). Zdroj pravdy "co se vůbec smí batchovat". AISHA umí navrhnout nový task_kind přes governance.
2. Routing layer — RPC `decide_ai_execution_route(...)` s pevně daným pořadím hard guardů + threshold rules. Cost-aware tie-break až když má AISHA dostatek dat.
3. Batch domain layer — provider-neutral DB schema (`ai_batch_jobs`, `ai_batch_items`) a RPC lifecycle. Žádný sloupec/parametr není provider-specific.
4. Driver layer — TypeScript `BatchDriver` interface + registry. Konkrétní implementace v `drivers/anthropic.ts` a `drivers/openai.ts`. Jediné místo s provider-specific kódem.
5. Worker layer — provider-neutral Fastify routes v `svc-ai-chat`, které dispatchují přes registry podle `job.provider_id`. n8n je jen scheduler.
6. Observability + learning — audit_journal, integration_service_logs, `ai_routing_decisions` ↔ `ai_routing_outcomes`, governance přes `expert_rule_proposals`.

**Key contracts (driver interface)**

`BatchDriver` interface obsahuje: `providerId`, `capabilities` (viz níže), `validateRequest`, `buildPayload` (inline nebo file_upload), `submit`, `pollStatus`, `streamResults` (callback per JSONL line), `cancel`, `delete`, `estimateCost`.

`BatchCapabilities` obsahuje: `maxRequests`, `maxBytes`, `oneModelPerBatch`, `submitMode` (`inline` | `file_upload`), `customIdPattern`, `customIdMaxLen`, `supportsExtendedOutput`, `supportsPromptCaching`, `supportsToolUse`, `supportedTaskKinds`, `resultRetentionDays`, `zdrEligible`, `endpointMap` (task_kind → provider endpoint, jen relevantní pro multi-endpoint providery).

Worker, RPC, n8n a UI vidí jen normalizované typy a `provider_id` jako identifikátor.

**Steps**

Phase 0: Task taxonomy + scope policy
1. SoT tabulka `aisha/db/sql/tables/ai_task_kinds.sql` + migrace. Sloupce: `task_kind` PK, `description`, `realtime_required` bool, `default_latency_budget_seconds`, `expected_output_size_class` (small/medium/large/xlarge), `data_classification` (public/internal/restricted/secret), `default_provider_preference` jsonb, `batch_eligible` bool, `requires_approval` bool, `is_system` bool (true = nesmí být smazán), `metadata` jsonb, `created_by`, timestamps.
2. Initial seed task kinds (`is_system=true`): `chat_user_turn` (batch_eligible=false), `code_generation_short` (false), `story_decomposition` (true), `ruleset_analysis` (true), `knowledge_ingestion` (true), `bulk_eval` (true), `bulk_moderation` (true), `code_review_large_diff` (true), `design_proposal` (true), `embedding_bulk` (true).
3. RLS: read pro authenticated, mutace přes RPC s admin/governance approval.
4. RPC `is_task_kind_batch_eligible(p_task_kind text)` (STABLE) — používá routing layer i UI.
5. RPC `propose_new_task_kind(...)`: AISHA (přes service role context) nebo admin smí navrhnout nový task_kind. Návrh jde do `expert_rule_proposals` (governance) s approval gate. Po schválení INSERT s `is_system=false`. Audit povinný.
6. Bezpečnostní pravidlo: žádné PII/secrets v audit metadata; raw payloady jen v chráněné job tabulce. `data_classification='secret'` je v hard guardu zakázané pro non-ZDR providery.

Phase 1: Provider-neutral batch domain (DB SoT + migrace)
7. SoT `aisha/db/sql/tables/ai_batch_jobs.sql` + migrace. Sloupce: `id` uuid PK, `provider_id` text (FK na `integration_services.service_name`), `driver_version` text, `task_kind` text (FK na `ai_task_kinds`), `provider_batch_id` text, `idempotency_key` text, `status` enum (queued/submitting/in_progress/finalizing/completed/failed/expired/canceling/canceled/purged), `request_count` int, `payload_bytes` bigint, `model_summary` jsonb, `provider_artifacts` jsonb (Anthropic: msgbatch_id; OpenAI: input_file_id/output_file_id/error_file_id), `submitted_at`, `ended_at`, `expires_at`, `results_available_until`, `last_polled_at`, `next_poll_at`, `retry_count`, `error_json`, `purge_after`, `created_by`, `decision_id` (FK na ai_routing_decisions), `metadata` jsonb, timestamps.
8. SoT `aisha/db/sql/tables/ai_batch_items.sql` + migrace. Sloupce: `job_id` FK, `custom_id` text, `request_params` jsonb, `request_hash` text, `status`, `result_type`, `provider_message_id`, `usage_json`, `result_payload` jsonb (small) NEBO `result_ref` text (object storage URI pro velké), `error_json`, `processed_at`. UNIQUE (job_id, custom_id). Žádný CHECK na pevný regex — driver enforcuje per capability.
9. Indexy: (status, next_poll_at), (provider_id, status), (provider_batch_id), (created_by, created_at desc), (purge_after) WHERE status NOT IN active states, (job_id, custom_id).
10. RLS: admin/staff read all, owner read pro vlastní job, service_role full; mutace jen přes RPC.
11. Rozšířit `integration_services` o capability sloupce (nebo `capabilities` jsonb): `supports_batch`, `batch_max_requests`, `batch_max_bytes`, `batch_submit_mode`, `batch_one_model_per_batch`, `batch_result_retention_days`, `batch_zdr_eligible`, `supported_task_kinds` jsonb, `endpoint_map` jsonb. Seed pro `anthropic`, `openai` v Phase 6/7; lokální providery zůstanou `supports_batch=false`.
12. Migrace ukončené zápisem do `audit_journal`. Baseline se needituje přímo.

Phase 2: Routing RPC + learning loop schema
13. SoT `aisha/db/sql/tables/ai_routing_decisions.sql`: `id`, `task_kind`, `provider_id`, `chosen_route` (sync/batch/batch_extended), `model`, `rule_version`, `reason_code`, `inputs_jsonb` (estimates only, no PII), `decision_at`, `created_by`.
14. SoT `aisha/db/sql/tables/ai_routing_outcomes.sql`: `decision_id` FK, `actual_latency_ms`, `actual_input_tokens`, `actual_output_tokens`, `actual_cost_usd`, `succeeded`, `error_class`, `user_satisfaction` (nullable), `retry_needed`, `recorded_at`.
15. RPC `decide_ai_execution_route(p_task_kind, p_provider_id, p_trigger_source, p_user_opt_in_savings, p_estimated_output_tokens, p_estimated_request_count, p_latency_budget_seconds, p_metadata)`. Hard guardy v pořadí:
    1. `ai_task_kinds.batch_eligible=false` → sync, reason `task_kind_not_batchable`.
    2. `integration_services.supports_batch=false` → sync, reason `provider_no_batch_support`.
    3. `trigger IN (user_interactive, user_background)` AND opt_in=false → sync, reason `ux_priority_user_facing`.
    4. Provider limity překročené → sync nebo split návrh, reason `provider_batch_limit_exceeded`.
    5. `data_classification='secret'` AND provider není zdr_eligible → sync nebo reject, reason `data_classification_blocks_batch`.
    Až poté threshold rules z `expert_rule.ai_routing_strategy`.
    Defaults: `trigger=aisha_internal` AND (output ≥5k OR count ≥10 OR latency_budget ≥900s) → batch. output ≥50k AND `provider_supports_extended_output` → batch_extended + approval gate.
    Zapíše decision do `ai_routing_decisions` + `audit_journal`. Vrátí route, model, reason_code, rule_version, decision_id, provider_capabilities summary.
16. RPC `record_ai_routing_outcome(...)` (service_role, audited).
17. RPC `get_ai_routing_insights(p_window interval)` (admin/staff read STABLE) — agregáty per (task_kind, provider, route).

Phase 3: Batch domain RPC lifecycle (provider-neutral)
18. `enqueue_batch_job(p_provider_id, p_task_kind, p_decision_id, p_items jsonb, p_metadata, p_idempotency_key)`: validace přes capability lookup z `integration_services` (max counts, max bytes); idempotency dedup; uloží job + items; audit bez raw obsahu.
19. `claim_queued_batch_jobs(p_limit int, p_provider_id text default null)` (service_role): atomický pickup pro worker. Filtr per provider umožňuje per-provider throughput tuning.
20. `mark_batch_job_submitted(p_job_id, p_provider_batch_id, p_provider_artifacts jsonb, p_processing_status, p_expires_at, p_results_available_until, p_next_poll_at)` (service_role).
21. `get_pollable_batch_jobs(p_limit int, p_provider_id text default null)` (service_role).
22. `update_batch_job_status(p_job_id, p_status, p_counts jsonb, p_ended_at, p_next_poll_at, p_error_json)` (service_role) + log_integration_action.
23. `ingest_batch_results(p_job_id, p_lines jsonb[])` (service_role): per-line upsert podle `custom_id`, rozliší succeeded/errored/canceled/expired, uloží usage + result (inline JSONB nebo `result_ref`).
24. `request_batch_cancel(p_job_id)` a `mark_batch_deleted(p_job_id)`: lifecycle RPC, auditované, idempotentní.
25. Read RPCs: `list_batch_jobs(filters)`, `get_batch_job_detail(p_job_id)`, `get_batch_stats(p_window, p_group_by)` STABLE.

Phase 4: Driver abstraction layer (TypeScript)
26. `services/svc-ai-chat/src/lib/batch/types.ts` — normalizované typy: `NormalizedBatchRequest`, `NormalizedBatchItem`, `NormalizedResultLine`, `BatchCapabilities`, `SubmitPayload`, `SubmitContext`, `PollResult`, `CostEstimate`, `ValidationResult`, normalizované error classes (`rate_limited`, `payload_too_large`, `validation_failed`, `provider_unavailable`, `expired`). Žádný `any`.
27. `services/svc-ai-chat/src/lib/batch/driver.ts` — `BatchDriver` interface (viz Key contracts).
28. `services/svc-ai-chat/src/lib/batch/registry.ts` — `BatchDriverRegistry` s `register(driver)` a `get(providerId)`. Boot v `server.ts` registruje dostupné drivery podle env (api keys/configs).
29. `services/svc-ai-chat/src/lib/batch/normalize.ts` — utility pro mapping interních RPC payloadů do `NormalizedBatchItem` a zpět z `NormalizedResultLine`.

Phase 5: Provider-neutral worker routes
30. `services/svc-ai-chat/src/routes/batch.ts` — Fastify routes chráněné `verifyServiceRole`:
    - `POST /internal/batch/submit` → `claim_queued_batch_jobs`, pro každý `registry.get(job.provider_id).submit(...)`, `mark_batch_job_submitted` přes RPC.
    - `POST /internal/batch/poll` → `get_pollable_batch_jobs`, `driver.pollStatus(...)`, při `ended` `driver.streamResults(...)` → batched `ingest_batch_results`.
    - `POST /internal/batch/cancel` → `driver.cancel(...)` + `update_batch_job_status`.
    - `POST /internal/batch/delete` → `driver.delete(...)` + `mark_batch_deleted`.
31. Žádná provider-specific logika v routes — jen `registry.get(job.provider_id).method(...)`.
32. Error handling normalizovaný: 429 retry-after, 4xx validation (non-retryable), 5xx retryable s exp backoff. Driver mapuje provider chyby do normalizovaných error classes.
33. Velké výsledky (size > threshold, např. 256 KB) ukládat do MinIO/object storage; do `result_ref` zapsat URI; jinak inline JSONB.

Phase 6: Anthropic driver
34. `services/svc-ai-chat/src/lib/batch/drivers/anthropic.ts` implementuje `BatchDriver`:
    - capabilities: maxRequests=100000, maxBytes=256MB, oneModelPerBatch=false, submitMode=inline, customIdPattern (1-64 alphanumeric/underscore/dash), customIdMaxLen=64, supportsExtendedOutput=true, supportsPromptCaching=true, supportsToolUse=true, resultRetentionDays=29, zdrEligible=false.
    - validateRequest: per-item max_tokens >= 1, custom_id regex match, payload size guard, optional beta flags.
    - buildPayload: inline JSON s pole `requests: [{custom_id, params}]`.
    - submit: POST `/v1/messages/batches` s headers `x-api-key`, `anthropic-version: 2023-06-01`, optional beta header `output-300k-2026-03-24`.
    - pollStatus: GET `/v1/messages/batches/{id}` → mapuje status na normalizovaný.
    - streamResults: GET `/v1/messages/batches/{id}/results` → JSONL streaming → `onLine` per řádek.
    - cancel/delete: standardní endpointy.
    - estimateCost: token estimate × Anthropic batch rate (50% sync ceny) per model.
35. Registrace v `BatchDriverRegistry` v `server.ts`, gated přes `ANTHROPIC_API_KEY`.
36. Seed `integration_services` row pro `anthropic` s capability flagy.
37. Unit testy: validate, submit (mock fetch), pollStatus, streamResults (unordered JSONL), cancel/delete, 429 retry-after, 413 payload-too-large, expired requests.

Phase 7: OpenAI driver (validuje abstrakci, jiný submit mode)
38. `services/svc-ai-chat/src/lib/batch/drivers/openai.ts` implementuje stejné `BatchDriver` rozhraní:
    - capabilities: maxRequests=50000, maxBytes=200MB, oneModelPerBatch=true, submitMode=file_upload, customIdPattern (per OpenAI specs), supportsExtendedOutput=false, supportsPromptCaching=false, supportsToolUse=true, resultRetentionDays=30, zdrEligible=false. `endpointMap` task_kind → `/v1/chat/completions` | `/v1/responses` | `/v1/embeddings` | `/v1/moderations` | `/v1/images/generations` | `/v1/videos`.
    - validateRequest: enforce one-model-per-batch (zamítnout heterogenní items), per-item body validation podle endpointu, custom_id pattern, payload size guard ≤200MB, batch creation rate hint (2000/h).
    - buildPayload: serializuje na `.jsonl` Buffer; každý řádek `{custom_id, method:'POST', url:<endpoint>, body:{...}}`.
    - submit: dvoukrok — POST `/v1/files` (multipart, `purpose=batch`) → uloží `input_file_id` do `provider_artifacts` → POST `/v1/batches` `{input_file_id, endpoint, completion_window:'24h', metadata}`.
    - pollStatus: GET `/v1/batches/{id}` → mapuje statusy validating/in_progress/finalizing/completed/expired/cancelling/cancelled/failed → normalizované.
    - streamResults: po `completed` GET `/v1/files/{output_file_id}/content` → JSONL stream → `onLine`. Při `error_file_id` totéž pro errory.
    - cancel: POST `/v1/batches/{id}/cancel`.
    - delete: DELETE `/v1/files/{input_file_id}` + DELETE `/v1/files/{output_file_id}` (output má 30day auto-retention u OpenAI, lokální purge policy stejně smaže) + označit job jako `purged`.
    - estimateCost: token estimate × OpenAI batch rate (50% sync) per model + endpoint.
39. Registrace v `BatchDriverRegistry`, gated přes `OPENAI_API_KEY`. Seed `integration_services` row pro `openai` s capability flagy a endpoint_map.
40. Unit testy: validate (heterogeneous model reject, oversize reject, endpoint mapping), file upload mock (multipart), submit dvoukrok, pollStatus všechny statusy, streamResults output + error file, cancel, delete (oba file IDs).
41. Integration smoke proti OpenAI testovacímu projektu (tagged `@external`, opt-in v CI). Žádná změna v RPC, worker routes, n8n workflows ani UI — pokud něco musí změnit, abstrakce má bug a musí se opravit driver/normalize, ne callsite.

Phase 8: n8n orchestration (provider-neutral)
42. `n8n/workflows/WF_BATCH_SUBMIT.json`: schedule/manual, volá `/internal/batch/submit` (žádný `provider` parametr — worker zpracuje všechny dostupné). `log_integration_action` přes `n8n-nodes-aisha.aishaRpc`.
43. `n8n/workflows/WF_BATCH_POLL.json`: cron 5-10 min, volá `/internal/batch/poll`, loguje counts + chyby per provider.
44. `n8n/workflows/WF_BATCH_PURGE.json`: denně, volá `/internal/batch/delete` pro joby po `purge_after` a po lokální retention; respektuje provider retention windows.
45. Žádný přímý `/rest/v1` zápis. Volitelný approval gate pro `batch_extended` a velké budgety.

Phase 9: Observability, safeguards, governance learning
46. Každé externí volání providera logovat přes `log_integration_action` s bezpečným summary: job_id, provider_id, provider_batch_id, counts, durations, status, error code. Bez promptů a raw odpovědí.
47. Každou mutating RPC auditovat do `audit_journal`.
48. Vlastní budget guard před submit: token estimate × cost rate, workspace budget, max queue depth per provider. Failnout před externím voláním.
49. Metriky: queue depth per provider, success/error/expired/canceled counts, p95 batch duration, cache usage, spend estimate, purge lag.
50. `WF_AISHA_ROUTING_REVIEW.json`: 1× denně/týdně volá `get_ai_routing_insights` + `propose_routing_rule_update(p_proposal jsonb)` → návrh do `expert_rule_proposals` (governance). Approval gate povinný — AISHA navrhuje, člověk schvaluje. Hard guardy a `ai_task_kinds.batch_eligible` flagy NESMÍ měnit governance loop, jen thresholdy uvnitř povoleného scope a navrhované task_kindy přes Phase 0 RPC.
51. Cost-aware routing (data-driven, AISHA decides when to apply):
    - RPC `get_provider_cost_performance(p_task_kind text, p_window interval, p_min_samples int default 30)` (STABLE): per provider × route agregát z `ai_routing_outcomes` — avg_cost, p95_latency, success_rate, sample_count, confidence_level (`insufficient_data` / `emerging` / `stable`).
    - `decide_ai_execution_route` smí cost-aware tie-break použít POUZE když:
      a. confidence_level=`stable` (≥30 samples za posledních 30 dní per kandidát), AND
      b. rozdíl v expected_value (cost × success_rate) je >15 % mezi kandidáty, AND
      c. žádný hard guard nepreferuje konkrétního providera.
    - Pokud podmínky neplatí → fallback na `default_provider_preference` z `ai_task_kinds`. AISHA tichý guess s nedostatečnými daty NEDĚLÁ.
    - Cost-aware decision je v `ai_routing_decisions.reason_code='cost_aware_tiebreak'` s odkazem na použité statistiky v `inputs_jsonb` pro auditovatelnost.
    - Governance loop smí navrhnout úpravu min_samples a confidence thresholdů přes `expert_rule_proposals`.

Phase 10: Frontend admin surface
52. Hook `src/hooks/useBatchJobs.ts` (RPC + Zod) podle `useAuditJournal.ts` patternu — list, detail, stats, cancel/delete mutations.
53. Hook `src/hooks/useAiRoutingInsights.ts` pro routing review widget.
54. Hook `src/hooks/useAiTaskKinds.ts` pro správu task kind katalogu (admin, navrhnout nový přes RPC).
55. Hook `src/hooks/useProviderCostPerformance.ts` pro cost-aware insights widget.
56. Zod schemas v `src/lib/validation/rpcSchemas.ts`. i18n EN/CS, žádné hardcoded JSX, lucide icons.
57. Volitelný "úsporný režim" UI toggle pro user-initiated úlohy s ETA + cancel option (nikdy tichý downgrade).

**Relevant files**
- `aisha/db/sql/tables/integration_services.sql` — rozšíření o capability sloupce a seed pro batch-capable providery.
- `aisha/db/sql/tables/integration_events.sql`, `aisha/db/sql/functions/log_integration_action.sql`, `record_integration_event.sql`, `complete_integration_event.sql` — referenční vzory pro lifecycle/audit/retry.
- `services/svc-ai-chat/src/server.ts` — registrace nového Fastify route + boot driver registry.
- `services/svc-ai-chat/src/auth.ts` — `verifyServiceRole` pro interní worker endpoints.
- `services/svc-ai-chat/src/lib/providers/anthropic.ts` — sdílí env/headers s novým Anthropic batch driverem (importovat společné konstanty).
- `services/svc-ai-chat/src/lib/providers/types.ts` — sync chat typy zůstávají oddělené; batch typy do `lib/batch/types.ts`.
- `n8n/workflows/WF_AISHA_HOOK_FACTORY.json` — referenční pattern pro Anthropic header/env v n8n; pro batch routes ale použít interní `svc-ai-chat` endpoint.
- `n8n/workflows/WF_FINE_TUNE_JOB.json` — varování: přímý `/rest/v1` zápis je anti-pattern.
- `src/hooks/useAuditJournal.ts` — frontend hook pattern (RPC + Zod).
- `package.json` — verifikační příkazy (db:migration:register, db:migrate:local, db:types:gen:local, func:validate, db-mgr:lint, db-mgr:source, type-check, test:run, i18n:check, aisha:workflows:verify).

**Verification**
1. SQL: `npm run db:migration:register`, `npm run db:migrate:local`, `npm run db:types:gen:local`, `npm run func:validate`, `npm run db-mgr:lint`, `npm run db-mgr:source`.
2. RPC security: REVOKE/GRANT signatures, service_role-only mutace, admin/staff/owner read boundaries, audit_journal writes.
3. Driver tests: pro každý driver mockovaný HTTP klient — happy path, JSONL unordered, 429 retry-after, 413/4xx/5xx, expired, cancel/delete.
4. Abstraction tests: worker routes testované s fake driverem implementujícím `BatchDriver` — ověří, že žádná provider-specific logika neunikla mimo driver vrstvu.
5. Routing tests: `decide_ai_execution_route` permutace (task_kind eligible/not, provider supports/not, trigger types, opt_in, limity, data classification, thresholdy, cost-aware confidence levels).
6. n8n: `npm run aisha:workflows:verify`, callerPolicy, timezone, service_role auth, žádný `/rest/v1`.
7. Frontend: `npm run i18n:check`, `npm run type-check`, hook/component tests.
8. Manual smoke (Anthropic): 2-request job end-to-end, ingest unordered JSONL, ověřit usage + custom_id mapping, cancel/delete, lokální purge.
9. Manual smoke (OpenAI): 2-request job end-to-end přes file upload, ingest output_file_id, ověřit usage + custom_id mapping, cancel, delete obou file IDs, lokální purge.
10. Privacy smoke: `integration_service_logs` a `audit_journal` neobsahují raw prompty, odpovědi, API keys, e-maily ani secrets.

**Decisions**
- Tohle není integrace Anthropic ani OpenAI — je to platformová abstrakce pro asynchronní AI batch zpracování s pluggable drivery. Anthropic a OpenAI jsou první dvě konkrétní implementace, druhá validuje že abstrakce drží.
- `task_kind` katalog je systémové rozhodnutí "co se vůbec smí batchovat" nezávisle na provideru. AISHA umí navrhnout nový task_kind přes governance approval.
- Provider selection a sync/batch routing jsou dvě nezávislé vrstvy. Provider router (existuje) vybere kdo; sync/batch router rozhodne jak. Pokud zvolený provider batch nepodporuje → sync, transparentně.
- DB schema je provider-neutral. Provider-specific data jdou do `provider_artifacts` jsonb, ne do dedicated sloupců.
- Driver vrstva je jediné místo s provider-specific kódem. Worker, RPC, n8n, UI vidí jen normalizované typy a `provider_id`.
- UX > úspora. User-facing dotazy zůstávají sync. Batch je default jen pro AISHA-internal úlohy nebo s explicit user opt-in přes UI toggle.
- Cost-aware routing je na AISHA, ale zapne se až s dostatečnými daty (≥30 samples per kandidát, stable confidence). S nedostatkem dat fallback na `default_provider_preference`. Žádný tichý guess.
- AISHA navrhuje, člověk schvaluje. Žádné silent rule changes. Hard guardy, `batch_eligible` flagy a confidence thresholdy nejsou v scope automatického learning loopu — jen návrhy přes `expert_rule_proposals`.

**Further Considerations**
1. Retention: `delete_remote_after_ingest=true` defaultně, lokální raw payload purge 24-72 h podle replay potřeby (per task_kind nastavitelné).
2. Storage velkých výsledků: MinIO/object ref defaultně pro `result_payload > 256 KB` nebo extended-output výstupy.
3. UI rozsah první iterace: admin list/detail/cancel/delete + routing review widget + cost-aware insights widget. User-facing batch submit UI a "úsporný režim" toggle až po stabilizaci backendu.
4. Initial routing thresholdy jsou hrubé — po ~2 týdnech provozu spustit první governance review s reálnými daty.
5. Learning loop signály: pokud nemáme `user_satisfaction`, použít proxy (retry_needed, error_class, latency vs budget); zaznamenat v reason_code.
6. Per-task_kind capability matrix (jaký driver podporuje jaký task) je odvozená z `BatchDriver.capabilities.supportedTaskKinds` a `ai_task_kinds.batch_eligible` — exposovat jako read RPC `get_batch_capability_matrix()` pro UI/debug.
7. Bedrock/Vertex/lokální async drivery jako budoucí extension — přidání nového driveru bez změny RPC, worker, n8n, UI je explicitní acceptance test abstrakce.
