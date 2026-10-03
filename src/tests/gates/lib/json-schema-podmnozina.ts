/**
 * Podmnožina draft-07, kterou vynucují brány nad `*.schema.json` v repu.
 *
 * Vyčleněno ze `schema-deklarace-se-plni.gate.test.ts`, aby TOTÉŽ měřidlo mohla
 * použít brána nad instančním overlayem (`profil-instance-plni-schema`). Dva
 * validátory téhož schématu by se rozešly — a rozchod měřidel je přesně ta vada,
 * kterou brány ruší.
 *
 * `ajv` není závislost repa a přidávat ji kvůli pár schématům je neúměrné.
 *
 * KLÍČOVÉ: neznámé klíčové slovo je CHYBA, ne tiché přeskočení. Validátor, který
 * ignoruje, čemu nerozumí, je ozdoba — schéma by se rozšířilo o pravidlo, které
 * se nikdy neuplatní, a nikdo by to nepoznal (feedback_tool_failure_read_as_data).
 */

/**
 * Klíčová slova, která validátor VYNUCUJE. Cokoli mimo tenhle a následující
 * seznam je chyba schématu — viz throw v `overit`.
 */
export const OMEZENI = new Set([
  "$ref", "type", "required", "properties", "additionalProperties",
  "patternProperties", "dependencies",
  "items", "enum", "const", "pattern", "minLength", "maxLength",
  "minItems", "minimum", "maximum", "format",
]);

/**
 * Klíčová slova, která NEJSOU omezením — popisují, nevynucují.
 *
 * Vypisují se zvlášť a ne jako „to neznáme": rozdíl mezi „tomu rozumím a nic to
 * neomezuje" a „tomu nerozumím" je celý smysl téhle brány. Kdyby splynuly,
 * stačilo by do schématu napsat překlep a validátor by ho tiše přešel.
 */
export const ANOTACE = new Set(["$schema", "$id", "title", "description", "definitions", "$defs", "default", "examples", "deprecated"]);

/** `format` z draft-07 — vynucují se jen ty, které schémata v repu skutečně používají. */
const FORMATY: Record<string, RegExp> = {
  "date-time": /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/,
};

export type Uzel = Record<string, unknown>;

export function typSedi(hodnota: unknown, typ: string): boolean {
  switch (typ) {
    case "object": return typeof hodnota === "object" && hodnota !== null && !Array.isArray(hodnota);
    case "array": return Array.isArray(hodnota);
    case "string": return typeof hodnota === "string";
    case "integer": return typeof hodnota === "number" && Number.isInteger(hodnota);
    case "number": return typeof hodnota === "number";
    case "boolean": return typeof hodnota === "boolean";
    case "null": return hodnota === null;
    default: throw new Error(`neznámý typ ve schématu: ${typ}`);
  }
}

/** Vrací seznam porušení; prázdný = data schématu vyhovují. */
export function overit(data: unknown, schema: Uzel, korenSchema: Uzel, kde = "$"): string[] {
  const chyby: string[] = [];

  for (const kw of Object.keys(schema)) {
    if (!OMEZENI.has(kw) && !ANOTACE.has(kw)) {
      // Ne nález v datech — vada v MĚŘIDLE. Musí být hlasitá, jinak by se
      // schéma dalo rozšířit o pravidlo, které se nikdy neuplatní.
      throw new Error(
        `${kde}: schéma používá klíčové slovo '${kw}', které validátor nevynucuje — ` +
          `doplň ho do OMEZENI (a implementuj), nebo do ANOTACE (pokud nic neomezuje), nebo ho ze schématu odstraň`,
      );
    }
  }

  if (typeof schema.$ref === "string") {
    const m = /^#\/(definitions|\$defs)\/(.+)$/.exec(schema.$ref);
    if (!m) throw new Error(`${kde}: podporován je jen $ref do #/definitions nebo #/$defs, ne '${schema.$ref}'`);
    // `$defs` je novější jméno téhož bloku (draft 2019-09+); repo má obojí.
    const cil = (korenSchema[m[1]] as Record<string, Uzel> | undefined)?.[m[2]];
    if (!cil) throw new Error(`${kde}: $ref míří na definici '${m[2]}', která ve schématu není`);
    return overit(data, cil, korenSchema, kde);
  }

  if (schema.type !== undefined) {
    const typy = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
    if (!typy.some((t) => typSedi(data, t))) {
      chyby.push(`${kde}: očekáván typ ${typy.join("|")}, je ${data === null ? "null" : Array.isArray(data) ? "array" : typeof data}`);
      return chyby; // další kontroly by na špatném typu jen šuměly
    }
  }

  if ("const" in schema && JSON.stringify(data) !== JSON.stringify(schema.const)) {
    chyby.push(`${kde}: hodnota ${JSON.stringify(data)} != const ${JSON.stringify(schema.const)}`);
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(data as never)) {
    chyby.push(`${kde}: hodnota ${JSON.stringify(data)} není v enum ${JSON.stringify(schema.enum)}`);
  }

  if (typeof schema.pattern === "string" && typeof data === "string" && !new RegExp(schema.pattern).test(data)) {
    chyby.push(`${kde}: '${data}' neodpovídá vzoru ${schema.pattern}`);
  }

  if (typeof schema.format === "string") {
    const re = FORMATY[schema.format];
    // Neznámý `format` je vada měřidla, ne dat — deklarovaný formát, který se
    // nekontroluje, je přesně ta ozdoba, kterou tahle brána ruší.
    if (!re) throw new Error(`${kde}: schéma žádá format '${schema.format}', který validátor neumí — doplň ho do FORMATY`);
    if (typeof data === "string" && !re.test(data)) chyby.push(`${kde}: '${data}' není platný ${schema.format}`);
  }

  if (typeof data === "string") {
    if (typeof schema.minLength === "number" && data.length < schema.minLength) chyby.push(`${kde}: délka ${data.length} < minLength ${schema.minLength}`);
    if (typeof schema.maxLength === "number" && data.length > schema.maxLength) chyby.push(`${kde}: délka ${data.length} > maxLength ${schema.maxLength}`);
  }

  if (Array.isArray(data) && typeof schema.minItems === "number" && data.length < schema.minItems) {
    chyby.push(`${kde}: ${data.length} položek < minItems ${schema.minItems}`);
  }

  if (typeof data === "number") {
    if (typeof schema.minimum === "number" && data < schema.minimum) chyby.push(`${kde}: ${data} < minimum ${schema.minimum}`);
    if (typeof schema.maximum === "number" && data > schema.maximum) chyby.push(`${kde}: ${data} > maximum ${schema.maximum}`);
  }

  if (Array.isArray(data) && schema.items) {
    data.forEach((v, i) => chyby.push(...overit(v, schema.items as Uzel, korenSchema, `${kde}[${i}]`)));
  }

  if (typSedi(data, "object")) {
    const obj = data as Record<string, unknown>;
    const props = (schema.properties as Record<string, Uzel> | undefined) ?? {};
    const vzory = Object.entries((schema.patternProperties as Record<string, Uzel> | undefined) ?? {})
      .map(([vzor, podschema]) => [new RegExp(vzor), podschema] as const);
    for (const r of (schema.required as string[] | undefined) ?? []) {
      if (!(r in obj)) chyby.push(`${kde}: chybí povinná vlastnost '${r}'`);
    }
    for (const [k, v] of Object.entries(obj)) {
      // Draft-07: `properties` i všechny sedící `patternProperties` platí SOUČASNĚ;
      // `additionalProperties` jen pro klíč, který nezachytil ani jeden z nich.
      const sediciVzory = vzory.filter(([re]) => re.test(k));
      if (props[k]) chyby.push(...overit(v, props[k], korenSchema, `${kde}.${k}`));
      for (const [, podschema] of sediciVzory) chyby.push(...overit(v, podschema, korenSchema, `${kde}.${k}`));
      if (props[k] || sediciVzory.length > 0) continue;
      if (schema.additionalProperties === false) {
        chyby.push(`${kde}: vlastnost '${k}' není ve schématu deklarovaná`);
      } else if (typSedi(schema.additionalProperties, "object")) {
        chyby.push(...overit(v, schema.additionalProperties as Uzel, korenSchema, `${kde}.${k}`));
      }
    }
    // `dependencies` jen v POLOVÉ podobě („je-li A, musí být i B, C"). Schématová
    // podoba (`{"A": {…schéma…}}`) je jiné pravidlo — neimplementovaná musí být
    // vada měřidla, ne tiché přeskočení.
    for (const [k, zavislost] of Object.entries((schema.dependencies as Record<string, unknown> | undefined) ?? {})) {
      if (!Array.isArray(zavislost)) {
        throw new Error(`${kde}: dependencies.${k} je schématová podoba — validátor umí jen pole jmen vlastností`);
      }
      if (!(k in obj)) continue;
      for (const nutna of zavislost as string[]) {
        if (!(nutna in obj)) chyby.push(`${kde}: vlastnost '${k}' vyžaduje i '${nutna}'`);
      }
    }
  }

  return chyby;
}
