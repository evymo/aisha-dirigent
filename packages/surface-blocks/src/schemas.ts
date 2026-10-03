/** JSON Schemas for the block contract. Kept as plain objects so they can also be
 * exported to DB CHECKs / other runtimes. $id values are stable contract identifiers. */

import { BLOCK_TYPES } from './types.js';

const sensitivity = { enum: ['public', 'internal', 'restricted', 'confidential'] };

/**
 * One coordinate of the scope vector. `origin` is closed (responsibility is not
 * an open string), `dim` is open (a new axis must be data, not a release).
 */
const scopeCoordinate = {
  type: 'object',
  additionalProperties: false,
  required: ['dim', 'value', 'origin', 'confidence'],
  properties: {
    dim: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
    value: { type: 'string', minLength: 1 },
    origin: { enum: ['user_pick', 'derived', 'guessed_from_text', 'system'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    detail: { type: 'string' },
    resolver: { enum: ['twin', 'story', 'none'] }
  }
} as const;

const scopeDrop = {
  type: 'object',
  additionalProperties: false,
  required: ['dim', 'value', 'reason'],
  properties: {
    dim: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
    value: { type: 'string', minLength: 1 },
    // ONE reason for "absent" and "not yours": a distinguishable answer would
    // turn the lens into an existence oracle over rows the caller cannot read.
    reason: { enum: ['not_visible', 'unsupported_value'] }
  }
} as const;

/**
 * WIDENED BEFORE THE DATA (2026-07-30). Ajv is all-or-nothing: one unknown
 * property here invalidates the WHOLE block, get_block_data is never called and
 * the screen reads "data could not be loaded" — a contract bug wearing a data
 * bug's clothes. The bundle must therefore learn the scope fields in a release
 * that ships BEFORE any RPC emits them; the DB emits them only to a caller that
 * asked under a scope, so the two sides are safe in either deploy order.
 */
const provenance = {
  type: 'object',
  additionalProperties: false,
  required: ['source_slug', 'freshness_at', 'trace_id'],
  properties: {
    source_slug: { type: 'string', minLength: 1 },
    freshness_at: { type: 'string', format: 'date-time' },
    trace_id: { type: 'string', minLength: 1 },
    scope_requested: { type: 'array', items: scopeCoordinate },
    scope_effective: { type: 'array', items: scopeCoordinate },
    scope_dropped: { type: 'array', items: scopeDrop },
    run_id: { type: 'string', minLength: 1 },
    run_note: { type: 'string', minLength: 1 },
    /** Řetěz původu od zdroje pravdy k místu čtení (types.ts ProvenanceHop). */
    chain: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['source_slug'],
        properties: {
          source_slug: { type: 'string', minLength: 1 },
          at: { type: 'string', format: 'date-time' }
        }
      }
    },
    /** „N z M" (types.ts Coverage); n ≤ m hlídá validate.ts — schéma to neumí. */
    coverage: {
      type: 'object',
      additionalProperties: false,
      required: ['n', 'm'],
      properties: {
        n: { type: 'integer', minimum: 0 },
        m: { type: 'integer', minimum: 0 },
        label_key: { type: 'string', minLength: 1 }
      }
    }
  }
} as const;

/**
 * NA CO tenhle blok ukazuje — druh entity a její id.
 *
 * Kanál pro „a je to tenhle záznam". Vznikl proto, že odpověď uměla tvrdit, ale
 * ne UKÁZAT: aby na dotaz „kde je dodák 12345" mohl klient otevřít ten doklad,
 * musí odpověď nést cíl. Bez toho je nasměrování nevyjádřitelné, ať je
 * odpovídač jakkoli chytrý — proto kanál vzniká DŘÍV než chytrost.
 *
 * ⭐ `entity_kind` je OTEVŘENÝ slug, ne výčet. Pojmenovává VĚC (dodák, měřidlo,
 * smlouva, běh), a čím věci jsou, to je v tomhle systému DATA — `entity_type`
 * u dvojčat je volný slug ze stejného důvodu. Uzavřený je naopak `block_type`,
 * protože ten pojmenovává RENDERER, tedy něco, co klient musí už umět.
 * Klient, který druh nezná, ho prostě neotevře — cíl je nabídka, ne příkaz.
 *
 * Sourozenec `data` a `provenance`, ne jejich součást: cíl není údaj o původu
 * ani řádek tabulky, je to odkaz do sítě entit. Volitelný, takže bloky, které
 * na nic neukazují, se nemění.
 */
const blockTarget = {
  type: 'object',
  additionalProperties: false,
  required: ['entity_kind', 'entity_id'],
  properties: {
    entity_kind: { type: 'string', minLength: 1 },
    entity_id: { type: 'string', minLength: 1 },
    /** Čím se cíl PŘEDSTAVÍ člověku (číslo dokladu, jméno měřidla). */
    label: { type: 'string', minLength: 1 }
  }
} as const;

const base = {
  schema_version: { const: 1 },
  block_slug: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]*$' },
  title_key: { type: 'string', minLength: 1 },
  sensitivity,
  provenance,
  // ⚠️ Stejná opatrnost jako u scope polí výš: Ajv je all-or-nothing, takže
  // tohle pole musí umět bundle DŘÍV, než ho jakákoli RPC pošle — a RPC ho
  // posílá VÝHRADNĚ volajícímu, který o něj požádal. Obě pořadí nasazení jsou
  // pak bezpečná: starý klient nepožádá a dostane bajtově tutéž obálku.
  target: blockTarget
} as const;

const baseRequired = ['schema_version', 'block_slug', 'block_type', 'title_key', 'sensitivity', 'provenance', 'data'];

const kpiState = { enum: ['ok', 'warning', 'loss'] };

/**
 * Chart shape. ONE block type, not three: a trend line, a bar row and a donut
 * are one renderer (a card wrapping the right visualisation), and tripling the
 * mask catalogue for a single visual family would dilute it. `kind` is closed
 * for the same reason `block_type` is — it names the visualisation the client
 * must already ship.
 *
 * `points` is uniform across kinds so one validator covers all three:
 *   trend → one point per bucket (label = the bucket), optional `target` line
 *   bar   → one point per row, `pct` drives the bar width
 *   donut → a single point whose `pct` fills the ring
 */
const chartKind = { enum: ['trend', 'bar', 'donut'] };

const chartPoint = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'value'],
  properties: {
    label: { type: 'string', minLength: 1 },
    label_key: { type: 'string', minLength: 1 },
    value: { type: 'number' },
    pct: { type: 'number', minimum: 0, maximum: 100 },
    note: { type: 'string' },
    state: kpiState
  }
} as const;

const fieldState = { enum: ['auto_pass', 'needs_review', 'human_confirmed', 'rejected', 'failed'] };

const sourceRef = {
  type: 'object',
  additionalProperties: false,
  required: ['char_start', 'char_end'],
  properties: {
    char_start: { type: 'integer', minimum: 0 },
    char_end: { type: 'integer', minimum: 0 },
    page: { type: ['integer', 'null'] }
  }
} as const;

const recordField = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'label_key'],
  properties: {
    key: { type: 'string', minLength: 1 },
    label_key: { type: 'string', minLength: 1 },
    value: { type: ['string', 'number', 'null'] },
    value_key: { type: 'string', minLength: 1 },
    state: fieldState,
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    source_ref: sourceRef
  }
} as const;

/**
 * ŘÁDKOVÁ POLOŽKA DOKLADU — odpověď na „za co", ne jen „kolik".
 *
 * ⭐ OTEVŘENÁ (`additionalProperties: true`), a to ZÁMĚRNĚ. Registr ji posílá
 * tak, jak ji zapsal ingest (get_document_detail: „posílají se, jak jsou").
 * Zavřít ji by znamenalo, že bundle rozhoduje, co smí ingest o položce
 * zaznamenat — a jedna nová vlastnost by pak shodila celý blok, tedy přesně ta
 * vada, kvůli které tenhle tvar vzniká. Precedens v katalogu: `timing_tower.runs`.
 *
 * Naměřeno 2026-08-08 na 28 položkách z 21 dokladů: každá nesla
 * {line_index, status, method, fields, issues}. Povinný je jen `line_index` —
 * kotva na dokladu; ostatní smí u starší generace záznamů chybět.
 */
const documentLine = {
  type: 'object',
  additionalProperties: true,
  required: ['line_index'],
  properties: {
    line_index: { type: 'integer', minimum: 0 },
    /**
     * Stav a metoda vytěžení. Otevřené řetězce: pojmenovávají, co udělal INGEST,
     * ne renderer, který by klient musel umět. (Naměřeno: 'AUTO_PASS',
     * 'structured_json' — ale výčet z jednoho korpusu není zákon.)
     */
    status: { type: 'string', minLength: 1 },
    method: { type: 'string', minLength: 1 },
    /**
     * Vytěžená pole položky. KLÍČE JSOU DATA (item_name, quantity, unit_price,
     * line_total, unit…) — vyjmenovat je tady by z kontraktu udělalo číselník
     * účetních pojmů. Hodnota musí být objekt (naměřeno {gate, raw, span,
     * value}); jeho vnitřek zůstává na ingestu ze stejného důvodu.
     */
    fields: { type: 'object', additionalProperties: { type: 'object' } },
    /**
     * Co s položkou není v pořádku. TVAR PRVKU SE ZÁMĚRNĚ NEPOPISUJE: ve 28
     * naměřených položkách nebyl ani jeden vzorek, takže cokoli konkrétnějšího
     * by byla domněnka — a domněnka ve všechno-nebo-nic schématu shodí blok.
     */
    issues: { type: 'array' }
  }
} as const;

/**
 * CO O PŘEDMĚTU TVRDÍ ZDROJ — a je to tvrzení ZDROJE, ne stav naší práce.
 *
 * ⭐ PROČ VLASTNÍ TVAR A NE DALŠÍ HODNOTA VE `fieldState`. `fieldState` popisuje,
 * jak daleko je ČLOVĚK s rozhodováním (`needs_review` → `human_confirmed`).
 * „Doklad je v účetnictví vyřízený" není další stupeň té škály — je to věta
 * odjinud, kterou nikdo z lidí v téhle frontě neřekl. Kdyby se přilepila do
 * `fieldState`, zdědí ji i `recordField` (sdílí týž výčet), kde nedává smysl
 * vůbec, a zároveň by se dala splést s potvrzením, které nikdo nedal.
 *
 * ⭐ PROČ GENERICKY. Blok nepopisuje dodací list, popisuje POLOŽKU. Co u daného
 * druhu dokladu znamená „uzavřeno", je konfigurace instance (`source_state`
 * v `source_params`), ne větev v kódu: dodák čte `settled`, faktura stav úhrady,
 * smlouva ukončení. Tvar je proto pro všechny týž a nese jen i18n klíč, hodnotu
 * a KDY to zdroj řekl — čtenář má vidět stáří tvrzení, ne jen tvrzení.
 */
const sourceState = {
  type: 'object',
  additionalProperties: false,
  required: ['label_key'],
  properties: {
    /** Co zdroj tvrdí, jako i18n klíč (např. `app.wf.source.settled`). */
    label_key: { type: 'string', minLength: 1 },
    /** Volitelně hodnota jako i18n klíč — pro výčtové stavy. */
    value_key: { type: 'string', minLength: 1 },
    /** Kdy to zdroj řekl (ingested_at registry řádku, ISO). */
    as_of: { type: 'string' },
    /** Odkud to víme — slug zdroje, ne jméno tabulky. */
    source_slug: { type: 'string', minLength: 1 }
  }
} as const;

const reviewItem = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: {
    id: { type: 'string', minLength: 1 },
    title: { type: 'string' },
    title_key: { type: 'string', minLength: 1 },
    subtitle_key: { type: 'string', minLength: 1 },
    state: fieldState,
    fields: { type: 'array', items: recordField },
    quote: { type: 'string' },
    source_state: sourceState
  }
} as const;

const reviewAction = {
  type: 'object',
  additionalProperties: false,
  required: ['action_key', 'decision', 'intent'],
  properties: {
    action_key: { type: 'string', minLength: 1 },
    decision: { type: 'string', minLength: 1 },
    intent: { enum: ['approve', 'reject', 'neutral'] },
    capture: { type: 'array', items: { enum: ['recipient', 'signature', 'note'] }, minItems: 1 }
  }
} as const;

const evidenceRef = {
  type: 'object',
  additionalProperties: false,
  required: ['source_slug'],
  properties: {
    source_slug: { type: 'string', minLength: 1 },
    source_sha256: { type: 'string' },
    filename: { type: 'string' }
  }
} as const;

const findingItem = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'severity'],
  properties: {
    id: { type: 'string', minLength: 1 },
    title_key: { type: 'string', minLength: 1 },
    severity: { enum: ['low', 'medium', 'high', 'critical'] },
    fields: { type: 'array', items: recordField },
    evidence: { type: 'array', items: evidenceRef }
  }
} as const;

export const blockSchema = {
  $id: 'https://schemas.aisha.dev/surface-blocks/block/v1',
  type: 'object',
  required: ['block_type'],
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: baseRequired,
      properties: {
        ...base,
        block_type: { const: 'kpi_tile' },
        data: {
          type: 'object',
          additionalProperties: false,
          required: ['value'],
          properties: {
            /**
             * `null` = NEMĚŘENO, a je to platná odpověď. Nula by tvrdila měření,
             * které nikdo neprovedl — u dlaždice „kolik čeká na člověka" je to
             * rozdíl mezi „nic nečeká" a „nevím, jestli něco čeká". Renderer na
             * null kreslí '—'. Táž úvaha jako u `timing_tower.runs[].ent`.
             *
             * ROZŠÍŘENO 2026-08-08 PODLE NÁLEZU: `get_twin_ref_pending_block`
             * pro nedostatečnou konfiguraci sahal po `'value', null` už dřív —
             * kontrakt ho odmítal, takže se poctivé přiznání zahodilo a blok
             * z obrazovky zmizel BEZE SLOVA. Čtvrtá vlastnost tady tedy nevzniká
             * na přání, ale proto, že produkce ji potřebovala a neměla.
             */
            value: { type: ['number', 'string', 'null'] },
            unit_key: { type: 'string' },
            delta_pct: { type: 'number' },
            state: kpiState
          }
        }
      }
    },
    {
      type: 'object',
      additionalProperties: false,
      required: baseRequired,
      properties: {
        ...base,
        block_type: { const: 'handover_confirm' },
        /* Potvrzení úkonu v terénu — zrcadlí HandoverConfirmBlock v types.ts.
         * `suggested` je ODHAD stroje: validace ho pustí, renderer ho kreslí
         * jako zdroj vedle hodnoty a hodnotou se stane až potvrzením člověka. */
        data: {
          type: 'object',
          additionalProperties: false,
          required: ['step_id', 'title'],
          properties: {
            step_id: { type: 'string', minLength: 1 },
            title: { type: 'string', minLength: 1 },
            steps: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label', 'state'], properties: { label: { type: 'string' }, state: { enum: ['done', 'now', 'next'] } } } },
            facts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label'], properties: { label: { type: 'string' }, value: { type: ['string', 'null'] } } } },
            measure: { type: 'object', additionalProperties: false, properties: { label: { type: 'string' }, unit: { type: 'string' }, suggested: { type: ['string', 'null'] } } },
            evidence: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['slot', 'filled'], properties: { slot: { type: 'string' }, label: { type: 'string' }, filled: { type: 'boolean' } } } },
            signature_required: { type: 'boolean' },
            weight: { type: 'number' }
          }
        }
      }
    },
    {
      type: 'object',
      additionalProperties: false,
      required: baseRequired,
      properties: {
        ...base,
        block_type: { const: 'action_form' },
        /* Akce správy z plochy — zrcadlí ActionFormBlock v types.ts. Akce jsou
         * DATA (allowlist surface_actions), maska je jedna; klient posílá jen
         * slug + cíl + payload do submit_surface_action. */
        data: {
          type: 'object',
          additionalProperties: false,
          required: ['target_kind', 'target_id', 'actions'],
          properties: {
            target_kind: { enum: ['twin', 'actor', 'story', 'none'] },
            target_id: { type: ['string', 'null'], minLength: 1 },
            actions: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['slug', 'title_key', 'fields'],
                properties: {
                  slug: { type: 'string', pattern: '^[a-z][a-z0-9_.]*$' },
                  title_key: { type: 'string', minLength: 1 },
                  description_key: { type: 'string', minLength: 1 },
                  fields: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['key', 'label_key', 'type'],
                      properties: {
                        /* Klíč pole = klíč v payloadu akce. SMÍ camelCase (`baseUrl` AVP): jde jen
                         * do jsonb a server (submit_surface_action) ho bere týmž pravidlem
                         * `^[a-zA-Z][a-zA-Z0-9_]*$`. ⛔ 2026-09-27: klient měl `^[a-z][a-z0-9_]*$`,
                         * pole `baseUrl` se nevykreslilo a připojení AVP nešlo zadat. Shodu obou
                         * znění hlídá brána klic-pole-akce-klient-server. */
                        key: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_]*$' },
                        label_key: { type: 'string', minLength: 1 },
                        type: { enum: ['text', 'textarea', 'uuid', 'date', 'timestamptz', 'integer', 'boolean', 'enum', 'secret'] },
                        required: { type: 'boolean' },
                        options: {
                          type: 'array',
                          items: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['value', 'label_key'],
                            properties: { value: { type: 'string' }, label_key: { type: 'string', minLength: 1 } }
                          }
                        },
                        default: { type: 'string' }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    {
      type: 'object',
      additionalProperties: false,
      required: baseRequired,
      properties: {
        ...base,
        block_type: { const: 'timing_tower' },
        data: {
          type: 'object',
          additionalProperties: false,
          required: ['runs'],
          properties: {
            runs: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
                required: ['batch_id', 'title', 'pos', 'sectors', 'flag'],
                properties: {
                  batch_id: { type: 'string', minLength: 1 },
                  story_id: { type: 'string' },
                  title: { type: 'string' },
                  priority: { type: 'string' },
                  status: { type: 'string' },
                  state: { type: ['string', 'null'] },
                  pos: { type: 'number', minimum: 0, maximum: 1 },
                  total: { type: 'integer' },
                  completed: { type: 'integer' },
                  failed: { type: 'integer' },
                  flag: { enum: ['green', 'yellow', 'red', 'box', 'finish'] },
                  // Jak dlouho běh stojí v aktuální fázi, v sekundách. NULL je
                  // platná odpověď „neměřeno" — renderer na ni kreslí '—', kdežto
                  // nula by tvrdila měření, které nikdo neprovedl.
                  ent: { type: ['number', 'null'] },
                  // Délky HOTOVÝCH fází v pořadí fází (sekundy). Prvek smí být
                  // null (fáze bez časů) a pole se NESMÍ zhušťovat: index nese
                  // kotvu na trati, takže vynechání by posunulo všechny další.
                  done: { type: 'array', items: { type: ['number', 'null'] } },
                  // Brána: na koho a na co se čeká. Jen u běhu, který stojí na
                  // člověku (vlajka box/red) — jinak chybí, protože se nečeká.
                  gate: {
                    type: ['object', 'null'],
                    additionalProperties: false,
                    properties: {
                      label: { type: 'string' },
                      desc: { type: 'string' },
                      // ROLE, ne jméno — osobní údaj se na věž nedostane.
                      owner: { type: 'string' }
                    }
                  },
                  entered_at: { type: ['string', 'null'] },
                  updated_at: { type: ['string', 'null'] },
                  sectors: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: true,
                      required: ['code', 'name', 'order', 'status'],
                      properties: {
                        code: { type: 'string' },
                        name: { type: 'string' },
                        order: { type: 'integer' },
                        status: { type: 'string' },
                        // Syrové časy fáze; délku počítá až čtenář (u běžící
                        // fáze závisí na tom, kdy se ptáš).
                        started_at: { type: ['string', 'null'] },
                        completed_at: { type: ['string', 'null'] },
                        // Čím se popíše brána, když fáze čeká na člověka.
                        description: { type: ['string', 'null'] },
                        assigned_role: { type: ['string', 'null'] }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    {
      type: 'object',
      additionalProperties: false,
      required: baseRequired,
      properties: {
        ...base,
        block_type: { const: 'chart' },
        data: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'points'],
          properties: {
            kind: chartKind,
            points: { type: 'array', items: chartPoint },
            /** Reference line (trend) — the plan the series is measured against. */
            target: { type: 'number' },
            /** i18n key, never a literal — same law as title_key. */
            unit_key: { type: 'string' },
            delta_pct: { type: 'number' },
            compare: { type: 'array', items: chartPoint },
            legend_keys: { type: 'array', maxItems: 2, items: { type: 'string', minLength: 1 } }
          }
        }
      }
    },
    {
      type: 'object',
      additionalProperties: false,
      required: baseRequired,
      properties: {
        ...base,
        block_type: { const: 'table' },
        data: {
          type: 'object',
          additionalProperties: false,
          required: ['columns', 'rows'],
          properties: {
            columns: {
              type: 'array',
              // ⭐ PRÁZDNO JE PLATNÝ TVAR, ne vada. `minItems: 1` tu do 2026-09-06
              // stálo a znamenalo, že tabulka NEUMÍ říct „o ničem": producent,
              // který nemá právo nebo konfiguraci, vydá `columns: []` — a povrch
              // takový blok ZAHODIL a napsal obecné „Zatím není co zobrazit".
              // Naměřeno na `get_audience_view_table_block` (K3): brána kontraktu
              // volá producenty BEZ parametrů pod běžnou identitou, takže se měří
              // jen jejich odmítací větev.
              //
              // Opravovat to na straně producenta by znamenalo, že si sloupec
              // VYMYSLÍ — a vymyšlená hlavička je horší než žádná. Sourozenec
              // `record_detail` má tutéž volbu vyřešenou stejně: `record_id: null`
              // je povolené, protože „null je poctivější než vymyšlená hodnota".
              // Tabulka tu možnost dosud neměla; tohle ji dorovnává.
              //
              // Renderery nulu sloupců snesou (mobil `(d.columns ?? []).map`,
              // shell mapuje stejně), takže prázdná tabulka se vykreslí jako
              // blok se svým nadpisem a bez řádků — poctivé „nic tu není".
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['key', 'label_key'],
                // ⭐ `label` (hotový text) se sem ZÁMĚRNĚ NEDOPLŇUJE, přestože
                // 2026-08-08 kvůli tomu tiše mizely bloky `wb_object_tenants`
                // a `nj_*`. Hlavička tabulky je viditelný text a extranet běží
                // v šesti jazycích; kdo pošle hotový řetězec, obejde překlad
                // pro všechny ostatní. Vada tedy není v kontraktu — je
                // v KONFIGURACI těch bloků, a opravuje se tam.
                properties: {
                  key: { type: 'string', minLength: 1 },
                  label_key: { type: 'string', minLength: 1 },
                  align: { enum: ['left', 'right', 'center'] },
                  /** Buňky sloupce jsou i18n klíče — renderer je přeloží (types.ts). */
                  value_keys: { type: 'boolean' }
                }
              }
            },
            /** Sloupec „nahrazeno novější verzí" a sloupec s číslem verze (types.ts); že jmenují existující sloupec, hlídá validate.ts. */
            superseded_key: { type: 'string', minLength: 1 },
            version_key: { type: 'string', minLength: 1 },
            rows: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: { type: ['string', 'number', 'null'] }
              }
            },
            /**
             * CO řádek JE — druh záznamu, na který ukazuje jeho `id`.
             *
             * Bez tohohle pole nese ukazatel klíč, ale ne kanál: shell dostal
             * holé `id` a měl pro něj JEDINÝ význam („dokument"). Řádek
             * dlužníka přitom nese IČO, takže klik poslal čtečce dokumentů
             * číslo, které nezná — a ta místo chyby vydala PRÁZDNOU kartu.
             * Tiché prázdno je horší než chyba: vypadá jako „ten dlužník nic
             * nemá" (naměřeno na produkci 2026-08-07).
             *
             * Druh vydává RPC, protože jedině ona ví, co do `id` dala. Čím se
             * který druh OTEVÍRÁ, je pak vlastnost instance
             * (`workbench.detail_by_kind`), ne větvení podle jmen ve shellu.
             *
             * Absence = 'document' (zpětná kompatibilita registru dokladů).
             */
            row_kind: { type: 'string', minLength: 1 }
          }
        }
      }
    },
    {
      type: 'object',
      additionalProperties: false,
      required: baseRequired,
      properties: {
        ...base,
        block_type: { const: 'timeline' },
        data: {
          type: 'object',
          additionalProperties: false,
          required: ['items'],
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['at'],
                properties: {
                  at: { type: 'string', format: 'date-time' },
                  label: { type: 'string' },
                  label_key: { type: 'string' },
                  state: kpiState
                }
              }
            }
          }
        }
      }
    },
    {
      type: 'object',
      additionalProperties: false,
      required: baseRequired,
      properties: {
        ...base,
        block_type: { const: 'goal_progress' },
        data: {
          type: 'object',
          additionalProperties: false,
          required: ['runs'],
          properties: {
            runs: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
                required: ['batch_id', 'title', 'pos', 'state', 'milestones'],
                properties: {
                  batch_id: { type: 'string', minLength: 1 },
                  story_id: { type: ['string', 'null'] },
                  title: { type: 'string' },
                  pos: { type: 'number', minimum: 0, maximum: 1 },
                  state: { type: 'string' },
                  total: { type: 'integer' },
                  completed: { type: 'integer' },
                  failed: { type: 'integer' },
                  milestones: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['code', 'name', 'order', 'status'],
                      properties: {
                        code: { type: 'string' },
                        name: { type: 'string' },
                        order: { type: 'integer' },
                        status: { type: 'string' }
                      }
                    }
                  },
                  goal: { type: ['object', 'null'] },
                  updated_at: { type: 'string' }
                }
              }
            }
          }
        }
      }
    },
    {
      type: 'object',
      additionalProperties: false,
      required: baseRequired,
      properties: {
        ...base,
        block_type: { const: 'alert_feed' },
        data: {
          type: 'object',
          additionalProperties: false,
          required: ['items'],
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'kind_key', 'at', 'severity'],
                properties: {
                  id: { type: 'string', minLength: 1 },
                  kind_key: { type: 'string', minLength: 1 },
                  at: { type: 'string', format: 'date-time' },
                  severity: { enum: ['info', 'warning', 'critical'] },
                  deeplink: { type: 'string' }
                }
              }
            }
          }
        }
      }
    },
    {
      type: 'object',
      additionalProperties: false,
      required: baseRequired,
      properties: {
        ...base,
        block_type: { const: 'narrative' },
        data: {
          type: 'object',
          additionalProperties: false,
          required: ['markdown'],
          properties: { markdown: { type: 'string' } }
        }
      }
    },
    {
      type: 'object',
      additionalProperties: false,
      required: baseRequired,
      properties: {
        ...base,
        block_type: { const: 'record_detail' },
        data: {
          type: 'object',
          additionalProperties: false,
          required: ['record_id', 'fields'],
          properties: {
            /**
             * `null` = blok o ŽÁDNÉM záznamu. Čtečka dokladu odpovídá prázdným
             * blokem stejně pro „doklad neexistuje" i pro „nesmíš ho vidět" —
             * ty dva stavy se rozlišit NESMĚJÍ, jinak je z bloku orákulum na
             * existenci. Když se navíc volající nezeptal na žádný klíč, není co
             * do `record_id` napsat; `null` je poctivější než vymyšlená hodnota.
             * Neprázdný řetězec zůstává povinný všude, kde záznam JE.
             */
            record_id: { type: ['string', 'null'], minLength: 1 },
            badges: { type: 'array', items: { type: 'string', minLength: 1 } },
            fields: { type: 'array', items: recordField },
            quote: { type: 'string' },
            /**
             * ⭐ ZA CO, ne jen KOLIK. Doplněno do kontraktu 2026-08-08, přestože
             * čtečka to posílá od 2026-08-05 — a právě ten rozestup byl vada:
             * čtyři neznámé vlastnosti shodily CELÝ blok, takže detail faktury
             * hlásil „Data se nepodařilo načíst" nad 25 poli, která dorazila
             * v pořádku. Kontrakt se rozšiřuje VE VYDÁNÍ PŘED tím, které začne
             * nové klíče posílat — jinak starý bundle potká nový klíč.
             */
            line_items: { type: 'array', items: documentLine },
            /** Kolik řádků ještě čeká na člověka. Počet, ne příznak. */
            lines_pending: { type: 'integer', minimum: 0 },
            /**
             * Co dokladu chybí do úplnosti (`li_source_registry.missing_required`,
             * text[]). Neúplný doklad se má poznat, ne mlčet.
             */
            missing: { type: 'array', items: { type: 'string', minLength: 1 } },
            /**
             * Zdrojový záznam z ERP tak, jak přišel — jen na vyžádání
             * (`include_source=true`), jinak `null`. TYP SE ZÁMĚRNĚ NEPOPISUJE:
             * je to průchozí kopie cizího záznamu, takže cokoli konkrétnějšího
             * by z bundlu udělalo autoritu nad tím, co smí poslat ERP.
             */
            source_record: {}
          }
        }
      }
    },
    {
      type: 'object',
      additionalProperties: false,
      required: baseRequired,
      properties: {
        ...base,
        block_type: { const: 'review_queue' },
        data: {
          type: 'object',
          additionalProperties: false,
          required: ['entity_kind', 'items', 'actions'],
          properties: {
            /**
             * ⭐ ZŮSTÁVÁ UZAVŘENÝ, a je to jiný případ než `blockTarget.entity_kind`
             * o kus výš. Tenhle není navigační nabídka — je to CÍL ZÁPISU:
             * `submitReview` ho posílá zpátky a server na něj dispatchuje. Otevřít
             * ho znamená dovolit klientovi požádat o zápis do registru, o kterém
             * nikdo nerozhodl. Fail-closed je tady vlastnost, ne opatrnost.
             *
             * DOPLNĚNO 'twin_identity' (2026-08-08, podle měření): platforma tu
             * hodnotu vydávala z `get_twin_identity_queue`, výčet ji neznal, a blok
             * `wb_twin_unmatched` proto na obrazovku vůbec nedorazil. Výčet byl
             * tedy zastaralý, ne špatně zvolený — nová doména se přidává SEM,
             * jedním řádkem a vědomě.
             *
             * DOPLNĚNO 'finding' (2026-09-28): dotaz na pravdu nad nálezy ingestu
             * (get_finding_questions). Položka je PRAVIDLO × druh nálezu, ne doklad;
             * zápis dispatchuje submit_evidence_review_audited do li_finding_verdicts.
             *
             * DOPLNĚNO 'twin_relation' (2026-09-28): skupiny NÁVRHŮ HRAN mezi
             * dvojčaty (get_twin_relation_proposal_queue) — systém vazby navrhuje,
             * člověk je schvaluje po skupinách; server dispatchuje na
             * twin_relation_proposal_decide.
             *
             * DOPLNĚNO 'twin_identity_group' (2026-09-28): SKUPINY návrhů identit
             * (get_twin_ref_group_block) — položka = třída shody dvou nezávislých
             * zdrojů pravdy; potvrzení schválí celou skupinu, server dispatchuje na
             * twin_ref_group_decide (třídu počítá znovu, vratné přes batch_id).
             */
            entity_kind: {
              enum: ['extraction', 'obligation', 'document', 'workflow_step', 'twin_identity', 'finding', 'twin_relation', 'twin_identity_group']
            },
            items: { type: 'array', items: reviewItem },
            actions: { type: 'array', minItems: 1, items: reviewAction }
          }
        }
      }
    },
    {
      type: 'object',
      additionalProperties: false,
      required: baseRequired,
      properties: {
        ...base,
        block_type: { const: 'relation_web' },
        /* Síť vazeb (ESDK es-web) — zrcadlí RelationWebBlock v types.ts. */
        data: {
          type: 'object',
          additionalProperties: false,
          required: ['center', 'groups'],
          properties: {
            center: {
              type: 'object',
              additionalProperties: false,
              required: ['label'],
              properties: { label: { type: 'string' }, sub: { type: 'string' } }
            },
            groups: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['key', 'label_key', 'nodes'],
                properties: {
                  key: { type: 'string', minLength: 1 },
                  label_key: { type: 'string', minLength: 1 },
                  nodes: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['label', 'certainty'],
                      properties: {
                        id: { type: 'string', minLength: 1 },
                        kind: { type: 'string', minLength: 1 },
                        label: { type: 'string' },
                        sub: { type: 'string' },
                        value: { type: 'number' },
                        unit_key: { type: 'string', minLength: 1 },
                        state: { enum: ['ok', 'wait', 'fault'] },
                        state_key: { type: 'string', minLength: 1 },
                        certainty: { enum: ['confirmed', 'proposed', 'derived'] }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    {
      type: 'object',
      additionalProperties: false,
      required: baseRequired,
      properties: {
        ...base,
        block_type: { const: 'findings' },
        data: {
          type: 'object',
          additionalProperties: false,
          required: ['items'],
          properties: {
            items: { type: 'array', items: findingItem }
          }
        }
      }
    }
  ]
} as const;

export const layoutSchema = {
  $id: 'https://schemas.aisha.dev/surface-blocks/layout/v1',
  type: 'object',
  additionalProperties: false,
  required: ['schema_version', 'surface', 'blocks'],
  properties: {
    schema_version: { const: 1 },
    // Sections are DATA (see the `Surface` type): validating them against a
    // baked-in list makes the bundle the authority over the backend, which is
    // backwards — and worse, JSON Schema is all-or-nothing, so one unknown
    // section drops the WHOLE layout and get_block_data is never called.
    // `block_type` below stays an enum: that one names a renderer.
    surface: { type: 'string', minLength: 1 },
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['block_slug', 'block_type', 'title_key', 'position'],
        properties: {
          block_slug: { type: 'string', minLength: 1 },
          // Enum se NEPÍŠE — importuje se z types.ts (BLOCK_TYPES). Dva ručně vedené
          // seznamy téhož dovolily masce existovat v unii a padat na validaci layoutu.
          block_type: { enum: [...BLOCK_TYPES] },
          title_key: { type: 'string', minLength: 1 },
          position: { type: 'integer', minimum: 0 },
          // How the block WANTS to be arranged — a hint for the shell, not a
          // renderer name (block_type stays the closed enum that names one).
          // Open string on purpose: an unknown presentation must degrade to the
          // block's default rendering, never drop the layout. Sections are DATA;
          // so is arrangement.
          //
          // Hints the shells understand today (the value travels in the block's
          // `source_params.presentation`, get_surface_layout lifts it here):
          //   'tape'   — a review_queue drawn as the day's stream (done → NOW → ahead)
          //   'detail' — the block reads ONE record: placed in the section so the
          //              dispatcher admits it, but drawn only in the record detail
          //              pane (detail_by_kind), never in the section list
          //              (2026-09-05: four empty frames under the twin registry).
          presentation: { type: 'string', minLength: 1 }
        }
      }
    }
  }
} as const;

export const snapshotEnvelopeSchema = {
  $id: 'https://schemas.aisha.dev/surface-blocks/snapshot/v1',
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version', 'snapshot_slug', 'surface', 'published_at',
    'expires_at', 'max_sensitivity', 'blocks'
  ],
  properties: {
    schema_version: { const: 1 },
    snapshot_slug: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]*$' },
    // Sections are DATA (see the `Surface` type): validating them against a
    // baked-in list makes the bundle the authority over the backend, which is
    // backwards — and worse, JSON Schema is all-or-nothing, so one unknown
    // section drops the WHOLE layout and get_block_data is never called.
    // `block_type` below stays an enum: that one names a renderer.
    surface: { type: 'string', minLength: 1 },
    published_at: { type: 'string', format: 'date-time' },
    expires_at: { type: 'string', format: 'date-time' },
    max_sensitivity: sensitivity,
    blocks: { type: 'array', items: { $ref: 'https://schemas.aisha.dev/surface-blocks/block/v1' } }
  }
} as const;
