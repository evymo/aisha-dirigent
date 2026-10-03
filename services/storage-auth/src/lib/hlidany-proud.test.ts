import { describe, it, expect } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { HlidanyProud, PrilisVelke, SpatnyZacatek } from './hlidany-proud.js';

async function prozen(obsah: Buffer[], h: HlidanyProud): Promise<Buffer> {
  const ven: Buffer[] = [];
  await pipeline(Readable.from(obsah), h, new Writable({
    write(c: Buffer, _enc, hotovo) {
      ven.push(c);
      hotovo();
    },
  }));
  return Buffer.concat(ven);
}

describe('hlídaný proud', () => {
  it('pustí povolené a spočítá SHA-256 ze skutečného obsahu', async () => {
    const data = Buffer.from('PK\x03\x04zbytek');
    const h = new HlidanyProud(100, { sha256: true, zacatek: Buffer.from([0x50, 0x4b, 0x03, 0x04]) });
    expect(await prozen([data.subarray(0, 2), data.subarray(2)], h)).toEqual(data);
    expect(h.sha256()).toBe(createHash('sha256').update(data).digest('hex'));
    expect(h.bajtu).toBe(data.length);
  });

  it('přetečení nad tvrzenou délku proud ukončí', async () => {
    await expect(prozen([Buffer.alloc(60), Buffer.alloc(60)], new HlidanyProud(100))).rejects.toBeInstanceOf(PrilisVelke);
  });

  it('cizí začátek (ne ZIP) se nepustí', async () => {
    const h = new HlidanyProud(100, { zacatek: Buffer.from('PK') });
    await expect(prozen([Buffer.from('MZ-exe')], h)).rejects.toBeInstanceOf(SpatnyZacatek);
  });

  it('kratší obsah, než je magické číslo, taky neprojde', async () => {
    const h = new HlidanyProud(100, { zacatek: Buffer.from('PK\x03\x04') });
    await expect(prozen([Buffer.from('P')], h)).rejects.toBeInstanceOf(SpatnyZacatek);
  });
});
