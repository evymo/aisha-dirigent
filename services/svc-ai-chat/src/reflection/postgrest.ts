/**
 * PostgREST adapters for the reflection runtime — thin re-export of the shared
 * @aisha/postgrest-client (SVC-01 / D11). The lenient `rpc` (JSON-or-text body),
 * table helpers, and `PostgRESTError` all live in the shared client now.
 */
export { rpc, updateRow, insertRow, PostgRESTError } from '@aisha/postgrest-client';
