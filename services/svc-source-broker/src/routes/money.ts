/**
 * Money lane — stav, ruční tah a TEST SPOJENÍ pro administraci.
 *
 * ⭐ TEST SPOJENÍ JE POKUS, NE DOTAZ. Naměřeno 2026-08-31: tři agendy vracely
 * `0` na doklady, na faktury i na `Firms` — pole, které v schématu NENÍ. Živá
 * agenda takový dotaz odmítne CHYBOU SCHÉMATU; spojení, které nikam nevede,
 * vrátí prázdno. Bez toho rozdílu se „nemá doklady" nedá odlišit od „nevede
 * nikam", a mlčící zdroj je horší než hlasitě rozbitý.
 *
 * ⭐ Tunel se otevírá VÝPŮJČKOU drženou po celý test. Bez ní se VPN zavírá
 * kolem každého dotazu a agendy padají na `401 invalid_client` / `fetch
 * failed` — což jsem 2026-08-31 nahlásil jako vadu dodavatele, a bylo to
 * špatně. Logika tunelu zůstává uvnitř; administrace vidí jen verdikt.
 *
 * SECURITY: týž strážce jako /sync/run — tah i test sahají do cizí sítě
 * pověřeními instance, takže nikdy nesmí být bez identity.
 */
import type { FastifyInstance } from 'fastify';
import { createAuthGuard } from '../auth-guard.js';
import { errMessage } from '../errors.js';
import type { SourceBrokerConfig } from '../config.js';
import type { MoneyLaneHandle } from '../clients/money-lane.js';
import { createMoneyClient, probeReachable } from '../clients/money-driver.js';

/** Verdikt na agendu. `mlci` je vlastní stav, ne odrůda prázdna. */
interface AgendaVerdikt {
  agenda: string;
  stav: 'dostupna' | 'mlci' | 'chyba';
  dokladu: number | null;
  duvod?: string;
}

export function registerMoneyRoutes(
  app: FastifyInstance,
  lane: MoneyLaneHandle,
  config: SourceBrokerConfig
): void {
  const guard = createAuthGuard(config);

  // Stav pro administraci: cesta, POLITIKA (z databáze, ne z prostředí),
  // poslední běh a kdy je příště. `policy: null` znamená neregistrovaný nebo
  // NEAKTIVNÍ zdroj — a to je jiný stav než „lane vypnutá", proto se hlásí zvlášť.
  app.get('/money/status', { preHandler: guard.requireAdminOrService }, async () => {
    const st = await lane.status();
    return {
      ...st,
      // Adresy ANO, tokeny NE — administraci stačí vědět, že cesta je nastavená.
      moneyConfigured: !!config.moneyApiUrl,
      ingestConfigured: !!config.ingestApiUrl,
    };
  });

  app.post<{ Body?: { since?: string } }>('/money/pull', { preHandler: guard.requireAdminOrService },
    async (req, reply) => {
      if (!lane.enabled) {
        reply.code(503);
        return { error: 'money lane není zapnutá — chybí adresa svc-money nebo ingestu' };
      }
      try {
        return await lane.runOnce({ since: req.body?.since });
      } catch (e) {
        reply.code(502);
        return { error: errMessage(e) };
      }
    });

  // EVENT TRIGGER — volá se po vystavení dokladu („aktualizuj"). Tah se jen OZNAČÍ a provede
  // ho nejbližší tik hodinek: požadavky mezi tiky splynou, odklad po selhání i zákaz souběhu
  // platí dál. Tělo je volitelné a slouží jen ke stopě v logu (co událost vyvolalo).
  app.post<{ Body?: { agenda?: string; cisloDokladu?: string; zdroj?: string } }>('/money/trigger',
    { preHandler: guard.requireAdminOrService },
    async (req, reply) => {
      if (!lane.enabled) {
        reply.code(503);
        return { error: 'money lane není zapnutá — chybí adresa svc-money nebo ingestu' };
      }
      const b = req.body ?? {};
      const duvod = [b.zdroj ?? 'trigger', b.agenda, b.cisloDokladu].filter((x) => typeof x === 'string' && x).join(' ');
      reply.code(202);
      return lane.pozadatTah(duvod);
    });

  app.post('/money/test', { preHandler: guard.requireAdminOrService }, async (_req, reply) => {
    if (!config.moneyApiUrl) {
      reply.code(503);
      return { error: 'adresa svc-money není nastavená' };
    }
    const client = createMoneyClient(config.moneyApiUrl, config.moneyApiToken ?? '');
    let leaseId: string | null = null;
    const vysledky: AgendaVerdikt[] = [];
    try {
      // Tunel nahoru a DRŽET — jinak měříme jeho zavírání, ne agendy.
      leaseId = await client.lease();
      for (const a of await client.listAgendas()) {
        try {
          if (!(await probeReachable(client, a.key))) {
            vysledky.push({ agenda: a.key, stav: 'mlci', dokladu: null,
              duvod: 'dotaz na neexistující pole nevrátil chybu schématu — spojení nevede k Money' });
            continue;
          }
          const d = await client.query(a.key, '{ IssuedDeliveryNotes { ID } }');
          if (d.errors?.length) {
            vysledky.push({ agenda: a.key, stav: 'chyba', dokladu: null, duvod: JSON.stringify(d.errors).slice(0, 160) });
            continue;
          }
          vysledky.push({ agenda: a.key, stav: 'dostupna',
            dokladu: ((d.data?.IssuedDeliveryNotes ?? []) as unknown[]).length });
        } catch (e) {
          vysledky.push({ agenda: a.key, stav: 'chyba', dokladu: null, duvod: errMessage(e) });
        }
      }
    } catch (e) {
      reply.code(502);
      return { error: errMessage(e), agendy: vysledky };
    } finally {
      // Výpůjčka se vrací i při výjimce — otevřený tunel do cizí sítě není stav,
      // ve kterém se smí zůstat. Nevrácená výpůjčka se hlásí, výsledek testu ale nemaže.
      if (leaseId) {
        await client.release(leaseId).catch((e: unknown) => {
          app.log.error({ leaseId, err: e instanceof Error ? e.message : String(e) },
            'money/test: výpůjčku tunelu svc-money se NEPODAŘILO vrátit — tunel drží do stropu života výpůjčky');
        });
      }
    }
    return {
      agendy: vysledky,
      dostupnych: vysledky.filter((v) => v.stav === 'dostupna').length,
      mlcicich: vysledky.filter((v) => v.stav === 'mlci').length,
    };
  });
}
