import { createHash, type Hash } from 'node:crypto';
import { Transform, type Readable, type TransformCallback } from 'node:stream';

/**
 * Proud, který hlídá, co jím teče: nepustí víc bajtů, než kolik je povoleno,
 * volitelně ověří začátek (magická čísla) a spočítá SHA-256.
 *
 * Content-Length je jen TVRZENÍ klienta. Kdyby se mu věřilo, delší tělo by
 * prošlo do úložiště celé; proto se počítá, co opravdu teče, a přetečení
 * proud ukončí chybou.
 */
export class PrilisVelke extends Error {
  constructor(public readonly max: number) {
    super(`body exceeds ${max} bytes`);
    this.name = 'PrilisVelke';
  }
}

export class SpatnyZacatek extends Error {
  constructor() {
    super('unexpected file signature');
    this.name = 'SpatnyZacatek';
  }
}

export class HlidanyProud extends Transform {
  private pocet = 0;
  private readonly hash: Hash | null;
  private zacatekOveren: boolean;

  constructor(private readonly max: number, opts: { sha256?: boolean; zacatek?: Buffer } = {}) {
    super();
    this.hash = opts.sha256 ? createHash('sha256') : null;
    this.zacatek = opts.zacatek ?? null;
    this.zacatekOveren = !this.zacatek;
  }

  private readonly zacatek: Buffer | null;
  private hlava = Buffer.alloc(0);

  override _transform(chunk: Buffer, _enc: BufferEncoding, done: TransformCallback): void {
    this.pocet += chunk.length;
    if (this.pocet > this.max) return done(new PrilisVelke(this.max));
    if (!this.zacatekOveren && this.zacatek) {
      this.hlava = Buffer.concat([this.hlava, chunk]);
      if (this.hlava.length >= this.zacatek.length) {
        if (!this.hlava.subarray(0, this.zacatek.length).equals(this.zacatek)) return done(new SpatnyZacatek());
        this.zacatekOveren = true;
      }
    }
    this.hash?.update(chunk);
    done(null, chunk);
  }

  override _flush(done: TransformCallback): void {
    if (!this.zacatekOveren) return done(new SpatnyZacatek());
    done();
  }

  get bajtu(): number {
    return this.pocet;
  }

  /** SHA-256 hex; platí až po konci proudu. */
  sha256(): string | null {
    return this.hash ? this.hash.digest('hex') : null;
  }
}

/**
 * Pustí tělo požadavku do hlídaného proudu. ⛔ Záměrně ne `stream/promises.pipeline`:
 * po chybě čeká, až se ZAVŘOU všechny proudy, a proud požadavku zavřený být
 * nemusí (za proxy, v inject) — slib by nikdy nedoběhl a požadavek by visel
 * (naměřeno testem 2026-09-18). Tady se čeká jen na konec nebo chybu hlídače.
 */
export function vedTelo(telo: Readable, hlidac: HlidanyProud): void {
  telo.on('error', (e) => hlidac.destroy(e));
  telo.pipe(hlidac);
}

/** Po odmítnutí: odpojit a zbytek těla dočíst naprázdno, ať spojení nevisí. */
export function zahodZbytek(telo: Readable, hlidac?: HlidanyProud): void {
  if (hlidac) telo.unpipe(hlidac);
  telo.resume();
}
