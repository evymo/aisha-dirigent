/**
 * Normalizace položek z Webdispečink SOAP odpovědí (WDS_CarItem2,
 * WDS_DriverItem, WDS_Position, WDS_LogBook2Item) na záznamy pro
 * `wd_upsert_*_audited` RPC.
 *
 * Parser vrací všechny hodnoty jako string — typování se dělá tady.
 * Kompletní surová položka se posílá v `raw` (uloží se do `raw_data` jsonb),
 * takže ztráta polí nehrozí ani při změně API.
 *
 * ⚠️ Jména polí jsou DODAVATELOVA a nejsou konzistentní: vozidla a polohy
 * používají malá písmena (`carid`, `positiontime`), kniha jízd velká
 * (`Id_jizda`, `Idcar`, `Dt_from`). Není to překlep — je to tvar, který API
 * skutečně vrací (změřeno proti živému tenantovi 2026-07-26). Přejmenovat je
 * tady by vyrobilo druhý slovník; kanonická jména vznikají až v cílových
 * sloupcích RPC.
 *
 * Každý mapper vrací `null` na položku, které nerozumí, místo aby hádal.
 * Špatný předpoklad se pak projeví jako „0 záznamů namapováno", ne jako
 * vymyšlené řádky.
 *
 * Tenhle soubor byl dřív v `services/svc-webdispecink/src/lib/`. Ta služba
 * zanikla (`df25a389` — „fleet vendors become plugins, not services"), ale
 * mappery se s ní nepřenesly, takže plugin dodavatele četl a **data zahazoval**:
 * DB měla tabulky `wd_*`, RLS i všechny čtyři `wd_upsert_*_audited` funkce, a
 * nikdo do nich nezapisoval.
 */

export interface WdVehicleRecord {
  wd_car_id: number;
  car_group_id: number | null;
  identifier: string | null;
  description: string | null;
  vehicle_type: number | null;
  default_driver: string | null;
  active: boolean;
  online: boolean | null;
  odometer_km: number | null;
  installation_date: string | null;
  disable_date: string | null;
  raw: Record<string, unknown>;
}

export interface WdDriverRecord {
  wd_driver_id: number;
  first_name: string | null;
  last_name: string | null;
  personal_number: string | null;
  group_id: number | null;
  group_name: string | null;
  card_identifier: string | null;
  phone: string | null;
  active: boolean;
  assigned_vehicle: string | null;
  raw: Record<string, unknown>;
}

function toInt(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

function toText(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

/** Webdispečink vrací datumy jako string, prázdné jako '' nebo '0000-00-00…'. */
function toDate(value: unknown): string | null {
  const s = toText(value);
  if (!s || s.startsWith('0000-00-00')) return null;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s : null;
}

/** disabled=1 znamená deaktivované vozidlo/řidiče. */
function toActive(disabled: unknown): boolean {
  return toInt(disabled) !== 1;
}

export function mapCarItem(item: Record<string, unknown>): WdVehicleRecord | null {
  const carId = toInt(item.carid);
  if (carId == null || carId <= 0) return null;

  const online = toInt(item.online);
  return {
    wd_car_id: carId,
    car_group_id: toInt(item.cargroupid),
    identifier: toText(item.identifikator),
    description: toText(item.popis),
    vehicle_type: toInt(item.type),
    default_driver: toText(item.driver),
    active: toActive(item.disabled),
    online: online == null ? null : online > 0,
    odometer_km: toInt(item.odometerKm),
    installation_date: toDate(item.installationdate),
    disable_date: toDate(item.disabledate),
    raw: item,
  };
}

export function mapDriverItem(item: Record<string, unknown>): WdDriverRecord | null {
  const driverId = toInt(item.iddriver);
  if (driverId == null || driverId <= 0) return null;

  return {
    wd_driver_id: driverId,
    first_name: toText(item.jmeno),
    last_name: toText(item.prijmeni),
    personal_number: toText(item.osobnicislo),
    group_id: toInt(item.idskupina),
    group_name: toText(item.groupname),
    card_identifier: toText(item.dallas),
    phone: toText(item.mobil),
    active: toActive(item.disabled),
    assigned_vehicle: toText(item.spz) ?? toText(item.vozidlo),
    raw: item,
  };
}

/** Dedup podle externího ID — poslední výskyt vyhrává (novější stav v odpovědi). */
export function dedupeById<T>(records: T[], idOf: (record: T) => number): T[] {
  const byId = new Map<number, T>();
  for (const record of records) {
    byId.set(idOf(record), record);
  }
  return [...byId.values()];
}

// ── Fáze 2: polohy (WDS_Position) a kniha jízd (WDS_LogBook2Item) ──

export interface WdPositionRecord {
  wd_car_id: number;
  driver_card: string | null;
  position_time: string;
  latitude: number | null;
  longitude: number | null;
  speed_kmh: number | null;
  moving: boolean | null;
  location_text: string | null;
  odometer_km: number | null;
  fuel_level: number | null;
  used_fuel: number | null;
  raw: Record<string, unknown>;
}

export interface WdRideRecord {
  wd_ride_id: number;
  wd_car_id: number;
  wd_driver_id: number | null;
  driver_name: string | null;
  start_time: string | null;
  end_time: string | null;
  start_place: string | null;
  end_place: string | null;
  purpose: string | null;
  ride_type: number | null;
  distance_km: number | null;
  odometer_start_km: number | null;
  odometer_end_km: number | null;
  driving_seconds: number | null;
  standing_seconds: number | null;
  max_speed_kmh: number | null;
  avg_speed_kmh: number | null;
  crew: string | null;
  note: string | null;
  raw: Record<string, unknown>;
}

function toNum(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Doba jako 'HH:MM' nebo 'HH:MM:SS' (i přes 24 h, např. '26:15:00') → sekundy. */
export function durationToSeconds(value: unknown): number | null {
  const s = toText(value);
  if (!s) return null;
  const parts = s.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  if (parts.some((part) => part === '' || !/^\d{1,6}$/.test(part))) return null;
  const [hours, minutes, seconds = '0'] = parts;
  if (Number(minutes) > 59 || Number(seconds) > 59) return null;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

export function mapPositionItem(item: Record<string, unknown>): WdPositionRecord | null {
  const carId = toInt(item.carid);
  const positionTime = toDate(item.positiontime);
  if (carId == null || carId <= 0 || positionTime == null) return null;

  const speed = toNum(item.speed);
  return {
    wd_car_id: carId,
    driver_card: toText(item.ac_dallas),
    position_time: positionTime,
    latitude: toNum(item.latitude),
    longitude: toNum(item.longitude),
    speed_kmh: speed,
    moving: speed == null ? null : speed > 0,
    location_text: toText(item.Location),
    odometer_km: toNum(item.km),
    fuel_level: toNum(item.fueltank),
    used_fuel: toNum(item.usedfuel),
    raw: item,
  };
}

export function mapRideItem(item: Record<string, unknown>): WdRideRecord | null {
  const rideId = toInt(item.Id_jizda);
  const carId = toInt(item.Idcar);
  if (rideId == null || rideId <= 0 || carId == null || carId <= 0) return null;

  const driverId = toInt(item.iddriver);
  return {
    wd_ride_id: rideId,
    wd_car_id: carId,
    wd_driver_id: driverId != null && driverId > 0 ? driverId : null,
    driver_name: toText(item.Ridic),
    start_time: toDate(item.Dt_from),
    end_time: toDate(item.Dt_to),
    start_place: toText(item.Mistood),
    end_place: toText(item.Mistodo),
    purpose: toText(item.Ucel),
    ride_type: toInt(item.Druh),
    distance_km: toNum(item.Vzdalenost),
    odometer_start_km: toNum(item.Tach_start),
    odometer_end_km: toNum(item.Tach_end),
    driving_seconds: durationToSeconds(item.Doba_jizdy),
    standing_seconds: durationToSeconds(item.Doba_stani),
    max_speed_kmh: toNum(item.MaxSpeed),
    avg_speed_kmh: toNum(item.AvgSpeed),
    crew: toText(item.Crew),
    note: toText(item.Poznamka),
    raw: item,
  };
}

export interface WdWorktimeRecord {
  wd_driver_id: number;
  car_identifikator: string | null;
  work_date: string; // ISO 'YYYY-MM-DD'
  day_type: string | null;
  work_from: string | null;
  work_to: string | null;
  total_drive_seconds: number | null;
  total_work_seconds: number | null;
  total_rest_seconds: number | null;
  total_standby_seconds: number | null;
  night_drive_seconds: number | null;
  night_work_seconds: number | null;
  night_rest_seconds: number | null;
  night_standby_seconds: number | null;
  distance_km: number | null;
  absences: string[];
  raw: Record<string, unknown>;
}

/** DateW z tachografu je 'DD.MM.YYYY' → ISO 'YYYY-MM-DD'. */
function parseWorkDate(value: unknown): string | null {
  const s = toText(value);
  if (!s) return null;
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * _getDriverWorkTacho → jeden den výkonu řidiče. `TotalDrive/Work/Rest/StandBy`
 * jsou už v SEKUNDÁCH (ne HH:MM — proto `toInt`, ne `durationToSeconds`).
 * `CarIdentifikator` je SPZ z tachografu; drží se, jak přišla (klíč na vozidlo).
 */
export function mapWorktimeItem(item: Record<string, unknown>): WdWorktimeRecord | null {
  const driverId = toInt(item.IdDriver);
  const workDate = parseWorkDate(item.DateW);
  if (driverId == null || driverId <= 0 || workDate == null) return null;

  const absences = [item.Absence1, item.Absence2, item.Absence3, item.Absence4, item.Absence5, item.Absence6, item.Absence7]
    .map((a) => toText(a))
    .filter((a): a is string => a != null && a !== '' && a !== '0');

  return {
    wd_driver_id: driverId,
    car_identifikator: toText(item.CarIdentifikator),
    work_date: workDate,
    day_type: toText(item.DayType),
    work_from: toText(item.WorkFrom),
    work_to: toText(item.WorkTo),
    total_drive_seconds: toInt(item.TotalDrive),
    total_work_seconds: toInt(item.TotalWork),
    total_rest_seconds: toInt(item.TotalRest),
    total_standby_seconds: toInt(item.TotalStandBy),
    night_drive_seconds: toInt(item.NightDrive),
    night_work_seconds: toInt(item.NightWork),
    night_rest_seconds: toInt(item.NightRest),
    night_standby_seconds: toInt(item.NightStandBy),
    distance_km: toNum(item.Dist),
    absences,
    raw: item,
  };
}

/** 'DD.MM.YYYY HH:MM:SS' (tacho/overspeed čas) → ISO 'YYYY-MM-DDTHH:MM:SS'. */
function parseWdDateTime(value: unknown): string | null {
  const s = toText(value);
  if (!s) return null;
  const m = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(s.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}` : null;
}

export interface WdOverspeedRecord {
  wd_car_id: number;
  wd_driver_id: number | null;
  max_speed_kmh: number | null;
  time_from: string; // ISO
  time_to: string | null;
  lat: number | null;
  lon: number | null;
  distance_km: number | null;
  raw: Record<string, unknown>;
}

/**
 * _getCarOverSpeed → jeden úsek s max. rychlostí. POZOR na souřadnice: `El` je
 * ZEMĚPISNÁ DÉLKA (17.x), `Ew` ŠÍŘKA (50.x) — v odpovědi prohozené proti intuici.
 */
export function mapOverspeedItem(item: Record<string, unknown>): WdOverspeedRecord | null {
  const carId = toInt(item.IdCar);
  const timeFrom = parseWdDateTime(item.Time_from);
  if (carId == null || carId <= 0 || timeFrom == null) return null;
  const driverId = toInt(item.IdDriver);
  return {
    wd_car_id: carId,
    wd_driver_id: driverId != null && driverId > 0 ? driverId : null,
    max_speed_kmh: toNum(item.MSpeed),
    time_from: timeFrom,
    time_to: parseWdDateTime(item.Time_to),
    lat: toNum(item.Ew),
    lon: toNum(item.El),
    distance_km: toNum(item.Dist),
    raw: item,
  };
}

export interface WdDriverStatRecord {
  wd_driver_id: number;
  period_from: string;
  period_to: string;
  total_km: number | null;
  service_km: number | null;
  private_km: number | null;
  driving_seconds: number | null;
  driving_service_seconds: number | null;
  driving_private_seconds: number | null;
  driving_service_day_seconds: number | null;
  driving_service_night_seconds: number | null;
  commute_count: number | null;
  raw: Record<string, unknown>;
}

/**
 * _getStaDrivers → agregát řidiče za okno. Doby jsou 'HH:MM:SS' (i přes 24 h) →
 * `durationToSeconds`. `periodFrom`/`periodTo` (ISO 'YYYY-MM-DD') dodává volající,
 * v odpovědi nejsou — snapshot bez okna by nešel interpretovat.
 */
export function mapDriverStatItem(
  item: Record<string, unknown>,
  periodFrom: string,
  periodTo: string,
): WdDriverStatRecord | null {
  const driverId = toInt(item.iddriver);
  if (driverId == null || driverId <= 0) return null;
  return {
    wd_driver_id: driverId,
    period_from: periodFrom,
    period_to: periodTo,
    total_km: toNum(item.Celkem_km),
    service_km: toNum(item.Sluzebni_km),
    private_km: toNum(item.Soukrome_km),
    driving_seconds: durationToSeconds(item.Doba_jizdy),
    driving_service_seconds: durationToSeconds(item.Doba_jizdy_sluzebni),
    driving_private_seconds: durationToSeconds(item.Doba_jizdy_soukroma),
    driving_service_day_seconds: durationToSeconds(item.Doba_jizdy_sluzebni_den),
    driving_service_night_seconds: durationToSeconds(item.Doba_jizdy_sluzebni_noc),
    commute_count: toInt(item.DomovPraceDomov),
    raw: item,
  };
}
