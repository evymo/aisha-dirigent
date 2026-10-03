# T-cars Fleet — data_source plugin

Reads a T-cars fleet account over its SOAP WebService v2 and promotes vehicles,
people, groups and the journey log onto the raw signal lane.

## Why a plugin and not a service

T-cars is one supplier of IoT fleet information among several. The stack already
had the right idea — `tier: optional`, gated on `TCARS_CISLO_SMLOUVY` — but an
optional **service** is only optional at deploy time: as an npm workspace member
it still has to resolve at **build** time, for every install, including the ones
that have never heard of T-cars. That is not hypothetical: `npm ci` broke on
`main` until the service was pasted into the lock file, and two sessions
independently fixed that symptom rather than the cause.

`plugins/` is outside the workspace globs, so an instance that does not install
this plugin never builds it, never resolves its dependencies, and never carries
its outbound allowlist.

## The spine it rides

```
manifest.source_spec
  → materialize_data_source        (approval txn)
    → agent_knowledge_sources      (inactive until the instance classifies it)
      → svc-source-broker plugin host   (loads adapter_entry)
```

Identical to `eurowag-telematics`. What differs per vendor is **transport**
(SOAP rpc/encoded here, REST there), **parsing**, and **identity signals** —
never the shape of what gets stored. See the seeded doctrine
`external-observation-rides-one-shape`.

The row lands `is_active = false` by construction: activation requires the
instance's full 4-dimension classification (data sensitivity, legal basis,
owner, retention). The plugin declares what it *can* read; the instance decides
whether it *may*.

## Configuration

Credentials are env vars classified in `scripts/aisha-env-doctor.mjs` as
`external` — operator-supplied, never in git, stored only in the age-encrypted
`.env-prod-backup`.

| variable | meaning |
|---|---|
| `TC_API_URL` | endpoint (defaults to the public WebService v2 URL) |
| `TC_CISLO_SMLOUVY` | contract number — part of the `tLoginData` struct |
| `TC_JMENO` | login name |
| `TC_HESLO` | login secret |

Cadence lives in `source_spec.default_config`: codebooks daily (reference data,
not a stream), rides hourly during the working day, 05:20–20:20 (queried per
vehicle, so cost scales with fleet size — about `16 × (1 + vehicles)` calls a
day). Nothing is lost overnight: the next window starts at the stored cursor.

Every window re-reads a short overlap before the cursor (`rideOverlapHours`,
2 h) so a ride still open at the previous tick lands complete, and once a day
a long one (`rideReconcileOverlapHours`, 48 h) so rides the vendor edited after
the fact (private/business, corrected distance) are picked up. Overlap costs
rows, never vendor calls, and the re-read rows are upserts.

## From rides to twins

The plugin stores what T-cars says (`tc_*`) and then asks the platform to turn
it into facts about the vehicle twins — it never creates a twin itself:

- after the codebook: `tc_propose_identity` → `twin_propose_identity_by_signals`
  matches onboard unit, plate and evidence number against what other sources
  (the ingest) already say about the vehicle and **proposes** a binding; the
  more signals agree, the higher the confidence. A human confirms.
- after the rides: `tc_project_rides` → `twin_project_trips` writes `trip`
  events (`source = tcars-fleet:trip`) only for vehicles whose binding is
  confirmed and valid at the time of the ride, and only when the ride is new
  or changed. Rides waiting for a binding are counted, and project themselves
  on a later tick once it is confirmed. Start/end places are not transferred.

Keys carry the vendor's object kind (`vozidlo:<id>`, `osoba:<id>`): T-cars
numbers vehicles and people separately, and an identity binding is unique per
(source, key, ref kind) only. If a proposal or projection step fails, the data
and cursor already stored stay stored, and the run still ends **failed** with a
readable message, so the source health block in admin shows it instead of a
silently "healthy" run.

## ⚠️ Unverified against a live system

The SOAP response shapes are best-effort from `Webservices_Tcars.docx`. No live
WSDL or account has ever answered them — this TODO carried over from the
service. The mappers return `null` on anything unrecognised instead of guessing,
so a wrong assumption shows up as “0 records mapped”, never as invented rows.

Before trusting output, run one `cron.sync_codebooks` against a real account and
compare counts with the vendor's own UI.

## Tests

```bash
node scripts/test/run-service-tests.mjs --plugins-only   # every plugin, as CI and pre-push run them
cd plugins/tcars-fleet && npx vitest run                  # this plugin alone
```

Run from the plugin directory: the config's `include` is relative to the
working directory, so `--config plugins/tcars-fleet/vitest.config.ts` from the
repository root picks up the whole repository's suite instead.

Mapper tests are ported unchanged from the service — they were the part worth
keeping.
