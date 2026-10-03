# Local-ingest drop lane — operator guide

How verified documents get from an analyst's machine into `li_*` and the knowledge
base, and how to tell whether it worked.

This lane was first exercised end-to-end on 2026-07-20 (101 contracts, 348
obligations, 4292 chunks). Everything below is what that run actually did, not a
design sketch.

---

## What the lane is

`local-ingest` runs **on an analyst machine**, stays loopback-only, and the
stack never reaches into it. It emits **verify-gated export bundles**; the
platform pulls them. Nothing about the ingest engine is exposed to the network.

```
[analyst box]                        [platform / svc-source-broker]
 POST /api/export                     li-driver
   export/<export_id>/                  tick → read manifest
     manifest.json   (cursor unit)      → verify sha256 + verify.ok (fail-closed)
     *.jsonl         (sha256 each)      → upsert via li_* + KB RPCs
                                        → advance cursor
```

Two properties matter operationally:

- **The manifest is the cursor unit.** `export_id` is monotone; the driver
  remembers the last one it finished and only replays newer bundles. Re-running a
  processed bundle is a no-op, not a duplicate.
- **The gate is fail-closed.** A bundle is replayed only if `manifest.verify.ok`
  is true *and* every file's recomputed sha256 matches. An artifact edited between
  the local run and the replay is refused whole.

---

## Producing a bundle

Export happens deliberately — the cockpit's "Export pro stack" button, or
`POST /api/export` — and only after a green verify. The bundle lands under
`<out>/export/<export_id>/`.

Check before shipping:

```bash
python3 - <<'EOF'
import json, hashlib, os
m = json.load(open("manifest.json"))
bad = [f["name"] for f in m["files"]
       if hashlib.sha256(open(f["name"], "rb").read()).hexdigest() != f["sha256"]]
print("verify.ok:", m["verify"]["ok"], "| files:", len(m["files"]), "| mismatches:", bad)
EOF
```

`verify.ok: True` with zero mismatches is exactly what the driver will re-check.

---

## Delivering it

Delivery is the instance's business, not the platform's — an instance-data repo
typically ships a sync script that takes the exports directory and a drop target
(`user@host:/path`, or an object-storage remote) and copies bundles across. Keep
it idempotent: an `export_id` already present in the drop is skipped, because
bundles are immutable and the manifest is the cursor unit.

Transport notes learned the hard way:

- `rsync` is **not** guaranteed on the target host. The script falls back to a
  `tar`-over-`ssh` copy that needs nothing but `ssh` and `tar`, and skips bundles
  already in the drop.
- On macOS the copy sets `COPYFILE_DISABLE=1`; without it `bsdtar` ships
  AppleDouble sidecars (`._*`) that litter the drop and confuse naive scans.

The drop itself is a **named Docker volume** (`ingest-drop`), not a host path.
Docker creates and owns it, so there is no directory to provision, no ownership
to hand over and no privilege to escalate — and nothing tying the broker to one
node's filesystem. Deliver into it from the host that runs the container:

```bash
docker run --rm -v <app>_ingest-drop:/dst -v /path/to/bundles:/src:ro alpine:3 \
  sh -c 'cp -r /src/. /dst/'
```

> The production transport is object storage (MinIO is already deployed, buckets
> are declared from the repo in `minio-init`, and `services/storage-auth`
> mediates every object access). The volume is the local/dev lane.

---

## Arming the lane

The broker carries two independent lanes and boots on either one alone:

| lane | armed by | supplies |
|---|---|---|
| federation | `SOURCE_API_URL` | an external source app's users |
| drop replay | `LOCAL_INGEST_DROP_DIR` | local-ingest export bundles |

Setting `LOCAL_INGEST_DROP_DIR` is what makes `coolify-story-init.sh` create the
Coolify app at all — the opt-in condition is declared in `config/services.json`
(`provision_when_env`, any-of) and read from there, so arming a lane is one
setting, not an edit in several places.

With **neither** lane configured the service refuses to boot rather than idling
as a healthy container that drains nothing.

---

## Verifying a replay

The driver drains once at startup and then on `LOCAL_INGEST_INTERVAL_MS`
(24 h default), so a redeploy is also a "run now".

```
li-driver: starting pull-from-drop loop   dropDir=/data/ingest-drop
li-driver: bundle ingested                counts={registry:101, obligations:348, kbItems:111, kbChunks:4292}
li-driver: tick complete                  seen=1 ingested=1 cursor=<export_id>
```

A second run over the same drop must read `seen=0 ingested=0` with the cursor
unchanged — that is the idempotence check.

In the database:

```sql
SELECT 'li_source_registry' t, count(*) FROM li_source_registry
UNION ALL SELECT 'li_obligations', count(*) FROM li_obligations;

SELECT source_slug, metadata->>'last_export_id' AS cursor, last_success_at
FROM audience_broker_sync_state WHERE source_slug = 'local-ingest';
```

### When a bundle is refused

The driver **holds the cursor** on failure — nothing is lost and the next tick
retries the same bundle. Failures seen in practice, all fixed, all worth
recognising:

| log line | meaning |
|---|---|
| `Unauthorized: admin, staff, or service_role required` | the connection has no service_role; the driver now sets both the JWT claim and the session role |
| `Service role required` | a stricter RPC that accepts **only** the JWT claim — session role alone is not enough |
| `violates foreign key constraint "knowledge_items_locale_fkey"` | the bundle's IETF tag (`cs-CZ`) vs the platform's ISO code (`cs`); the driver normalises at the seam and fails loud on an unknown base language |
| `seen=1 ingested=0` with no error | the cursor is already at or past this `export_id` — nothing to do |

---

## Related

- `scripts/stack-map.mjs --findings` — derives the wiring graph from the compose
  files and reports contradictions (probe kinds, network attachment, addresses
  that bootstrap through the thing they are bootstrapping).
- `docs/compose-notes/` — the prose that used to live inside the compose files.
