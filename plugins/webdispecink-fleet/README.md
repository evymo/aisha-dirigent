# Webdispečink Fleet

Reads vehicles, drivers, positions and the log book from the **Webdispečink SOAP API 2.0**
and puts them on the raw signal lane.

## Why this exists next to the Eurowag plugin

Webdispečink moved under Eurowag, and for a while the SOAP endpoint looked like a dead
end: every call answered `API package is not activated`. That was a licence, not an
architecture. Once it was activated, the endpoint answered — and answered with more than
its successor does.

Measured against the same tenant on 2026-07-26:

| | Webdispečink (this plugin) | Eurowag Telematics |
|---|---|---|
| vehicles | **14** | 6 |
| drivers | 47 | 57 |
| driver identity | Dallas chip, personnel number, division, centre, assigned plate | name and surname |
| vehicle detail | odometer, service intervals (days/km), immobiliser, IMEI, online flag | position, fuel, state |

Neither source is authoritative. Eurowag sees **more drivers**; Webdispečink sees **more
vehicles** and far more about each of them. They observe the same fleet through different
windows, so both are installed and the twin lane composes their evidence rather than
picking a winner.

The Dallas chip matters most: it is the physical token a driver carries, which is what
lets one person be recognised across the vehicle, the delivery note and the payroll
record. The successor does not return it.

## Why a plugin and not core

A vendor integration carries a client, an outbound network allowlist and credentials.
A deployment with no Webdispečink contract should carry none of that.

As `services/svc-webdispecink` it was **optional at deploy time but mandatory at install
time**: `config/services.json` gated it behind `WD_KODF`, yet the npm workspace made every
`npm ci` resolve it regardless. When the lock file drifted, CI broke for everyone —
including deployments that will never call this vendor. A plugin cannot do that, because
nothing installs it until someone turns it on.

## Configuration

See `manifest.json` for the full schema. The three required values are `kodf`, `username`
and `password`; the vendor accepts a **user token in place of the password**, in the same
field (not as a bearer header).

There is no session: `kodf` + `username` + `pass` travel on *every* call, so there is
nothing to log in to once and hold.

## Capabilities

| capability | vendor operation |
|---|---|
| `http.GET./cars` | `_getCarsList2` |
| `http.GET./drivers` | `_getDriversList2` |
| `http.GET./positions` | `_getAllCarsPosition` |
| `http.GET./logbook` | `_getCarLogBook4` |
| `cron.poll_positions` | positions on a timer |
| `cron.sync_fleet` | vehicles + drivers daily |

The log book is per vehicle and per window, so it is pulled **on demand** with
`carId`, `from` and `to` — there is no "all of it" call, and a defaulted window would
look like an answer while describing a period nobody asked about. Missing arguments are
refused rather than guessed.

`geocodePositions` is off by default: the vendor bills per address lookup.

## From registry to twins

The plugin stores what Webdispečink says (`wd_*`) and then asks the platform to
turn it into facts about the twins — it never creates a twin itself:

- after `cron.sync_fleet`: `wd_propose_identity` **proposes** bindings (vehicle
  identifier/plate, driver personal number and name) against what other sources
  already say; a human confirms.
- after `cron.sync_rides`: `wd_project_rides` → `trip` events on the vehicle
  twin (`webdispecink:trip`). Start/end places, purpose, crew and max speed are
  not transferred.
- after `cron.sync_worktime`: `wd_project_worktime` → `driver_hours_day` on the
  driver twin (`webdispecink:tachograph`, attribute `drive_seconds`), which is
  what the catalog parameter `driver_drive_h` reads.

Identity source is `webdispecink` (the twin world's canonical slug, as in
`wd_twin_fleet_current`); vehicle key = bare `wd_car_id`, driver key =
`ridic:<wd_driver_id>` — both are numbered separately and a binding is unique
per (source, key, ref kind) only. Ride and work-summary windows re-read
48 h before the cursor (vendor edits after the fact). If a proposal or
projection step fails, what is stored stays stored, and the run still ends
**failed** with a readable message so the source health block shows it.

## Verifying access without the stack

`services/svc-webdispecink/docs/wd-probe.py` calls the same operations directly:

```bash
export WD_KODF=… WD_USERNAME=… WD_PASSWORD=…
python3 wd-probe.py --op login    # return: 1 = in
python3 wd-probe.py --op cars
python3 wd-probe.py --op drivers
```

`_login` returning `0` with a later `SOAP Fault: login failed` means the credentials are
wrong — not that the package is inactive. The two failures read alike from the outside
and are worth telling apart before anyone escalates to the vendor.
