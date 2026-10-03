/**
 * Vstupní bod pluginu: faktury z Money, ale CESTOU PŘES `svc-money`.
 *
 * ⭐ ROZHODNUTÍ MAJITELE 2026-08-27: „jeden tunel a jeden vlastník, a ostatní
 * to jen použijí." Broker tedy VPN profil nedostává; o cestu si říká u
 * `svc-money`, který ji drží a po nečinnosti zavírá.
 *
 * Proti přímé variantě (`./invoices`) se mění JEDINÁ věc — kudy dotaz jde.
 * Mapování faktur, stránkování i vyhledávání podle čísla dokladu zůstávají
 * tam, kde byly, a existují jen jednou.
 *
 * ⛔ AGENDA SE NEODVOZUJE. Money rozlišuje firmy PORTEM a `svc-money` je zná
 * pod klíčem agendy; dosadit „tu první" by tiše smíchalo doklady dvou firem.
 * Klíč se bere z `SourceConnection.endpointUrl` ve tvaru `svc-money://<agenda>`,
 * tedy z deployment konfigurace, ne z kódu balíčku.
 *
 * Env (deployment):
 *   SVC_MONEY_URL        — základ služby, např. `http://<prefix>-svc-money:3016`
 *   SVC_MONEY_API_TOKEN  — pověření K SLUŽBĚ (ne k Money)
 */
import type { IDataSource, SourceConnection } from '@aisha/audience-types';
import { createDataSource as createPrimo, type ClientFactory } from './invoices.js';
import { SvcMoneyClient } from './svc-money-client.js';

const PREFIX = 'svc-money://';

/** Vytáhne klíč agendy z `endpointUrl`. Prázdno je vada vstupu, ne výchozí stav. */
export function agendaZEndpointu(endpointUrl: string): string {
  const url = (endpointUrl || '').trim();
  if (!url.startsWith(PREFIX)) {
    throw new Error(
      `money-s5 přes svc-money: endpointUrl musí být '${PREFIX}<agenda>', dostal '${url || '(prázdné)'}'. ` +
        'Money rozlišuje firmy portem a agenda se NEODVOZUJE — dosadit „tu první" ' +
        'by smíchalo doklady dvou firem.',
    );
  }
  const agenda = url.slice(PREFIX.length).replace(/\/+$/, '');
  if (!agenda) throw new Error(`money-s5 přes svc-money: v '${url}' chybí klíč agendy`);
  return agenda;
}

export function createDataSource(opts?: { fetchImpl?: typeof fetch }): IDataSource {
  const tovarna: ClientFactory = (connection: SourceConnection, _slug, fetchImpl) =>
    new SvcMoneyClient({
      baseUrl: process.env.SVC_MONEY_URL ?? '',
      apiToken: process.env.SVC_MONEY_API_TOKEN ?? '',
      agenda: agendaZEndpointu(connection.endpointUrl),
      fetchImpl: fetchImpl ?? opts?.fetchImpl,
    }) as unknown as ReturnType<ClientFactory>;

  return createPrimo({ fetchImpl: opts?.fetchImpl, clientFactory: tovarna });
}

export const createInvoiceViaSvcMoneyDataSource = createDataSource;
