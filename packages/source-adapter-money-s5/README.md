# @aisha/source-adapter-money-s5

Generic **svc-source-broker** adapter for the Money (Seyfor) **S5 API** —
operational documents (delivery notes) over OAuth2 `client_credentials` +
GraphQL. A first-party **ecosystem** connector maintained with the stack, not a
per-fork integration: any instance binds its own Money endpoint + credentials via
the story spine, and enables the connector through the plugin catalog.

## Where it fits

```
svc-source-broker (upstream, generic)
  └─ plugin-host → SOURCE_ADAPTER_PLUGIN_ENTRY → createDataSource()  ← THIS PACKAGE
       binds by story → audience_resolve_source_binding(storyId, 'money_graphql')
                          → endpoint_url + auth_secret_ref (per instance)
```

- **No instance-specific data here.** Endpoint + credential *reference* come from
  `instance_endpoint_bindings` per read (`SourceConnection`). The named secret
  (`authSecretRef`, `clientId:clientSecret`) is resolved from the broker's secret
  store — never in this package, the source declaration, or the spine.
- **Delivered as a plugin** (`plugin_catalog` / `plugin_versions` / kill-switch via
  `svc-plugin-system`), so it is versioned and ecosystem-governed.

## Capabilities (phase 1)

| Contract method | Money S5 |
|-----------------|----------|
| `getEntity('document', id)` | `IssuedDeliveryNote(ID:)` → `DocumentRecord` |
| `listEntities('document', conn, {since,limit,offset})` | `IssuedDeliveryNotes(ChangeFrom,From,Count)` → `DocumentRecord[]` |
| `probe()` | connection-less self signal (live auth checked on first read) |

**Phase 2 — write-back (not implemented here, and blocked on a fact we don't have):**
`IDataSource.writeBack()` now exists generically (gated on the `'write-back'`
capability, which this adapter does NOT declare — so it stays unreachable). What is
missing is not our contract but knowledge of S5: the documented schema exposes the
`S5ApiQuery` root only, and nothing in `docs/MONEY_S5_API.md` mentions a mutation,
an attachment or an upload. Whether S5 can be written to at all is therefore
**unverified**, and no write path should be built on the assumption that it can.

Answer it against the live instance before writing any code:

```bash
python3 docs/money-s5-probe.py --introspect
```

It reports whether a mutation root exists and lists the mutations that touch a
document, its state or an attachment. If there is no mutation root, S5 is
read-only over GraphQL and the operational state has to reach Money another way.

## Real API behaviour

See [docs/MONEY_S5_API.md](docs/MONEY_S5_API.md) — OAuth2 `scope=S5Api`, the
non-standard `{Data,Status,RowCount}` envelope, and field mapping (`AdresaNazev`,
`Mnozstvi`, `DatumVystaveni`). `docs/money-s5-probe.py` is a dependency-free live
smoke test.

## Test

```bash
npx tsx --test src/__tests__/adapter.test.ts   # standalone: no network, no monorepo install
```
