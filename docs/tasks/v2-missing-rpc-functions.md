# V2 Microservice → Missing SQL RPC Functions (backlog)

> Generated from gate test `src/tests/gates/rpc-sql-mapping.gate.test.ts` on v2 migration cutover.
>
> These RPC function names are **called** from v2 Fastify microservices but have **no corresponding SQL SoT file** in `supabase/sql/functions/` and are **not present** in the production database (PGRST202).
>
> They must either:
> - be implemented as proper SQL functions in `supabase/sql/functions/<name>.sql` + corresponding migration, or
> - the calling code in `services/svc-*/src/routes/…` must be fixed to call an existing function.

| RPC function                          | Called from                                                                 | Suspected existing equivalent                 | Status |
|---------------------------------------|-----------------------------------------------------------------------------|------------------------------------------------|--------|
| `verify_app_attestation`              | `services/gateway/src/routes/admin.ts`                                      | — (new)                                        | TODO   |
| `edge_database_dump`                  | `services/gateway/src/routes/admin.ts`                                      | — (new; ops tool)                              | TODO   |
| `resolve_vulnerability`               | `services/gateway/src/routes/admin.ts`                                      | `resolve_vulnerability_by_id.sql` (rename?)    | TODO   |
| `get_vulnerability_scan_results`      | `services/gateway/src/routes/admin.ts`                                      | `list_project_vulnerabilities.sql` (rename?)   | TODO   |
| `auth_get_current_user_id`            | `services/gateway/src/routes/public.ts`                                     | — (should return `auth.uid()`)                 | TODO   |
| `get_chat_message_by_id`              | `services/svc-ai-chat/src/routes/evaluate.ts`                               | — (new)                                        | TODO   |
| `get_preceding_user_message`          | `services/svc-ai-chat/src/routes/evaluate.ts`                               | — (new)                                        | TODO   |
| `update_message_eval_score`           | `services/svc-ai-chat/src/routes/evaluate.ts`                               | `aisha/db/sql/functions/update_message_eval_score.sql` | ✅ DONE (WP-07) |
| `proactive_evaluate_triggers`         | `services/svc-ai-chat/src/routes/proactive.ts`                              | — (new)                                        | TODO   |
| `proactive_get_stats`                 | `services/svc-ai-chat/src/routes/proactive.ts`                              | — (new)                                        | TODO   |
| `proactive_get_my_stats`              | `services/svc-ai-chat/src/routes/proactive.ts`                              | — (new)                                        | TODO   |
| `get_reward_claim`                    | `services/svc-blockchain/src/routes/claim-reward.ts`                        | `claim_cosmos_reward.sql` (related)            | TODO   |
| `fulfill_reward_claim`                | `services/svc-blockchain/src/routes/claim-reward.ts`                        | `claim_cosmos_reward.sql` (related)            | TODO   |
| `update_blockchain_audit_status`      | `services/svc-blockchain/src/routes/ledger-sync.ts`                         | — (new)                                        | TODO   |
| `get_user_cosmos_address`             | `services/svc-blockchain/src/routes/ledger-sync.ts`                         | `update_my_cosmos_address.sql` (mirror)        | TODO   |
| `upsert_github_app_repositories`      | `services/svc-github-app/src/routes/webhook-bridge.ts`                      | — (new)                                        | TODO   |
| `deactivate_github_app_repositories`  | `services/svc-github-app/src/routes/webhook-bridge.ts`                      | — (new)                                        | TODO   |
| `update_consultation_recording_egress`| `services/svc-livekit/src/routes/recording.ts`                              | — (new)                                        | TODO   |
| `upsert_call_participant`             | `services/svc-livekit/src/routes/token.ts`                                  | — (new)                                        | TODO   |
| `update_rule_embedding`               | `services/svc-mcp-knowledge/src/routes/embeddings.ts`                       | — (new)                                        | TODO   |
| `clear_knowledge_item_chunks`         | `services/svc-mcp-knowledge/src/routes/knowledge-embeddings.ts`             | — (new)                                        | TODO   |
| `insert_knowledge_chunk`              | `services/svc-mcp-knowledge/src/routes/knowledge-embeddings.ts`             | — (new)                                        | TODO   |
| `insert_knowledge_embedding`          | `services/svc-mcp-knowledge/src/routes/knowledge-embeddings.ts`             | — (new)                                        | TODO   |
| `create_shipment_record`              | `services/svc-packeta/src/routes/create-packet.ts`                          | — (new)                                        | TODO   |
| `plugin_kv_get`                       | `services/svc-plugin-system/src/sandbox.ts`                                 | — (new)                                        | TODO   |
| `plugin_kv_set`                       | `services/svc-plugin-system/src/sandbox.ts`                                 | — (new)                                        | TODO   |
| `plugin_kv_delete`                    | `services/svc-plugin-system/src/sandbox.ts`                                 | — (new)                                        | TODO   |

Gate test allowlist (`V2_PENDING_RPC_FUNCTIONS` in `src/tests/gates/rpc-sql-mapping.gate.test.ts`) tracks these until they are implemented.  When implementing an SQL function, **remove it from the allowlist** so the gate continues to enforce coverage.
